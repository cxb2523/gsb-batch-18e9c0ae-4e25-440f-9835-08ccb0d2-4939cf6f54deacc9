import logging
import os
import select
import socket
import time
from shutil import which

try:
    import fcntl
except ImportError:
    # fcntl is a POSIX-only module, the local VLC backend can not be used
    # without it but the remote (network) backend still works on Windows.
    fcntl = None

from .utils import SilentPopen, iterate_forever

log = logging.getLogger("pydora.audio_backend")


class PlayerException(Exception):
    """Base class for all player exceptions"""

    pass


class UnsupportedEncoding(PlayerException):
    """Song encoding is not supported by player backend"""

    pass


class PlayerUnusable(PlayerException):
    """Player can not be used on this system"""

    pass


class RemoteVLCConnectionError(PlayerException):
    """Remote VLC control connection can not be established or recovered"""

    pass


class BasePlayer:
    """Audio Backend Process Manager

    Starts and owns a handle to an audio backend process then feeds commands to
    it to play pandora audio. This class provides all the base functionality
    for managing the process and feeding it input but should be subclassed to
    fill in the rest of the interface that is specific to a backend.

    Consumers should call start before using the class to pre-start the command
    and decrease response latency when the first play command is sent.
    """

    def __init__(self, callbacks, control_channel):
        """Constructor

        Will attempt to find the player binary on construction and fail if it
        is not found. Subclasses should append any additional arguments to
        _cmd.
        """
        self._control_channel = control_channel
        self._control_fd = control_channel.fileno()
        self._callbacks = callbacks
        self._process = None
        self._cmd = [self._find_path()]

    def _find_path(self):
        """Find the path to the backend binary

        This method may fail with a PlayerUnusable exception in which case the
        consumer should opt for another backend.
        """
        raise NotImplementedError

    def _load_track(self, song):
        """Load a track into the audio backend by song model"""
        raise NotImplementedError

    def _player_stopped(self, value):
        """Determine if player has stopped"""
        raise NotImplementedError

    def raise_volume(self):
        """Raise the volume of the audio output

        The player backend may not support this functionality in which case it
        should not override this method.
        """
        raise NotImplementedError

    def lower_volume(self):
        """Lower the volume of the audio output

        The player backend may not support this functionality in which case it
        should not override this method.
        """
        raise NotImplementedError

    def _post_start(self):
        """Optionally, do something after the audio backend is started"""
        return

    def _loop_hook(self):
        """Optionally, do something each main loop iteration"""
        return

    def _read_from_process(self, handle):
        """Read a line from the process and clean it

        Different audio backends return text in different formats so provides a
        hook for each subclass to customize reader behaviour.
        """
        return handle.readline().strip()

    def _send_cmd(self, cmd):
        """Write command to remote process"""
        self._process.stdin.write(f"{cmd}\n".encode())
        self._process.stdin.flush()

    def stop(self):
        """Stop the currently playing song"""
        self._send_cmd("stop")

    def pause(self):
        """Pause the player"""
        self._send_cmd("pause")

    def __del__(self):
        if self._process:
            self._process.kill()

    def start(self):
        """Start the audio backend process for the player

        This is just a friendlier API for consumers
        """
        self._ensure_started()

    def _ensure_started(self):
        """Ensure player backing process is started"""
        if self._process and self._process.poll() is None:
            return

        if not getattr(self, "_cmd"):
            raise RuntimeError("Player command is not configured")

        log.debug("Starting playback command: %r", self._cmd)
        self._process = SilentPopen(self._cmd)
        self._post_start()

    def _get_select_readers(self):
        """Return a list of file-like objects for reading

        Will be passed to select() to poll for readers.
        """
        return [self._control_channel, self._process.stdout]

    def play(self, song):
        """Play a new song from a Pandora model

        Returns once the stream starts but does not shut down the remote audio
        output backend process. Calls the input callback when the user has
        input.
        """
        self._callbacks.play(song)
        self._load_track(song)
        time.sleep(2)  # Give the backend time to load the track

        while True:
            try:
                self._callbacks.pre_poll()
                self._ensure_started()
                self._loop_hook()

                readers, _, _ = select.select(
                    self._get_select_readers(), [], [], 1
                )

                for handle in readers:
                    if handle.fileno() == self._control_fd:
                        self._callbacks.input(handle.readline().strip(), song)
                    else:
                        value = self._read_from_process(handle)
                        if self._player_stopped(value):
                            return
            finally:
                self._callbacks.post_poll()

    def end_station(self):
        """Stop playing the station"""
        raise StopIteration

    def play_station(self, station):
        """Play the station until something ends it

        This function will run forever until termintated by calling
        end_station.
        """
        for song in iterate_forever(station.get_playlist):
            try:
                self.play(song)
            except StopIteration:
                self.stop()
                return


class MPG123Player(BasePlayer):
    """Player Backend Using mpg123"""

    def __init__(self, callbacks, control_channel):
        super().__init__(callbacks, control_channel)
        self._cmd.extend(["-q", "-R", "--ignore-mime", "."])

    def _find_path(self):
        loc = which("mpg123")
        if not loc:
            raise PlayerUnusable("Unable to find mpg123")

        log.info("Using mpg123 at path %s", loc)
        return loc

    def _load_track(self, song):
        if song.encoding != "mp3":
            raise UnsupportedEncoding("mpg123 only supports mp3 files")

        self._send_cmd(f"load {song.audio_url}")

    def _post_start(self):
        # Only output play status in the player stdout
        self._send_cmd("silence")

    def _player_stopped(self, value):
        return value.startswith(b"@P") and value.decode("utf-8")[3] == "0"

    def raise_volume(self):
        return

    def lower_volume(self):
        return


class VLCPlayer(BasePlayer):
    POLL_INTERVAL = 3
    CHUNK_SIZE = 1024
    VOL_STEPS = 5

    def __init__(self, callbacks, control_channel):
        super().__init__(callbacks, control_channel)
        self._cmd.extend(["-I", "rc", "--advanced", "--rc-fake-tty", "-q"])
        self._last_poll = 0

    def _find_path(self):
        loc = which("vlc")
        if not loc:  # Mac OS X
            loc = which("VLC", path="/Applications/VLC.app/Contents/MacOS")

        if not loc:
            raise PlayerUnusable("Unable to find VLC")

        log.info("Using vlc at location %s", loc)
        return loc

    def raise_volume(self):
        self._send_cmd(f"volup {self.VOL_STEPS}")

    def lower_volume(self):
        self._send_cmd(f"voldown {self.VOL_STEPS}")

    def _post_start(self):
        """Set stdout to non-blocking

        VLC does not always return a newline when reading status so in order to
        be lazy and still use the read API without caring about how much output
        there is we switch stdout to nonblocking mode and just read a large
        chunk of datin order to be lazy and still use the read API without
        caring about how much output there is we switch stdout to nonblocking
        mode and just read a large chunk of data.
        """
        if fcntl is None:
            raise PlayerUnusable(
                "Local VLC requires the POSIX-only fcntl module"
            )

        flags = fcntl.fcntl(self._process.stdout, fcntl.F_GETFL)
        fcntl.fcntl(self._process.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def _read_from_process(self, handle):
        return handle.read(self.CHUNK_SIZE).strip()

    def _load_track(self, song):
        self._send_cmd(f"add {song.audio_url}")

    def _player_stopped(self, value):
        return "state stopped" in value.decode("utf-8")

    def _loop_hook(self):
        if (time.time() - self._last_poll) >= self.POLL_INTERVAL:
            self._send_cmd("status")
            self._last_poll = time.time()


class RemoteVLC(VLCPlayer):
    # Number of times to attempt to rebuild a dead control connection before
    # giving up on the current song.
    RECONNECT_ATTEMPTS = 3
    # Delay between reconnect attempts so we do not hot-loop against a host
    # that is temporarily unreachable.
    RECONNECT_DELAY = 1

    def __init__(self, host, port, callbacks, control_channel):
        self._connect_to = (host, int(port))
        self._control_sock = None
        self._current_song = None
        super().__init__(callbacks, control_channel)

    def _get_select_readers(self):
        return [self._control_channel, self._control_sock]

    def _raw_send(self, cmd):
        """Single best-effort write to the control socket"""
        if self._control_sock is None:
            # An OSError keeps this inside the same reconnect handling as a
            # write to a dead socket rather than becoming an AttributeError.
            raise OSError("Remote VLC control connection is not open")
        self._control_sock.sendall(f"{cmd}\n".encode())

    def _send_cmd(self, cmd):
        """Write a command to the remote VLC, reconnecting once on failure

        A dead socket raises OSError when written to. Treat that as a lost
        control connection, rebuild it, and retry the single command rather
        than letting the exception unwind through the playback loop. Track
        loads are not retried here because _reconnect re-issues them itself.
        """
        try:
            self._raw_send(cmd)
        except OSError:
            log.warning(
                "Lost remote VLC connection while sending, reconnecting"
            )
            self._reconnect()
            try:
                self._raw_send(cmd)
            except OSError as ex:
                raise RemoteVLCConnectionError(
                    f"Unable to send command to remote VLC at "
                    f"{self._connect_to[0]}:{self._connect_to[1]}: {ex}"
                )

    def _read_from_process(self, handle):
        """Read status output, rebuilding the connection if the peer closed

        An empty read means the remote end shut the connection down. On a
        healthy socket a non-blocking recv with no data raises BlockingIOError
        instead, so an empty read is unambiguous.
        """
        try:
            data = handle.recv(self.CHUNK_SIZE).strip()
        except BlockingIOError:
            # Non-blocking socket that is selectable but has no data yet,
            # nothing to do this iteration.
            return b""
        except OSError:
            data = b""

        if not data:
            log.warning("Remote VLC connection closed by peer, reconnecting")
            self._reconnect()

        return data

    def _open_connection(self):
        """Open a new control socket to the configured remote VLC"""
        log.debug("Connecting to remote VLC at %r", self._connect_to)
        sock = socket.create_connection(self._connect_to)
        sock.setblocking(False)
        return sock

    def _close_socket(self):
        """Close and discard the current control socket, if any"""
        if self._control_sock is not None:
            sock = self._control_sock
            # Drop the reference first so a failing close can never leave a
            # stale socket behind that blocks later reconnection or cleanup.
            self._control_sock = None
            try:
                sock.close()
            except OSError:
                pass

    def _reload_track(self):
        """Re-issue the load command for the in-progress track

        OSError is left to propagate so _reconnect treats a failed reload as
        a failed attempt and retries, instead of stacking duplicate adds.
        """
        if self._current_song is None:
            return

        self._raw_send(f"add {self._current_song.audio_url}")

    def _reconnect(self):
        """Rebuild a dead control connection and resume the current song

        Retries the same host:port a bounded number of times. The old socket
        is always closed before opening a replacement so file descriptors do
        not leak. The song-start callback is deliberately not re-invoked; the
        same song simply continues after the load command is re-sent.
        """
        self._close_socket()

        for attempt in range(1, self.RECONNECT_ATTEMPTS + 1):
            try:
                self._control_sock = self._open_connection()
                self._reload_track()
                log.info("Reconnected to remote VLC on attempt %d", attempt)
                return
            except OSError as ex:
                log.warning(
                    "Remote VLC reconnect attempt %d/%d failed: %s",
                    attempt,
                    self.RECONNECT_ATTEMPTS,
                    ex,
                )
                self._close_socket()
                if attempt < self.RECONNECT_ATTEMPTS:
                    time.sleep(self.RECONNECT_DELAY)

        self._close_socket()
        raise RemoteVLCConnectionError(
            f"Unable to reconnect to remote VLC at "
            f"{self._connect_to[0]}:{self._connect_to[1]} after "
            f"{self.RECONNECT_ATTEMPTS} attempts"
        )

    def _ensure_started(self):
        if not self._control_sock:
            try:
                self._control_sock = self._open_connection()
            except OSError as ex:
                raise PlayerUnusable(
                    f"Unable to connect to VLC at "
                    f"{self._connect_to[0]}:{self._connect_to[1]}: {ex}"
                )

    def _load_track(self, song):
        # Remember the song so it can be re-loaded after a reconnect without
        # re-firing the play callback. A dead socket at load time is treated
        # like any other lost connection: rebuild it and let _reconnect issue
        # the add command, so the song is queued exactly once.
        self._current_song = song
        try:
            self._raw_send(f"add {song.audio_url}")
        except OSError:
            self._reconnect()

    def _find_path(self):
        # Construction-time connection failures are fatal and reported as
        # PlayerUnusable so callers can fall back to another backend.
        self._ensure_started()

    def _post_start(self):
        # This is a NOOP for network VLC
        pass

    def stop(self):
        """Stop playback unless the connection has already been released

        end_station closes the socket before the outer play_station loop
        calls stop; trying to send then would needlessly force a reconnect.
        """
        if self._control_sock is None:
            return
        super().stop()

    def end_station(self):
        # The playback loop is about to unwind, release the control socket.
        self.close()
        super().end_station()

    def close(self):
        """Shut down the remote control connection and free its socket"""
        self._close_socket()

    def __del__(self):
        # Never raise from a destructor; the process may be tearing down.
        try:
            self.close()
            super().__del__()
        except Exception:
            pass
