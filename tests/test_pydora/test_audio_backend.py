import socket
import threading
import time
from unittest import TestCase
from unittest.mock import Mock, patch

from pydora import audio_backend
from pydora.audio_backend import (
    PlayerUnusable,
    RemoteVLC,
    RemoteVLCConnectionError,
)


class FakeSong:
    def __init__(self, url="http://example.example/song.mp3"):
        self.audio_url = url
        self.encoding = "mp3"


class LineSocket:
    """File-like view of a socket, mirroring how the app passes sys.stdin.

    The playback loop calls fileno() for select routing and readline() for
    user input; a raw socket only provides the former.
    """

    def __init__(self, sock):
        self._sock = sock

    def fileno(self):
        return self._sock.fileno()

    def readline(self):
        # sys.stdin yields text; the playback loop strips and compares str.
        return self._sock.recv(1024).decode("utf-8")


class FakeSocket:
    """In-memory stand-in for a control socket.

    Recv data and send failures are scripted so reconnect behaviour can be
    exercised without a real network service.
    """

    def __init__(
        self,
        recv_data=b"",
        send_error=None,
        recv_error=None,
        close_error=None,
        name="fake",
    ):
        self._recv_data = recv_data
        self._send_error = send_error
        self._recv_error = recv_error
        self._close_error = close_error
        self.name = name
        self.sent = []
        self.closed = False
        self.blocking = True

    def setblocking(self, flag):
        self.blocking = flag

    def sendall(self, data):
        self.sent.append(data)
        if self._send_error is not None:
            error = self._send_error
            # Only fail once so a retry after reconnect can succeed.
            self._send_error = None
            raise error

    def recv(self, size):
        if self._recv_error is not None:
            error = self._recv_error
            self._recv_error = None
            raise error
        if self._recv_data:
            data = self._recv_data[:size]
            self._recv_data = self._recv_data[size:]
            return data
        # Empty read models the remote peer shutting the connection down.
        return b""

    def close(self):
        self.closed = True
        if self._close_error is not None:
            raise self._close_error

    def fileno(self):
        return -1


def make_callbacks():
    return Mock(
        play=Mock(),
        pre_poll=Mock(),
        post_poll=Mock(),
        input=Mock(),
    )


class ScriptedVLCServer:
    """Minimal loopback replacement for a VLC rc interface.

    Each accepted connection receives one entry from ``scripts``; connections
    are closed as soon as their data has been delivered so the client can
    observe a peer shutdown and reconnect. A script entry is either raw bytes
    or a list of steps, where each step is bytes or an ``(delay, bytes)``
    tuple, letting tests spread data across several client poll iterations.
    """

    def __init__(self, scripts):
        self.scripts = list(scripts)
        self._lock = threading.Lock()
        self.commands = []
        self.connections = 0
        self._stop = threading.Event()
        self._thread = None
        self._srv = None
        self._handlers = []

    @property
    def address(self):
        host, port = self._srv.getsockname()
        return host, port

    def start(self):
        self._srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._srv.bind(("127.0.0.1", 0))
        self._srv.listen(5)
        self._srv.settimeout(0.25)
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self):
        while not self._stop.is_set():
            try:
                conn, _ = self._srv.accept()
            except TimeoutError:
                continue
            except OSError:
                return

            with self._lock:
                self.connections += 1
                index = self.connections - 1
                payload = (
                    self.scripts[index] if index < len(self.scripts) else b""
                )

            handler = threading.Thread(
                target=self._handle,
                args=(conn, payload),
                daemon=True,
            )
            self._handlers.append(handler)
            handler.start()

    def _handle(self, conn, payload):
        conn.settimeout(5)
        try:
            steps = payload if isinstance(payload, list) else [payload]
            for step in steps:
                if isinstance(step, tuple):
                    delay, data = step
                else:
                    delay, data = 0, step
                if delay:
                    if self._stop.wait(delay):
                        break
                if data:
                    conn.sendall(data)
            # Drain any commands the client sends before going away.
            while not self._stop.is_set():
                try:
                    data = conn.recv(1024)
                except TimeoutError:
                    break
                except OSError:
                    break
                if not data:
                    break
                with self._lock:
                    self.commands.extend(data.splitlines())
        finally:
            conn.close()

    def stop(self):
        self._stop.set()
        try:
            self._srv.close()
        except OSError:
            pass
        if self._thread is not None:
            self._thread.join(timeout=5)
        for handler in self._handlers:
            handler.join(timeout=5)


class TestRemoteVLCReconnect(TestCase):
    def setUp(self):
        # Make backoff and the base player's track-load pause instant while
        # preserving real sleeping for test threads that wait on conditions.
        real_sleep = time.sleep

        def fake_sleep(duration):
            if duration >= 1:
                return
            real_sleep(duration)

        sleep_patcher = patch.object(
            audio_backend.time, "sleep", side_effect=fake_sleep
        )
        self.addCleanup(sleep_patcher.stop)
        sleep_patcher.start()

        self.control_a, self.control_b = socket.socketpair()
        self.addCleanup(self._close_control_sockets)

    def _close_control_sockets(self):
        for sock in (self.control_a, self.control_b):
            try:
                sock.close()
            except OSError:
                pass

    def _make_player(self, server, **kwargs):
        host, port = server.address
        player = RemoteVLC(
            host,
            port,
            make_callbacks(),
            LineSocket(self.control_a),
            **kwargs,
        )
        # Keep tests snappy: no status-poll traffic interleaving with scripts.
        player.POLL_INTERVAL = 100000
        self.addCleanup(player.close)
        return player

    def _make_fake_player(self, first_socket, connection_factory):
        """Build a player whose create_connection is fully scripted.

        The factory must return ``first_socket`` on its first invocation (the
        construction-time connection) and replacement sockets afterwards. The
        patch is kept active for the lifetime of the test so reconnects use
        the same scripted factory.
        """
        patcher = patch.object(
            audio_backend.socket,
            "create_connection",
            side_effect=connection_factory,
        )
        self.addCleanup(patcher.stop)
        patcher.start()

        player = RemoteVLC(
            "127.0.0.1",
            9999,
            make_callbacks(),
            LineSocket(self.control_a),
        )

        self.assertIs(player._control_sock, first_socket)
        player.POLL_INTERVAL = 100000
        player.RECONNECT_DELAY = 0
        self.addCleanup(player.close)
        return player

    @staticmethod
    def _fake_select(readers, *_args, **_kwargs):
        # Keep the control channel out of the result: fake-socket tests drive
        # the loop purely through the VLC control socket.
        return [readers[1]], [], []

    def test_peer_close_triggers_reconnect_and_resumes_song(self):
        server = ScriptedVLCServer(
            [
                b"status: ( new input: song )\n",
                b"state stopped\n",
            ]
        )
        server.start()
        self.addCleanup(server.stop)

        player = self._make_player(server)
        initial_sock = player._control_sock

        player.play(FakeSong())

        # The dead socket was replaced with a fresh connection to the same
        # host:port and playback of the same song completed.
        self.assertEqual(server.connections, 2)
        self.assertIsNot(player._control_sock, initial_sock)
        # The replaced socket's file descriptor was released.
        self.assertEqual(initial_sock.fileno(), -1)
        self.assertTrue(
            any(line.startswith(b"add ") for line in server.commands)
        )
        # The song-start callback fires exactly once, not again on reconnect.
        player._callbacks.play.assert_called_once()

    def test_send_failure_triggers_reconnect_and_command_retry(self):
        healthy_first = FakeSocket(name="first")
        replacement = FakeSocket(name="replacement")
        sockets = iter([healthy_first, replacement])

        def fake_create_connection(address):
            return next(sockets)

        player = self._make_fake_player(healthy_first, fake_create_connection)

        # The initial add succeeds; arm the dead-socket failure afterwards so
        # the first status poll is the command that triggers a reconnect.
        original_sendall = healthy_first.sendall

        def sendall_then_fail(data):
            original_sendall(data)
            healthy_first._send_error = BrokenPipeError("broken pipe")

        healthy_first.sendall = sendall_then_fail
        replacement._recv_data = b"state stopped\n"

        with patch.object(
            audio_backend.select, "select", side_effect=self._fake_select
        ):
            player.play(FakeSong())

        self.assertIs(player._control_sock, replacement)
        self.assertTrue(healthy_first.closed)
        # The status command was retried against the replacement socket.
        self.assertIn(b"status\n", replacement.sent)
        # The add command was re-issued once by the reconnect, not twice.
        self.assertEqual(
            sum(1 for line in replacement.sent if line.startswith(b"add ")),
            1,
        )
        player._callbacks.play.assert_called_once()

    def test_reconnect_failure_raises_readable_player_exception(self):
        first = FakeSocket(name="first")
        calls = {"count": 0}

        def fake_create_connection(address):
            calls["count"] += 1
            if calls["count"] == 1:
                return first
            # Every replacement connection accepts then refuses the reload
            # command, so every reconnect attempt fails.
            return FakeSocket(send_error=BrokenPipeError("still broken"))

        player = self._make_fake_player(first, fake_create_connection)
        player.RECONNECT_ATTEMPTS = 2

        with patch.object(
            audio_backend.select, "select", side_effect=self._fake_select
        ):
            with self.assertRaises(RemoteVLCConnectionError) as ctx:
                player.play(FakeSong())

        message = str(ctx.exception)
        self.assertIn("127.0.0.1", message)
        self.assertIn("9999", message)
        self.assertTrue(first.closed)
        self.assertIsNone(player._control_sock)
        player._callbacks.play.assert_called_once()

    def test_reconnect_failure_when_host_unreachable(self):
        first = FakeSocket(name="first")
        sockets = iter([first])

        def fake_create_connection(address):
            try:
                return next(sockets)
            except StopIteration:
                raise ConnectionRefusedError("refused")

        player = self._make_fake_player(first, fake_create_connection)
        player.RECONNECT_ATTEMPTS = 2

        with patch.object(
            audio_backend.select, "select", side_effect=self._fake_select
        ):
            with self.assertRaises(RemoteVLCConnectionError):
                player.play(FakeSong())

        self.assertTrue(first.closed)
        self.assertIsNone(player._control_sock)

    def test_end_station_closes_control_socket(self):
        server = ScriptedVLCServer([b"state stopped\n"])
        server.start()
        self.addCleanup(server.stop)

        player = self._make_player(server)
        sock = player._control_sock
        self.assertNotEqual(sock.fileno(), -1)

        with self.assertRaises(StopIteration):
            player.end_station()

        self.assertIsNone(player._control_sock)
        self.assertEqual(sock.fileno(), -1)
        # Closing again must be a harmless no-op.
        player.close()

    def test_destructor_does_not_leak_or_raise(self):
        server = ScriptedVLCServer([b"state stopped\n"])
        server.start()
        self.addCleanup(server.stop)

        host, port = server.address
        player = RemoteVLC(
            host, port, make_callbacks(), LineSocket(self.control_a)
        )
        sock = player._control_sock
        player.__del__()
        self.assertEqual(sock.fileno(), -1)
        self.assertIsNone(player._control_sock)

    def test_user_input_still_processed_after_reconnect(self):
        # Connection one delivers an idle status then dies; connection two
        # holds open long enough for a key press to be polled before the
        # stopped state ends the song.
        server = ScriptedVLCServer(
            [
                b"status: ( new input: song )\n",
                [(0.75, b"state stopped\n")],
            ]
        )
        server.start()
        self.addCleanup(server.stop)

        player = self._make_player(server)

        def drive_input():
            # Wait until the reconnect has swapped in a fresh socket, then
            # deliver a key press through the real control channel.
            deadline = time.time() + 10
            original = None
            while time.time() < deadline:
                current = player._control_sock
                if original is None and current is not None:
                    original = current
                if original is not None and current is not original:
                    break
                time.sleep(0.05)
            self.control_b.sendall(b"n\n")

        driver = threading.Thread(target=drive_input, daemon=True)
        driver.start()
        song = FakeSong()
        player.play(song)
        driver.join(timeout=10)

        player._callbacks.input.assert_called_once_with("n", song)
        self.assertEqual(server.connections, 2)

    def test_load_failure_triggers_reconnect_without_duplicate_add(self):
        first = FakeSocket(name="first")
        replacement = FakeSocket(name="replacement")
        sockets = iter([first, replacement])

        def fake_create_connection(address):
            return next(sockets)

        player = self._make_fake_player(first, fake_create_connection)

        # The very first command (the track load) hits a dead socket.
        first._send_error = BrokenPipeError("broken pipe")
        replacement._recv_data = b"state stopped\n"

        with patch.object(
            audio_backend.select, "select", side_effect=self._fake_select
        ):
            player.play(FakeSong())

        self.assertIs(player._control_sock, replacement)
        self.assertTrue(first.closed)
        self.assertEqual(
            [line for line in replacement.sent if line.startswith(b"add ")],
            [b"add http://example.example/song.mp3\n"],
        )
        player._callbacks.play.assert_called_once()

    def test_stop_after_close_does_not_force_reconnect(self):
        first = FakeSocket(name="first")
        calls = {"count": 0}

        def factory(address):
            calls["count"] += 1
            if calls["count"] == 1:
                return first
            raise AssertionError("stop() must not reconnect after close")

        player = self._make_fake_player(first, factory)
        player.close()
        self.assertIsNone(player._control_sock)

        # Must return quietly rather than reconnecting or raising.
        player.stop()
        self.assertIsNone(player._control_sock)

    def test_stop_sends_command_while_connected(self):
        first = FakeSocket(name="first")
        player = self._make_fake_player(first, lambda address: first)
        player.stop()
        self.assertIn(b"stop\n", first.sent)

    def test_blocking_io_error_on_read_is_not_a_disconnect(self):
        first = FakeSocket(recv_error=BlockingIOError())
        calls = {"count": 0}

        def factory(address):
            calls["count"] += 1
            return first if calls["count"] == 1 else FakeSocket()

        player = self._make_fake_player(first, factory)
        player._current_song = FakeSong()

        # select said the socket was readable but the non-blocking recv has
        # nothing yet: the loop simply continues without reconnecting.
        self.assertEqual(player._read_from_process(first), b"")
        self.assertIs(player._control_sock, first)

    def test_recv_error_treated_as_dead_connection(self):
        first = FakeSocket(recv_error=ConnectionResetError("reset"))
        replacement = FakeSocket(recv_data=b"state stopped\n")
        sockets = iter([first, replacement])

        player = self._make_fake_player(first, lambda address: next(sockets))
        player._current_song = FakeSong()

        # A non-peer-close OSError still forces a rebuild of the connection.
        self.assertEqual(player._read_from_process(first), b"")
        self.assertIs(player._control_sock, replacement)
        self.assertTrue(first.closed)

    def test_raw_send_without_socket_runs_reconnect_path(self):
        first = FakeSocket(name="first")
        replacement = FakeSocket(recv_data=b"state stopped\n")
        sockets = iter([first, replacement])

        player = self._make_fake_player(first, lambda address: next(sockets))
        player._current_song = FakeSong()
        player.close()

        # A generic command with no open socket reconnects then succeeds.
        player._send_cmd("status")
        self.assertIs(player._control_sock, replacement)
        self.assertIn(b"status\n", replacement.sent)

    def test_send_retry_failure_raises_connection_error(self):
        first = FakeSocket(name="first")
        calls = {"count": 0}

        def factory(address):
            calls["count"] += 1
            if calls["count"] == 1:
                return first
            # Reconnect succeeds but the retried write also fails.
            return FakeSocket(send_error=BrokenPipeError("dead"))

        player = self._make_fake_player(first, factory)
        player.RECONNECT_ATTEMPTS = 1
        # The first write fails outright; the reconnect gives a fresh socket
        # whose write fails again, which must surface as a PlayerException.
        first._send_error = BrokenPipeError("dead")

        with self.assertRaises(RemoteVLCConnectionError) as ctx:
            player._send_cmd("status")

        self.assertIn("127.0.0.1:9999", str(ctx.exception))

    def test_reload_track_skipped_without_current_song(self):
        first = FakeSocket(name="first")
        player = self._make_fake_player(first, lambda address: first)
        player._current_song = None
        # Must not send anything and must not raise.
        player._reload_track()
        self.assertEqual(first.sent, [])

    def test_close_swallows_socket_close_error(self):
        first = FakeSocket(close_error=OSError("already gone"), name="first")
        calls = {"count": 0}

        def factory(address):
            calls["count"] += 1
            if calls["count"] == 1:
                return first
            raise AssertionError("unexpected extra connection")

        player = self._make_fake_player(first, factory)
        player.close()
        self.assertTrue(first.closed)
        self.assertIsNone(player._control_sock)

    def test_post_start_is_a_noop_for_network_vlc(self):
        first = FakeSocket(name="first")
        player = self._make_fake_player(first, lambda address: first)
        # Must simply return; there is no local process to configure.
        self.assertIsNone(player._post_start())

    def test_destructor_swallows_close_failure(self):
        first = FakeSocket(name="first")
        calls = {"count": 0}

        def factory(address):
            calls["count"] += 1
            return first if calls["count"] == 1 else FakeSocket()

        player = self._make_fake_player(first, factory)
        player._close_socket()
        self.assertIsNone(player._control_sock)

        # Simulate an unexpected error during teardown; a destructor must
        # never let it propagate into the interpreter.
        def exploding_close():
            raise RuntimeError("teardown")

        player.close = exploding_close
        player.__del__()
        self.assertIsNone(player._control_sock)

    def test_initial_connection_failure_is_player_unusable(self):
        with patch.object(
            audio_backend.socket,
            "create_connection",
            side_effect=ConnectionRefusedError("refused"),
        ):
            with self.assertRaises(PlayerUnusable):
                RemoteVLC(
                    "127.0.0.1",
                    9999,
                    make_callbacks(),
                    LineSocket(self.control_a),
                )
