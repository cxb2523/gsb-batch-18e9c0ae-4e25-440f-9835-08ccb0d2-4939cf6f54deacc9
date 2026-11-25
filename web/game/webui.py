"""Connects the page's touch controls (tta-ui.js) to the game: reads the control state every frame, drives the game through the
functions in webui_core.py, and tells the page what to show."""
import builtins
import json
import platform
import time
import traceback

import webui_core as core

T = platform.window.tta


class _DeviceSettings:
    """The Device page of the sticker book (toontown/shtiker/OptionsPage.py) draws these rows; the page (tta-ui.js) keeps the values and does what
    a choice does (picture quality, smooth edges, the speed counter, other apps' audio, on-screen controls, keyboard keys, notifications)."""

    def rows(self):
        return json.loads(str(T.devRows()))

    def get(self, rowId):
        return str(T.devGet(rowId))

    def set(self, rowId, value):
        T.devSet(rowId, str(value))

    def open(self, what):
        T.devOpen(str(what))

    def restart(self):
        T.devRestart()


try:
    if T.devRows is not None:           # an older page has no such rows: then the sticker book has no Device page
        builtins.ttaDevice = _DeviceSettings()
except BaseException:
    print("webui: device settings not available")
_state = {"vals": (0, 0, 0, 0, 0, 0, 0, 0), "cam": 0, "ui_at": 0.0, "ui": None, "tx_at": 0.0, "tx_on": False, "tx_in": 0, "tx_sub": 0,
          "vis": None, "hide_seq": None, "needs_clear": False, "clear_by": 0.0}
# vis: last page visibility this bridge acted on; hide_seq: the page's counter of hide events, so a hide that happened
# while the game loop itself was frozen (the browser suspends it too) is still noticed on the way back (see
# _page_visibility()). Starting at None means the first poll just records where things already stand.
try:
    core._hook_entries()            # remember the game's text boxes so the page's text bar can fill the focused one
except BaseException:
    print("webui: entry hook failed")
    print(traceback.format_exc())


_rc = {"since": 0.0, "tries": [], "in_lost": False, "booted": None, "told": False, "gave_up": False}

# Thrown out on purpose (100: the same account signed in somewhere else; 127, 152: other server-side kicks): the page
# must not reconnect by itself, or it would fight the player's other device or hammer a server that means "stay out".
_BOOTED_NO_RETRY = (100, 127, 152)
_RETRY_DELAY = 1.5          # seconds to wait before each attempt
_RETRY_WINDOW = 180.0       # attempts count for this long
_MAX_TRIES = 3              # and there are this many of them per window

# The login states that mean the player is on the sign-in / Make-A-Toon screens, i.e. a brand-new session: records of
# retries from the previous session must not count against it.
_NEW_SESSION_STATES = ("login", "create")


def _state_name(fsm):
    st = fsm.getCurrentState() if fsm is not None else None
    return st.getName() if st is not None else None


def _connection_open(cr):
    """True only once the socket really finished opening (not while a reconnect attempt is still dialling)."""
    try:
        wn = getattr(platform.window, "webnet", None)
        st = str(getattr(wn, "state", "") or "")
        if st:
            return st == "open"
    except BaseException:
        pass
    try:
        return bool(cr.isConnected())
    except BaseException:
        return False


def _enter_lost(cr):
    """The game just showed its "connection lost" box: one new drop. The reason is recorded once, at this moment, so a
    later sign-in or a changed bootedIndex can never re-label a drop that already happened."""
    _rc["in_lost"] = True
    _rc["told"] = False
    _rc["since"] = 0.0
    _rc["booted"] = getattr(cr, "bootedIndex", None)
    _rc["gave_up"] = False
    core.ui_world_reset()           # nothing may stay held while the world is being rebuilt


def _note_reconnected():
    """A retry actually got the player back into the world: drop the old retry records so they cannot hold back the next
    drop, and make the touch controls restart from a clean state."""
    tries = len(_rc["tries"])
    _rc["in_lost"] = False
    _rc["told"] = False
    _rc["since"] = 0.0
    _rc["tries"] = []
    _rc["booted"] = None
    _rc["gave_up"] = False
    core.ui_world_ready()
    if tries:
        print("webui: reconnected; retry count and window reset (%d old record(s) dropped)" % tries)


def _clear_retry():
    _rc["in_lost"] = False
    _rc["told"] = False
    _rc["since"] = 0.0
    _rc["tries"] = []
    _rc["booted"] = None
    _rc["gave_up"] = False


def _auto_reconnect():
    """A phone drops the connection when the app is switched away from or the screen locks. When the player comes back and the game shows its
    "connection lost, try to connect again?" box, accept it for them (a few times at most), so they land back in Toontown.

    A dropped network connection is retried: at most _MAX_TRIES times, one per _RETRY_DELAY seconds, counted inside a
    _RETRY_WINDOW that slides forward. Being thrown out by the server (bootedIndex _BOOTED_NO_RETRY) is never retried.
    A reconnect that actually got the player back into the world clears the records, so an old session's attempts cannot
    use up the new session's budget."""
    try:
        import builtins
        b = getattr(builtins, "base", None)
        cr = getattr(b, "cr", None) if b is not None else None
        fsm = getattr(cr, "loginFSM", None) if cr is not None else None
        name = _state_name(fsm)
        lost = name == "noConnection"
        if not lost:
            if _rc["in_lost"]:
                # Left the lost-connection box. A retry that failed and bounced straight back is not a success; only an
                # open socket plus a player who can really walk counts, so counters are not reset by a mere attempt.
                if _connection_open(cr) and core.ui_player_walkable():
                    _note_reconnected()
                elif name in _NEW_SESSION_STATES:
                    _clear_retry()      # back at the sign-in screen: new session, old retry records do not apply
            elif name in _NEW_SESSION_STATES:
                _rc["since"] = 0.0
                if _rc["tries"]:
                    _clear_retry()
            return
        if not _rc["in_lost"]:
            _enter_lost(cr)
        elif _rc["booted"] is None:
            # the reason can be filled in a little after the box appears
            _rc["booted"] = getattr(cr, "bootedIndex", None)
        if not _rc["told"]:
            # once per drop: did the server throw us out (and why), or did the connection just go?
            _rc["told"] = True
            print("webnet: closed, game shows lost connection: booted=%s %s" % (_rc["booted"],
                                                                                  str(getattr(cr, "bootedText", "") or "")[:120]))
        if _rc["booted"] in _BOOTED_NO_RETRY:      # thrown out on purpose: do not retry by ourselves
            return
        if not _page_visibility()[0]:
            return
        now = time.time()
        if not _rc["since"]:
            _rc["since"] = now
            return
        if now - _rc["since"] < _RETRY_DELAY:
            return
        _rc["tries"] = [t for t in _rc["tries"] if now - t < _RETRY_WINDOW]
        if len(_rc["tries"]) >= _MAX_TRIES:
            if not _rc.get("gave_up"):
                _rc["gave_up"] = True
                print("webui: not reconnecting again (already %d attempt(s) in the last %ds)" % (len(_rc["tries"]), int(_RETRY_WINDOW)))
            return
        _rc["gave_up"] = False
        _rc["tries"].append(now)
        _rc["since"] = 0.0
        box = getattr(cr, "lostConnectionBox", None)
        if box is not None:
            box.doneStatus = "ok"
        from direct.showbase.MessengerGlobal import messenger
        messenger.send("lostConnectionAck")
        try:
            T.recoverInput("reconnect")
        except BaseException:
            pass
        print("webui: reconnecting automatically")
    except BaseException:
        print("webui: auto reconnect failed")
        print(traceback.format_exc())


def _page_visibility():
    """Whether the page is on screen, plus the page's count of hide events. The phone stops delivering touch events once
    the page is not on screen, so everything must be let go and nothing pressed until the player is back and the game
    lets them walk again. The count matters because the game loop is itself suspended while the page is hidden: hiding
    and returning can both happen within one poll (the page never seen hidden), but a hide event still happened, so
    anything a thumb left held must be let go. A page that does not keep the count (or an older page) just reports the
    current state."""
    try:
        doc = platform.window.document
        vis = str(doc.visibilityState) != "hidden"
    except BaseException:
        return True, None
    seq = getattr(doc, "ttaHideSeq", None)
    try:
        seq = int(seq) if seq is not None else None
    except BaseException:
        seq = None
    return vis, seq


def poll():
    _auto_reconnect()
    try:
        vis, hide_seq = _page_visibility()
        lost = core.ui_lost_connection()
        first = _state["hide_seq"] is None and _state["vis"] is None
        hidden_since_last = (hide_seq is not None and _state["hide_seq"] is not None
                             and hide_seq != _state["hide_seq"])
        if first:
            # first poll: adopt what is already the case (the game may start while the page is still coming up), but
            # still let go of anything the page says was left held before we started watching
            _state["vis"] = vis
            if not vis:
                core.ui_set_page_visible(vis, lost_connection=lost)
        elif hidden_since_last or not vis or vis != _state["vis"]:
            # hidden now, or it was hidden and is back (whether or not a poll noticed it at the time)
            core.ui_set_page_visible(vis, lost_connection=lost, hidden_since_last=hidden_since_last)
            # The page's flags may still read "pressed" from before the page went away (it may not have had a chance to
            # clear them), because no touch events are delivered while hidden. Until the page reports everything let go
            # once, treat its presses as leftovers: a button that looked held across the trip away is not a new press.
            _state["needs_clear"] = True
            _state["clear_by"] = time.time() + 5.0     # (in case a page build never reports the let-go)
            _state["vals"] = (0,) * 8
            if vis:
                # the page is back: let the game take the keyboard again, and let the touch controls restart once the
                # game is out of the lost-connection box and lets the player walk
                try:
                    T.recoverInput("tab return")
                except BaseException:
                    pass
                core.ui_recheck_ready()
        _state["vis"] = vis
        _state["hide_seq"] = hide_seq
        vals = tuple(int(x) for x in str(T.inp).split(","))
        if _state["needs_clear"]:
            if vals == (0,) * 8 or time.time() >= _state["clear_by"]:
                _state["needs_clear"] = False       # the page has let go: from here on a press is a real new press
            vals = (0,) * 8
        if len(vals) == 8 and vals != _state["vals"]:
            old = _state["vals"]
            if vals[0:4] != old[0:4]:
                core.ui_move(*vals[0:4])
            if vals[4] != old[4]:
                core.ui_jump(vals[4])
            if vals[5] != old[5]:
                core.ui_action(vals[5])
            if vals[6] != old[6]:
                core.ui_pad(0, vals[6])
            if vals[7] != old[7]:
                core.ui_pad(1, vals[7])
        _state["vals"] = vals
        if core.ui_touch_suspended():
            core.ui_recheck_ready()
        if vis and not core.ui_touch_suspended():
            try:
                j = str(T.joy)
                if j and j != _state.get("joy"):
                    _state["joy"] = j
                    a = j.split(",")
                    core.ui_analog(int(a[0]) / 1000.0, int(a[1]) / 1000.0)
            except BaseException:
                pass
        cam = int(T.camN)
        while _state["cam"] < cam:
            _state["cam"] += 1
            if vis and not core.ui_touch_suspended():
                core.ui_camera()
        now = time.time()
        n_in = int(T.txtIn)
        if n_in != _state["tx_in"]:
            _state["tx_in"] = n_in
            core.ui_text_set(str(T.txtVal))
        n_sub = int(T.txtSub)
        if n_sub != _state["tx_sub"]:
            _state["tx_sub"] = n_sub
            core.ui_text_set(str(T.txtVal))
            core.ui_text_submit()
        if now - _state["tx_at"] > 0.12:
            _state["tx_at"] = now
            st = core.ui_text_state()
            on = st.startswith("1")
            if on != _state["tx_on"]:
                _state["tx_on"] = on
                try:
                    import builtins
                    b = builtins.base
                    print("webui: text", on, "win", b.win.getXSize(), b.win.getYSize(), "aspect2d scale", b.aspect2d.getScale())
                except BaseException:
                    pass
                T.setText(1 if on else 0, st[2:])
        if now - _state["ui_at"] > 0.25:
            _state["ui_at"] = now
            ui = (int(core.ui_controls_visible()), int(core.ui_action_available()), int(core.ui_tug_active()))
            if ui != _state["ui"]:
                _state["ui"] = ui
                T.setUI(*ui)
    except BaseException:
        print("webui: poll error")
        print(traceback.format_exc())
