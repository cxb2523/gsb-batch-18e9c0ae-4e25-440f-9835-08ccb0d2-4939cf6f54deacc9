"""Touch-control logic: turns the page's thumb stick, jump and camera buttons into the game's own movement and camera calls."""
import os
import sys
import time
import traceback


def _input_state():
    from direct.showbase.InputStateGlobal import inputState
    return inputState


_dirs = {"forward": False, "reverse": False, "turnLeft": False, "turnRight": False}
_dir_keys = {"forward": ("arrow_up", "w"), "reverse": ("arrow_down", "s"),
             "turnLeft": ("arrow_left", "a"), "turnRight": ("arrow_right", "d")}

# ---- the page going away (phone switched to another app, screen locked) ------------------------------
# The browser stops delivering touch events the moment the page is hidden, so a thumb that was resting on the stick or
# on JUMP/ACTION never produces its release and the game would keep that button held. While the page is away (and until
# the game lets the player walk again) every press is ignored and everything is let go; on the way back the controls
# start from a clean state, so nothing is held over from the old session.
_page = {"visible": True, "suspended": False, "resumed": False}


def _press_allowed():
    """Whether a new press may reach the game right now. Releases always go through, so a button can never stay stuck."""
    return not _page["suspended"]


# The keys the game currently believes are held because of a touch input. Several inputs can share one key (the stick's
# turn-left and the tug-of-war left button both send A / Left), and two paths can try to let go of the same input (the
# page going away and the controls being hidden). Diffing against this set means each key is sent down (and up) exactly
# once no matter how many inputs or paths want it, so nothing is ever released twice or left down.
_keys_down = set()


def _sync_keys():
    """Send only the key events the touch inputs' current state calls for: keys newly wanted go down, keys no longer
    wanted come up. Releases are worked out from the remembered input state alone, so they still go out when the game
    object that wanted a key has already gone (a crane finished, a minigame ended, a reconnect reset the world)."""
    want = set()
    for name, on in _dirs.items():
        if on:
            want.update(_dir_keys[name])
    if _jump_down[0]:
        want.add("space")
    if _action_down[0]:
        want.add(_action_down[0])
    if _pad_down[0]:
        want.update(("a", "arrow_left"))
    if _pad_down[1]:
        want.update(("d", "arrow_right"))
    up = _keys_down - want
    down = want - _keys_down
    if not (up or down):
        return
    import builtins
    m = getattr(builtins, "messenger", None)
    if m is None:
        return          # nothing can be sent yet: keep the old record so the next call sends the difference
    _keys_down.clear()
    _keys_down.update(want)
    for n in sorted(up):          # let go first, then press: a key swapped in a single step never stays held
        m.send(n + "-up")
    for n in sorted(down):
        m.send(n)


def ui_lost_connection():
    """True while the game shows the "connection lost, try to connect again?" box."""
    try:
        import builtins
        cr = getattr(getattr(builtins, "base", None), "cr", None)
        fsm = getattr(cr, "loginFSM", None)
        st = fsm.getCurrentState() if fsm is not None else None
        return st is not None and st.getName() == "noConnection"
    except BaseException:
        return False


_CHAT_OPEN_STATES = ("normalChat", "whiteListOpenChat", "whiteListAvatarChat", "whiteListPlayerChat",
                     "whisperChat", "whisperChatPlayer")


def _cancel_chat_if_open():
    """Typed chat switches walking off until a message is sent or cancelled, and a phone has no Escape key.
    Touching the joystick or JUMP while it is open closes it and gives walking back."""
    try:
        import builtins
        la = getattr(builtins, "localAvatar", None)
        cm = getattr(la, "chatMgr", None)
        if cm is None:
            return
        st = cm.fsm.getCurrentState().getName()
        if st in _CHAT_OPEN_STATES:
            cm.fsm.request("mainMenu")
            ctl = getattr(la, "controlManager", None)
            # only give walking back if typed chat had taken it (never in the middle of a door, mailbox, etc.)
            if ctl is not None and not getattr(ctl, "isEnabled", 1):
                la.enableAvatarControls()
    except BaseException:
        print("chat cancel error", traceback.format_exc(), flush=True)


_unstick_last = [0.0]


def _unstick_walking():
    """The joystick is only shown while the player may walk. If the game still has walking switched off (seen after
    typed chat and after animated quick chats, until the Shticker Book was opened and closed), switch it back on."""
    try:
        import builtins
        import time
        la = getattr(builtins, "localAvatar", None)
        ctl = getattr(la, "controlManager", None)
        if ctl is None or getattr(ctl, "isEnabled", 1):
            return
        if _place_state() not in ("walk", "swim", "finalBattle") or not _controls_visible():
            return
        now = time.time()
        if now - _unstick_last[0] < 1.0:
            return
        _unstick_last[0] = now
        cm = getattr(la, "chatMgr", None)
        cst = cm.fsm.getCurrentState().getName() if cm is not None and cm.fsm.getCurrentState() is not None else None
        print("walking was off with the joystick showing: re-enabling (chat=%s, emote=%s)" % (cst, getattr(la, "emoteTrack", None) is not None), flush=True)
        la.enableAvatarControls()
    except BaseException:
        print("unstick error", traceback.format_exc(), flush=True)


def ui_move(fwd, back, left, right):
    """Joystick: drive the same input states the arrow keys drive, and send the key events too
    (minigames read W/A/S/D and the arrow keys directly)."""
    try:
        want = (bool(fwd), bool(back), bool(left), bool(right))
        if any(want) and not _press_allowed():
            return          # a press made while the page was away is a leftover, not a new push
        if any(want):
            _cancel_chat_if_open()
            _unstick_walking()
        st = _input_state()
        for name, on in (("forward", want[0]), ("reverse", want[1]), ("turnLeft", want[2]), ("turnRight", want[3])):
            st.set(name, on, "touch")
            _dirs[name] = on
        _sync_keys()
    except BaseException:
        print("ui_move error", traceback.format_exc(), flush=True)


_analog = [0.0, 0.0]       # the thumb stick's own position, -1..1 (x: right is +, y: forward is +); walking speed and turning follow it


def ui_analog(ax, ay):
    if _page["suspended"]:
        ax, ay = 0.0, 0.0       # the page is away or the world is being rebuilt: nothing may push the toon
    _analog[0], _analog[1] = float(ax), float(ay)


_jump_down = [False]


def ui_jump(down):
    try:
        down = bool(down)
        if down and not _press_allowed():
            return
        if down:
            _cancel_chat_if_open()
        _input_state().set("jump", down, "touch")
        _jump_down[0] = down
        _sync_keys()
    except BaseException:
        print("ui_jump error", traceback.format_exc(), flush=True)


# ---- touch UI bridge: camera, action button, chat keyboard ------------------------------------

_entries = []


def _hook_entries():
    """Remember every DirectEntry so the native side can mirror the iOS keyboard into the focused one."""
    import weakref
    from direct.gui import DirectEntry as DE
    cls = DE.DirectEntry
    if getattr(cls, "_ios_hooked", False):
        return
    orig = cls.__init__

    def init(self, *a, **k):
        orig(self, *a, **k)
        _entries.append(weakref.ref(self))
    cls.__init__ = init
    cls._ios_hooked = True


def _focused_entry():
    found = None
    alive = []
    for r in _entries:
        e = r()
        if e is None:
            continue
        alive.append(r)
        try:
            if not e.isEmpty() and e.guiItem.getFocus() and not e.isHidden():
                found = e
        except BaseException:
            pass
    _entries[:] = alive
    return found


def ui_text_state():
    """'1|text' while a game text box has focus (native shows the keyboard), else '0|'."""
    try:
        e = _focused_entry()
        if e is None:
            return "0|"
        return "1|" + _plain_text(e).replace(chr(10), " ")
    except BaseException:
        return "0|"


def _plain_text(e):
    """The entry's text without its formatting: the chat box colours words that are not on the whitelist red by wrapping them in
    \\x01WLEnter\\x01 ... \\x02, which must never reach the page (it came back as the literal word "WLEnter")."""
    try:
        return e.get(plain=True)
    except TypeError:
        import re
        return re.sub("\x01[^\x01]*\x01|\x02", "", e.get())


def _refilter(e):
    """After the page sets the chat text, colour it again and decide again whether it may be sent, as typing in the box would."""
    try:
        import builtins
        cm = getattr(getattr(builtins, "localAvatar", None), "chatMgr", None)
        wl = getattr(cm, "chatInputWhiteList", None)
        if wl is not None and getattr(wl, "chatEntry", None) is e:
            wl.applyFilter(None)
    except BaseException:
        print("chat refilter error", traceback.format_exc(), flush=True)


def ui_text_set(text):
    try:
        e = _focused_entry()
        if e is not None:
            e.set(text)
            _refilter(e)
    except BaseException:
        print("ui_text_set error", traceback.format_exc(), flush=True)


def ui_text_submit():
    try:
        e = _focused_entry()
        if e is not None:
            e.commandFunc(None)
    except BaseException:
        print("ui_text_submit error", traceback.format_exc(), flush=True)


def ui_camera():
    """Camera button: the same as the Tab key (next camera position)."""
    try:
        import builtins
        la = getattr(builtins, "localAvatar", None)
        if la is not None:
            la.nextCameraPos(1)
    except BaseException:
        print("ui_camera error", traceback.format_exc(), flush=True)


_ACTION_NAMES = ("control", "delete", "insert", "alt")
_ACTION_OWNERS = {
    "DistributedCashbotBossCrane", "DistCogdoCrane", "DistributedBanquetTable", "DistributedGolfSpot",
    "DistributedVehicle", "DistributedCannonGame", "DistributedCogThiefGame", "DistributedPairingGame",
    "CogdoMazeLocalPlayer", "CogdoFlyingLocalPlayer", "DistributedPartyTrampolineActivity",
    "DistributedToonfestTrampolineActivity", "DistributedIceGame",
    "ArrowKeys",            # minigames that read the arrow keys and Control (vine swinging jumps with Control)
}
_action_down = [None]


def _pies_ready():
    """True while the local toon may throw pies (boss battles, Field Offices) and has some left."""
    import builtins
    la = getattr(builtins, "localAvatar", None)
    return bool(la is not None and getattr(la, "allowPies", 0) and getattr(la, "numPies", 0) > 0)


def _action_key():
    """The key some game object (crane, banquet table, minigame...) is listening for, ignoring the plain
    movement/jump input that always listens to Control."""
    import builtins
    m = getattr(builtins, "messenger", None)
    if m is None:
        return None
    # the game's own key first: the arrow-key walker also takes Control (jump), which in the card matching game would
    # win over the Delete/Insert that flips a card; the walker's Control is only the answer when nothing else listens
    for owners in ([o for o in _ACTION_OWNERS if o != "ArrowKeys"], ("ArrowKeys",)):
        # Boss and Field Office pie throwing: the local toon itself listens for Delete/Insert (as time-delete, so whoAccepts misses it).
        # Hold to charge, release to throw, the same as the key. Beats the walker's plain Control (jump).
        if owners == ("ArrowKeys",) and _pies_ready():
            return "delete"
        for name in _ACTION_NAMES:
            who = m.whoAccepts(name)
            if not who:
                continue
            for entry in list(who.values()):
                owner = getattr(entry[0], "__self__", None)
                if owner is None:
                    continue
                # only the specific cranes, tables and minigames that really use an action key
                if any(c.__name__ in owners for c in type(owner).__mro__):
                    return name
    return None


def ui_action_available():
    try:
        return 1 if _action_key() else 0
    except BaseException:
        return 0


def _slingshot_active():
    """True while the Toon Slingshot minigame runs: there the parachute opens with "down" (down arrow / joystick back), not Control."""
    import builtins
    cr = getattr(getattr(builtins, "base", None), "cr", None)
    for do in list(getattr(cr, "doId2do", {}).values()):
        if type(do).__name__ == "DistributedTargetGame":
            return True
    return False


def ui_action(down):
    """ACTION button: press the key the current game is waiting for (Control, Delete, Insert or Alt)."""
    try:
        if down:
            if not _press_allowed() or _action_down[0] is not None:
                return          # a press while away is a leftover; a repeated press keeps the key it already sent
            _action_down[0] = "arrow_down" if _slingshot_active() else (_action_key() or "control")
        else:
            # The object that wanted the key may be gone by the time the button is let go (crane finished, game ended,
            # reconnect reset the world). The release is worked out from the remembered key alone, so it still goes out;
            # if the press never happened (already released, or released while away) there is nothing to send.
            _action_down[0] = None
        _sync_keys()
    except BaseException:
        print("ui_action error", traceback.format_exc(), flush=True)


def ui_tug_active():
    """1 while the tug-of-war minigame is being played (it needs fast alternating left/right presses)."""
    try:
        import builtins
        cr = getattr(getattr(builtins, "base", None), "cr", None)
        if cr is None:
            return 0
        for do in list(cr.doId2do.values()):
            if type(do).__name__ == "DistributedTugOfWarGame" and getattr(do, "arrowKeys", None):
                return 1
    except BaseException:
        pass
    return 0


_pad_down = [False, False]


def ui_pad(side, down):
    """Tug-of-war buttons: side 0 = left (A), 1 = right (D)."""
    try:
        if side not in (0, 1):
            return
        down = bool(down)
        if down and not _press_allowed():
            return
        _pad_down[side] = down
        _sync_keys()
    except BaseException:
        print("ui_pad error", traceback.format_exc(), flush=True)

def _arrowkeys_active():
    """True while a minigame's ArrowKeys helper (W/A/S/D + Space) is listening."""
    import builtins
    m = getattr(builtins, "messenger", None)
    if m is None:
        return False
    for name in ("a", "d", "w", "s", "arrow_left", "arrow_right", "arrow_up", "arrow_down"):       # (Open Toontown's helper listens to the arrow keys)
        who = m.whoAccepts(name)
        if not who:
            continue
        for entry in list(who.values()):
            owner = getattr(entry[0], "__self__", None)
            if owner is not None and type(owner).__name__ == "ArrowKeys":
                return True
    return False


_last_ui_state = [None]


def _place_state():
    """Name of the current place state ('walk', 'stopped', 'stickerBook', ...), or None."""
    import builtins
    cr = getattr(getattr(builtins, "base", None), "cr", None)
    pg = getattr(cr, "playGame", None)
    place = getattr(pg, "place", None)
    fsm = getattr(place, "fsm", None)
    st = fsm.getCurrentState() if fsm is not None else None
    return st.getName() if st is not None else None


_vis_prev = [True]
_chat_prev = [None]


def _release_inputs():
    """Let go of every touch input (stick, JUMP, ACTION, both tug-of-war buttons, the analog stick's speed) and send the
    key releases that follow from it. Both ways the controls disappear call this: the page going away and the game
    hiding the controls (door, mailbox, menu, reconnect). Because the key events are diffed against what is actually
    recorded as held, a second release (the other path arriving a moment later) sends nothing, so nothing is let go twice
    or left held."""
    try:
        ui_move(0, 0, 0, 0)
        ui_jump(0)
        ui_action(0)
        ui_pad(0, 0)
        ui_pad(1, 0)
        ui_analog(0.0, 0.0)
    except BaseException:
        print("release inputs error", traceback.format_exc(), flush=True)


def ui_set_page_visible(visible, lost_connection=False, hidden_since_last=False):
    """The page became hidden or visible again (phone switched to another app, screen locked, tab changed).

    Going away: stop taking presses and let go of everything, because the browser will never deliver the releases of
    thumbs still resting on the controls. Coming back: forget any press carried over from the old session and wait for
    the game to be out of the lost-connection box (and to let the player walk again) before taking presses, so the
    controls restart from a clean state instead of finishing a half-done press from before the drop.

    `hidden_since_last` marks the case where the page was hidden and shown again between two polls (the game loop is
    suspended along with the page while hidden, so no poll saw the hidden state): the touch controls still restart from
    clean, even though the page is visible both before and after. Returns True when this call changed anything, so the
    caller can tell the game to give its input focus back too.
    """
    visible = bool(visible)
    changed = visible != _page["visible"]
    _page["visible"] = visible
    if not visible:
        _page["suspended"] = True
        _page["resumed"] = False
        _release_inputs()
        return changed
    if not changed and not _page["suspended"]:
        if not hidden_since_last:
            return False
        # the page is visible before and after, but it really was hidden in between: treat it like a fresh return
    # back on screen: everything is let go already; presses stay off until _resume_touch() says the game is ready
    _page["suspended"] = True
    _page["resumed"] = True
    _release_inputs()
    if not lost_connection:
        _resume_touch()
    return True


def _resume_touch(controls_visible=None):
    """Take presses again, once the page is back on screen, the game is out of the lost-connection box and the player can
    walk or act. `controls_visible` lets a caller that already worked the answer out pass it in."""
    if not _page["resumed"] or not _page["visible"]:
        return
    try:
        if ui_lost_connection():
            return
        if controls_visible is None:
            controls_visible = _controls_visible()
    except BaseException:
        return
    if not controls_visible:
        return
    _page["resumed"] = False
    _page["suspended"] = False
    print("webui: touch controls ready again after coming back", flush=True)


def ui_touch_suspended():
    """True while the touch controls are waiting to restart (page away, connection lost, world being rebuilt)."""
    return bool(_page["suspended"] or not _page["visible"])


def ui_recheck_ready():
    """Called every time the game lets the player walk or act again: if the page came back and the game is ready, the
    touch controls take presses again. Cheap when nothing is waiting."""
    _resume_touch()


def ui_world_reset():
    """The game world is gone or being rebuilt (connection lost, reconnect). Let go of every touch input now and hold
    presses back until the player is out of the lost-connection box and can walk again. Safe to call more than once;
    a second call sends nothing the first one already released."""
    _page["resumed"] = True
    _page["suspended"] = True
    _release_inputs()


def ui_world_ready():
    """The player is back in a rebuilt world after a reconnect: let go of anything still held (the world that wanted it
    is gone) and take presses again from a clean state when the game lets them walk."""
    _page["resumed"] = True
    _page["suspended"] = True
    _release_inputs()
    _resume_touch()


def ui_player_walkable():
    """True when the player is really back in the world (not the sign-in screen, not the lost-connection box)."""
    if ui_lost_connection():
        return False
    try:
        return bool(_controls_visible())
    except BaseException:
        return False


def ui_controls_visible():
    v = _controls_visible()
    if _page["resumed"]:
        _resume_touch(controls_visible=v)
    if _vis_prev[0] and not v:
        _release_inputs()
    _vis_prev[0] = bool(v)
    return v


_movies = {"set": None}


def _cogdo_movie_playing():
    """True while a Field Office intro / outro movie (the Toon Resistance panel) is playing: the buttons would cover its skip button."""
    try:
        if _movies["set"] is None:
            import weakref
            from toontown.cogdominium.CogdoUtil import CogdoGameMovie
            _movies["set"] = weakref.WeakSet()
            orig = CogdoGameMovie.play

            def play(self, *a, **k):
                _movies["set"].add(self)
                return orig(self, *a, **k)
            CogdoGameMovie.play = play
        for m in list(_movies["set"]):
            ival = getattr(m, "_ival", None)
            if ival is not None and ival.isPlaying():
                return True
    except BaseException:
        pass
    return False


def _controls_visible():
    """1 only while the player can actually move or act: hidden on the start screen, avatar chooser, Make-A-Toon
    and in menus/conversations (so the buttons never cover them)."""
    try:
        import builtins
        cr = getattr(getattr(builtins, "base", None), "cr", None)
        if cr is not None and getattr(cr, "avCreate", None):
            return 0
        la = getattr(builtins, "localAvatar", None)
        if la is None:
            return 0
        try:
            from toontown.friends import FriendsListPanel
            if FriendsListPanel.isFriendsListShown():
                return 0   # the friends panel is on the right side, where JUMP and CAM would cover it
        except BaseException:
            pass
        try:
            from otp.avatar import AvatarPanel
            if AvatarPanel.AvatarPanel.currentAvatarPanel is not None:
                return 0   # a friend / toon info panel is open
            from toontown.toon import ToonAvatarDetailPanel
            if ToonAvatarDetailPanel.globalAvatarDetail is not None:
                return 0   # the detailed toon info page is open
        except BaseException:
            pass
        if _cogdo_movie_playing():
            return 0
        cm = getattr(la, "chatMgr", None)
        if cm is not None:
            cst = cm.fsm.getCurrentState()
            cname = cst.getName() if cst is not None else None
            # typed chat switches walking off; leaving it for quick chat (instead of sending/cancelling) never
            # switches it back on, so the toon would not move until the Shticker Book is opened and closed
            if _chat_prev[0] in _CHAT_OPEN_STATES and cname not in _CHAT_OPEN_STATES:
                ctl = getattr(la, "controlManager", None)
                if ctl is not None and not getattr(ctl, "isEnabled", 1) and _place_state() in ("walk", "swim", "finalBattle"):
                    la.enableAvatarControls()
                    print("re-enabled walking after typed chat", flush=True)
            _chat_prev[0] = cname
            if cname in ("speedChat", "whisperSpeedChat", "whisperSpeedChatPlayer"):
                return 0   # the quick chat menu covers the controls' area: keep it tappable
        state = _place_state()
        if state != _last_ui_state[0]:
            _last_ui_state[0] = state
            print("UI place state:", state, flush=True)
        if state in ("walk", "swim", "finalBattle"):
            return 1
        if _action_key() or ui_tug_active() or _arrowkeys_active():
            return 1
        if state is None:
            cm = getattr(la, "controlManager", None)
            return 1 if (cm is not None and getattr(cm, "isEnabled", 0)) else 0
        return 0
    except BaseException:
        return 1

