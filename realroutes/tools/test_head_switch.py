"""Clean camera-source hand-off for head tracking (head.js <-> headhost).

Run it locally, no real camera, game, BeamDeck helper or face model needed:

    python realroutes/tools/test_head_switch.py
    pytest realroutes/tools/test_head_switch.py

It serves the REAL head.js / headfilter.js from realroutes/ in a headless Chromium and injects:
  * a fake camera   - getUserMedia returns a canvas MediaStream whose track can be observed/stopped,
                      enumerateDevices returns two local cameras;
  * a fake api/head and api/headhost - an in-page fetch fake records every call, can hold api/head
                      requests (in-flight queue test) and serves a scriptable remote host status;
  * a fake face model + a manually pumped requestVideoFrameCallback, so frames/poses are deterministic.

Covered paths: local -> remote, remote -> local, start failure (getUserMedia and hostCmd),
a remote report that the camera stopped/errored, pending-send discard, and filter rebuild.
Exit code 0 only when every check passes.
"""
import json
import os
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# This machine keeps the Playwright browsers under the real user profile; point Playwright there before launch
# when the (possibly redirected) LOCALAPPDATA location has no browser binary.
def _pw_browsers_ok(path):
    try:
        return bool(path) and os.path.isdir(path) and any(
            x.startswith(("chromium-", "chromium_headless_shell-")) for x in os.listdir(path))
    except OSError:
        return False


if not _pw_browsers_ok(os.environ.get("PLAYWRIGHT_BROWSERS_PATH")):
    for _cand in (os.path.join(os.environ.get("USERPROFILE", ""), "AppData", "Local", "ms-playwright"),
                  os.path.join(os.environ.get("LOCALAPPDATA", ""), "ms-playwright"),
                  os.path.expanduser(r"~\AppData\Local\ms-playwright"),
                  r"C:\Users\Administrator\AppData\Local\ms-playwright"):
        if _pw_browsers_ok(_cand):
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = _cand
            break

HERE = os.path.dirname(os.path.abspath(__file__))
REALROUTES = os.path.dirname(HERE)

# --------------------------------------------------------------------------- the test page
# Minimal DOM with every id head.js touches; the real freight.css gives the real .hprev/.off/.remote rules.
HARNESS = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>head switch harness</title>
<link rel="stylesheet" href="/freight.css">
<style>body{background:#fff} #hPrev{width:320px;height:240px}</style>
</head><body>
<section class="view on" id="head">
  <div class="card">
    <select id="hCam"></select><button id="hFindCams">find</button>
    <button id="hStart">Start tracking</button><button id="hCenter">recenter</button><button id="hSweep">sweep</button>
    <div class="hprev off" id="hPrev"><video id="hVideo" playsinline muted></video><canvas id="hCanvas"></canvas></div>
    <div id="hStatus">Tracking is off.</div>
    <div id="hGame"></div>
    <select id="hSize"><option value="320"></option><option value="480"></option><option value="640"></option><option value="1280"></option></select>
    <select id="hFps"><option value="15"></option><option value="20"></option><option value="30"></option><option value="60"></option></select>
    <select id="hProc"><option value="GPU"></option><option value="CPU"></option></select>
    <input type="checkbox" id="hEco"><input type="checkbox" id="hShow">
    <div id="hPresets"><button data-p="gentle"></button><button data-p="standard"></button><button data-p="wide"></button></div>
    <div id="hLive"></div><div id="hSliders"></div>
  </div>
</section>
<button id="fHeadBtn"></button><button id="headBtn"></button><button id="headCenterBtn"></button>
<script src="/headfilter.js"></script>
<script src="/head.js"></script>
</body></html>
"""

# Installed before any page script: fake backend, fake camera, manual frame pump, scriptable face model.
INIT_JS = r"""
(() => {
  try { localStorage.setItem('rrHead', JSON.stringify({
    res: {device:'cam-local-1', size:640, fps:60, proc:'CPU', eco:false, show:true}
  })); } catch (e) {}

  const F = window.__FAKE__ = {
    headCalls: [], headResolvers: [], holdHead: false,
    hostGets: 0, hostCalls: [],
    reports: [], cmdQueue: [], reportSettings: null,
    hostState: {online:true, starting:false, status:{running:true, face:false, fps:30, ms:4, err:0, message:'fake host'}},
    hostStart: {ok:true, online:true},
    gumFail: null, gumCalls: 0,
    detectCalls: 0, detectPose: null,
    lastTrack: null, lastStream: null,
  };

  const J = o => ({ok:true, status:200, json: async()=>o, text: async()=>JSON.stringify(o)});
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '');
    let p; try { p = new URL(url, location.href).pathname; } catch (e) { p = url; }
    const method = (init && init.method) || (input && input.method) || 'GET';
    let body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) {}
    if (/\/api\/headhost\/report$/.test(p)) {
      F.reports.push({status: body ? body.status : null, t: performance.now()});
      return Promise.resolve(J({cmds: F.cmdQueue.splice(0), settings: F.reportSettings}));
    }
    if (/\/api\/headhost$/.test(p)) {
      if (method === 'GET') { F.hostGets++; return Promise.resolve(J(F.hostState)); }
      F.hostCalls.push({body: body || {}, t: performance.now()});
      if (body && body.action === 'start' && F.hostStart && F.hostStart.ok === false)
        return Promise.resolve(J({ok:false, error: F.hostStart.error || 'fake start failure'}));
      return Promise.resolve(J(F.hostStart || {ok:true, online:true}));
    }
    if (/\/api\/head\/probe$/.test(p)) return Promise.resolve(J({ok:true, cam:'fake-cam'}));
    if (/\/api\/head$/.test(p)) {
      F.headCalls.push({body: body || {}, t: performance.now()});
      if (F.holdHead) return new Promise(res => F.headResolvers.push(() => res(J({ok:true}))));
      return Promise.resolve(J({ok:true}));
    }
    if (realFetch) return realFetch(input, init);
    return Promise.resolve(J({}));
  };
  F.releaseHeads = function() { const rs = F.headResolvers.splice(0); rs.forEach(r => { try { r(); } catch (e) {} }); };

  // ---- fake cameras: two named local devices; gUM returns an animated canvas stream ----
  navigator.mediaDevices.enumerateDevices = async () => [
    {kind:'videoinput', deviceId:'cam-local-1', label:'Fake Cam One'},
    {kind:'videoinput', deviceId:'cam-local-2', label:'Fake Cam Two'},
  ];
  function canvasStream() {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d'); let x = 0;
    const iv = setInterval(() => {
      g.fillStyle = '#202840'; g.fillRect(0, 0, 320, 240);
      g.fillStyle = '#f2b134'; g.beginPath(); g.arc(160 + Math.sin(x) * 60, 120, 40, 0, 7); g.fill();
      x += 0.15;
    }, 33);
    const st = c.captureStream(30);
    st.getTracks().forEach(t => t.addEventListener('ended', () => clearInterval(iv)));
    return st;
  }
  const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async function(c) {
    if (F.gumFail) { const e = new Error(F.gumFail.message || 'fake camera failure'); e.name = F.gumFail.name || 'NotAllowedError'; throw e; }
    let st;
    try { st = canvasStream(); } catch (e) { st = await realGUM(c); }
    F.gumCalls++; F.lastStream = st; F.lastTrack = st.getVideoTracks()[0];
    return st;
  };

  // ---- fake ImageCapture for the real headhost.html path: grabFrame yields a drawable bitmap ----
  window.ImageCapture = class {
    constructor(track) { this.track = track; }
    async grabFrame() {
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      const g = c.getContext('2d');
      g.fillStyle = '#101828'; g.fillRect(0, 0, 160, 120);
      g.fillStyle = '#f2b134'; g.beginPath(); g.arc(80, 60, 26, 0, 7); g.fill();
      return await createImageBitmap(c);
    }
  };

  // ---- deterministic frame pump: head.js picks requestVideoFrameCallback when present ----
  const cbs = new Map(); let hid = 1;
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {configurable:true, writable:true,
    value(cb) { const id = hid++; cbs.set(id, cb); return id; }});
  Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', {configurable:true, writable:true,
    value(id) { cbs.delete(id); }});
  F.pumpVideoFrame = function() {
    for (const [id, cb] of Array.from(cbs.entries())) {
      cbs.delete(id);
      try { cb(performance.now(), {}); return true; } catch (e) { F.pumpError = String((e && e.stack) || e); return 'err'; }
    }
    return false;
  };
  F.pumpFrames = async function(n, gapMs) {
    gapMs = gapMs || 20; let sent = 0;
    for (let i = 0; i < n; i++) { if (F.pumpVideoFrame() === true) sent++; await new Promise(r => setTimeout(r, gapMs)); }
    return sent;
  };

  // ---- the scriptable fake face model ----
  function matrix(a, b, c) {
    const D = Math.PI / 180;
    const ca=Math.cos(a*D), sa=Math.sin(a*D), cb=Math.cos(b*D), sb=Math.sin(b*D), cc=Math.cos(c*D), sc=Math.sin(c*D);
    const R = [[ca*cc + sa*sb*sc, -ca*sc + sa*sb*cc, sa*cb],
               [cb*sc, cb*cc, -sb],
               [-sa*cc + ca*sb*sc, sa*sc + ca*sb*cc, ca*cb]];
    const m = new Array(16).fill(0);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[k*4 + r] = R[r][k];
    m[12] = 0; m[13] = 0; m[14] = -40; m[15] = 1;
    return m;
  }
  F.matrix = matrix;
  F.model = {
    close() {},
    detectForVideo() {
      F.detectCalls++;
      const pose = typeof F.detectPose === 'function' ? F.detectPose(F.detectCalls) : F.detectPose;
      if (!pose) return {facialTransformationMatrixes: [], faceLandmarks: [[]]};
      return {facialTransformationMatrixes: [{data: matrix(pose.a || 0, pose.b || 0, pose.c || 0)}], faceLandmarks: [[]]};
    },
  };
})();
"""

# The fake vision_bundle.mjs ensureModel() dynamically imports.
FAKE_VISION_MJS = """
const F = window.__FAKE__;
export class FilesetResolver { static forVisionTasks() { return Promise.resolve({}); } }
export class FaceLandmarker { static createFromOptions() { return Promise.resolve(F.model); } }
"""


# --------------------------------------------------------------------------- tiny static server
class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port=0):
        super().__init__(("127.0.0.1", port), Handler)

    def url(self, path):
        return f"http://127.0.0.1:{self.server_address[1]}{path}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=REALROUTES, **k)

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/harness", "/harness.html"):
            body = HARNESS.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def guess_type(self, path):
        p = path.split("?", 1)[0].lower()
        if p.endswith(".js") or p.endswith(".mjs"):
            return "text/javascript; charset=utf-8"
        return super().guess_type(path)

    def log_message(self, *a):
        pass


# --------------------------------------------------------------------------- scenario driver
class Env:
    def __init__(self, browser, server):
        self.server = server
        self.browser = browser
        self.ctx = browser.new_context()
        self.ctx.add_init_script(INIT_JS)
        self.ctx.route("**/vision_bundle.mjs*",
                       lambda route: route.fulfill(status=200, content_type="text/javascript", body=FAKE_VISION_MJS))
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(server.url("/harness.html"), wait_until="load")
        self.page.wait_for_selector("#hSliders[data-built='1']", timeout=10000)
        self.page.wait_for_function("document.querySelectorAll('#hCam option').length >= 2", timeout=5000)

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass

    def js(self, expr):
        return self.page.evaluate(expr)

    def wait(self, expr, timeout=6000):
        return self.page.wait_for_function(expr, timeout=timeout)

    def sleep(self, s):
        time.sleep(s)

    # -- fake backend access
    def fget(self, key):
        return self.js(f"window.__FAKE__[{json.dumps(key)}]")

    def fset(self, key, value):
        self.page.evaluate("([k,v]) => { window.__FAKE__[k] = v; }", [key, value])

    def head_calls(self):
        return self.js("window.__FAKE__.headCalls")

    def diag(self):
        return self.js("window.headTracker.__diag()")

    def stats(self):
        return self.js("window.headTracker.state().stats")

    # -- UI actions
    def set_cam(self, value):
        # add a pc: option on demand, then go through the real select onchange handler
        self.page.evaluate(
            """(v) => {
                const s = document.getElementById('hCam');
                if (![...s.options].some(o => o.value === v)) s.add(new Option(v, v));
                s.value = v;
                s.dispatchEvent(new Event('change', {bubbles: true}));
            }""", value)

    def click_start(self):
        self.page.click("#hStart")

    def start_local(self, device="cam-local-1"):
        self.set_cam(device)
        self.click_start()
        self.wait("window.headTracker.isRunning() === true", 10000)
        self.wait("document.getElementById('hVideo').readyState >= 2", 5000)

    def start_remote(self, status=None):
        self.fset("hostState", {"online": True, "starting": False,
                                "status": status or {"running": True, "face": True, "fps": 30, "ms": 4, "err": 0}})
        self.set_cam("pc:FakeCam")
        # on an idle page the select only saves the device; on a running one its change event already restarts
        if not self.js("window.headTracker.__diag().hasRun"):
            self.click_start()
        self.wait("window.headTracker.isRunning() === true && window.headTracker.__diag().remote === true", 6000)

    def pump(self, n=12, gap=20):
        return self.page.evaluate("([n,g]) => window.__FAKE__.pumpFrames(n,g)", [n, gap])

    def emit_poses(self, zero=12, move=24):
        self.fset("detectPose", {"a": 0})
        self.pump(zero)
        self.fset("detectPose", {"a": -25})
        self.pump(move)

    def status_text(self):
        return self.js("document.getElementById('hStatus').textContent || ''")

    def status_bad(self):
        return self.js("document.getElementById('hStatus').classList.contains('bad')")

    def ui_running(self):
        return self.js("""(() => {
            const img = document.getElementById('hRemote');
            return {
                headon: document.body.classList.contains('headon'),
                label: document.getElementById('hStart').textContent,
                disabled: document.getElementById('hStart').disabled,
                prevOff: document.getElementById('hPrev').classList.contains('off'),
                remote: document.getElementById('hPrev').classList.contains('remote'),
                remoteImg: !!img,
                remoteImgShown: !!img && getComputedStyle(img).display !== 'none' && img.hasAttribute('src'),
                remoteSrc: img ? img.getAttribute('src') : null,
                videoSrc: !!document.getElementById('hVideo').srcObject,
                centerShown: getComputedStyle(document.getElementById('headCenterBtn')).display !== 'none',
            };
        })()""")


def tempfile_mkdtemp():
    import tempfile
    return tempfile.mkdtemp(prefix="headswitch-edge-")


def launch_browser(pw):
    args = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream", "--no-sandbox"]
    attempts = [
        dict(headless=True, args=args),
        dict(headless=True, channel="chrome", args=args),
        dict(headless=True, channel="msedge", args=args + [f"--user-data-dir={tempfile_mkdtemp()}"]),
    ]
    last = None
    for kw in attempts:
        try:
            return pw.chromium.launch(**kw)
        except Exception as e:  # try the next installed browser
            last = e
    raise last


# --------------------------------------------------------------------------- assertions / scenarios
class Report:
    def __init__(self):
        self.bad = []

    def ok(self, cond, msg):
        print(("PASS " if cond else "FAIL ") + msg)
        if not cond:
            self.bad.append(msg)


def pose_calls(calls):
    return [c for c in calls if "yaw" in (c.get("body") or {})]


def scenario_local_to_remote(e: Env, r: Report):
    print("\n[A1] local camera -> computer (pc:) camera")
    e.start_local()
    e.emit_poses()
    e.wait("window.__FAKE__.headCalls.some(c => 'yaw' in c.body)", 5000)
    sent_old = len(pose_calls(e.head_calls()))
    old_track = e.js("window.__FAKE__.lastTrack.readyState")
    r.ok(sent_old > 0, f"old local session sent poses to api/head ({sent_old} pose calls)")
    r.ok(old_track == "live", f"the fake local video track is live before the switch ({old_track})")

    e.start_remote()
    e.wait("window.__FAKE__.lastTrack.readyState === 'ended'", 3000)
    r.ok(e.js("window.__FAKE__.lastTrack.readyState") == "ended", "switch stops the old camera track")
    r.ok(e.js("window.__FAKE__.pumpVideoFrame()") is False, "the old local frame loop is cancelled (no queued frame callback)")
    r.ok(e.js("document.getElementById('hVideo').srcObject") is None, "the local <video> source is cleared")

    cut = len(e.head_calls())           # the stop reset {on:true} was recorded synchronously in stop()
    e.sleep(1.2)                        # > two 500ms remote polls
    after = e.head_calls()
    r.ok(len(after) == cut, f"old/local side sends no more api/head calls after hand-off ({len(after) - cut} extra)")
    r.ok(len(pose_calls(after[cut:])) == 0, "no old-session pose reaches api/head after the switch")

    st = e.stats()
    r.ok(st.get("sent", 0) == 0 and st.get("frames", 0) >= 0, f"stats belong to the new session, old sent count gone (sent={st.get('sent')})")
    ui = e.ui_running()
    r.ok(ui["headon"] and ui["label"] == "Stop tracking" and not ui["disabled"], "UI is in the running state for the remote source")
    r.ok(e.diag()["remote"] and e.diag()["active"], "headTracker reports an active remote session")
    r.ok(ui["remote"] and ui["remoteImg"] and not ui["prevOff"], "the remote preview surface is shown")
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")


def scenario_remote_to_local(e: Env, r: Report):
    print("\n[A2] computer camera -> local camera (poll timer must die)")
    e.start_remote()
    g0 = e.fget("hostGets")
    e.set_cam("cam-local-2")
    e.wait("window.headTracker.isRunning() === true && window.headTracker.__diag().remote === false", 10000)
    g1 = e.fget("hostGets")
    e.sleep(1.2)
    g2 = e.fget("hostGets")
    r.ok(g2 == g1, f"api/headhost polling stops after switching back ({g1} -> {g2} gets)")
    stops = [c for c in e.fget("hostCalls") if (c.get("body") or {}).get("action") == "stop"]
    r.ok(len(stops) >= 1, "the remote host was sent a stop command")
    ui = e.ui_running()
    r.ok(not ui["remote"] and not ui["remoteImgShown"] and not ui["remoteSrc"], "the remote preview is hidden and its last picture cleared")
    r.ok(ui["videoSrc"] and ui["headon"] and ui["label"] == "Stop tracking", "the new local session owns the preview and running UI")
    r.ok(e.js("window.__FAKE__.lastTrack.readyState") == "live", "the new local camera track is live")

    # the new local loop really produces poses
    e.emit_poses()
    e.wait("window.__FAKE__.headCalls.some(c => 'yaw' in c.body)", 5000)
    r.ok(len(pose_calls(e.head_calls())) > 0, "the new local session sends poses to api/head")
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")


def scenario_start_failure(e: Env, r: Report):
    print("\n[A3a] new LOCAL source fails to start while an old local source runs")
    e.start_local()
    e.emit_poses()
    e.wait("window.__FAKE__.headCalls.some(c => 'yaw' in c.body)", 5000)
    e.fset("gumFail", {"name": "NotAllowedError", "message": "camera blocked by fake test"})
    e.set_cam("cam-bad")
    e.wait("!window.headTracker.isRunning() && !window.headTracker.__diag().starting", 6000)
    e.sleep(0.3)
    txt = e.status_text()
    r.ok("Could not start" in txt and "camera blocked by fake test" in txt, f"status shows the failure reason: {txt!r}")
    r.ok(e.js("window.__FAKE__.lastTrack.readyState") == "ended", "the old camera track was released before the failed start")
    ui = e.ui_running()
    r.ok(not ui["headon"] and ui["label"] == "Start tracking" and not ui["disabled"], "UI is back to the not-running state with an enabled Start button")
    r.ok(ui["prevOff"] and not ui["videoSrc"], "preview is hidden and cleared")
    st = e.stats()
    r.ok(all(st.get(k) == 0 for k in ("frames", "sent", "err", "face")) and st.get("fps") == 0, f"stats are cleared {st}")
    cut = len(e.head_calls())
    e.sleep(0.6)
    r.ok(len(e.head_calls()) == cut, "the dead old session sends nothing more to api/head")
    e.fset("gumFail", None)

    print("\n[A3b] new REMOTE source refuses the start command")
    e.set_cam("cam-local-1")
    e.click_start()
    e.wait("window.headTracker.isRunning() === true", 10000)
    e.fset("hostStart", {"ok": False, "error": "fake computer tracker refused"})
    e.set_cam("pc:BadCam")
    e.wait("!window.headTracker.isRunning() && !window.headTracker.__diag().starting", 6000)
    txt = e.status_text()
    r.ok("fake computer tracker refused" in txt, f"the remote failure reason is shown: {txt!r}")
    ui = e.ui_running()
    r.ok(not ui["headon"] and ui["label"] == "Start tracking" and not ui["disabled"], "no half-running UI after remote start failure")
    r.ok(ui["prevOff"], "no old/new preview stays on screen")
    r.ok(e.js("window.__FAKE__.lastTrack.readyState") == "ended", "the old local track is still stopped")
    e.fset("hostStart", {"ok": True, "online": True})
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")


def scenario_remote_stopped(e: Env, r: Report):
    print("\n[A4] running remote reports running=false")
    e.start_remote(status={"running": True, "face": True, "fps": 30, "ms": 4})
    g0 = e.fget("hostGets")
    e.fset("hostState", {"online": True, "status": {"running": False, "bad": False, "message": "Fake computer camera unplugged"}})
    e.wait("!window.headTracker.isRunning() && !window.headTracker.__diag().starting", 4000)
    txt = e.status_text()
    r.ok("unplugged" in txt, f"the remote stop reason ends the page session: {txt!r}")
    g1 = e.fget("hostGets")
    e.sleep(1.2)
    g2 = e.fget("hostGets")
    r.ok(g2 == g1, f"polling is cleared after the remote ended ({g1} -> {g2}; before report {g0})")
    ui = e.ui_running()
    r.ok(not ui["headon"] and ui["label"] == "Start tracking", "UI returns to not-running")
    r.ok(ui["prevOff"] and not ui["remoteImgShown"] and not ui["remoteSrc"], "remote preview is cleared/hidden")
    st = e.stats()
    r.ok(all(st.get(k) == 0 for k in ("frames", "sent", "err")) and st.get("fps") == 0, f"stats are cleared {st}")

    print("\n[A4b] running remote reports bad=true while still marked running")
    e.start_remote(status={"running": True, "face": True})
    e.fset("hostState", {"online": True, "status": {"running": True, "bad": True, "message": "Fake face model crashed"}})
    e.wait("!window.headTracker.isRunning()", 4000)
    r.ok("crashed" in e.status_text() and e.status_bad(), f"the remote error ends the session and is styled bad: {e.status_text()!r}")
    r.ok(not e.ui_running()["headon"], "headon class removed after remote error")
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")

    print("\n[A4c] remote reports running=false without a preceding running=true (start-status race)")
    e.fset("hostState", {"online": True, "status": {"running": False, "bad": False, "message": "Fake host says stopped from the first poll"}})
    e.set_cam("pc:DirectStop")
    e.click_start()
    e.wait("window.headTracker.isRunning() === true", 4000)
    # tolerated briefly as a stale pre-start status, then it must end the session rather than run forever
    e.wait("!window.headTracker.isRunning()", 6000)
    r.ok("first poll" in e.status_text() or "stopped" in e.status_text().lower(), f"the direct stop report ends the session with its reason: {e.status_text()!r}")
    r.ok(not e.ui_running()["headon"], "UI is not left running for a host that reports stopped")
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")


def scenario_pending_discard(e: Env, r: Report):
    print("\n[A6] stop while an api/head request is in flight: pending pose is discarded")
    e.start_local()
    e.fset("holdHead", True)
    e.fset("detectPose", {"a": 0})
    e.pump(12)
    e.wait("window.headTracker.__diag().inFlight === true", 5000)
    e.pump(4)
    e.wait("window.headTracker.__diag().pending === true", 3000)
    pose_before = len(pose_calls(e.head_calls()))
    r.ok(pose_before == 1, f"exactly one pose request is in flight and the newest is pending ({pose_before})")

    e.js("window.headTracker.stop()")
    d = e.diag()
    r.ok(not d["hasRun"] and not d["pending"], "stop drops the session and clears the pending pose")
    cut = len(e.head_calls())
    e.js("window.__FAKE__.releaseHeads()")
    e.sleep(0.6)
    calls = e.head_calls()
    r.ok(len(calls) == cut, f"releasing the in-flight request triggers no replacement send ({len(calls) - cut} new calls)")
    r.ok(len(pose_calls(calls)) == 1, "the pending old-session pose was never sent")
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")


def scenario_headhost_queue(env: Env, r: Report):
    print("\n[A6h] real headhost.html: stop discards its unsent queued pose too")
    page = env.ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    try:
        page.goto(env.server.url("/headhost.html"), wait_until="load")
        page.wait_for_function("!!window.HeadFilter && !!window.__FAKE__", timeout=6000)
        page.evaluate("() => { window.__FAKE__.holdHead = true; window.__FAKE__.detectPose = {a: 0}; "
                      "window.__FAKE__.cmdQueue.push({action:'start', camera:'Fake Cam One'}); }")
        page.wait_for_function("window.__FAKE__.reports.some(x => x.status && x.status.running === true)", timeout=12000)
        page.wait_for_function("window.__FAKE__.headCalls.filter(c => 'yaw' in c.body).length === 1", timeout=8000)
        time.sleep(0.6)   # let more frames pile a newest pose into the pending slot behind the held request

        page.evaluate("() => window.__FAKE__.cmdQueue.push({action:'stop'})")
        page.wait_for_function("window.__FAKE__.reports.some(x => x.status && x.status.running === false)", timeout=6000)
        page.wait_for_function("window.__FAKE__.lastTrack && window.__FAKE__.lastTrack.readyState === 'ended'", timeout=3000)
        r.ok(True, "headhost started, processed stop, and released its camera track")

        cut = page.evaluate("window.__FAKE__.headCalls.length")
        page.evaluate("window.__FAKE__.releaseHeads()")
        time.sleep(0.8)
        after = page.evaluate("window.__FAKE__.headCalls")
        r.ok(len(after) == cut, f"releasing headhost's held request sends no queued pose afterwards ({len(after) - cut} new api/head calls)")
        r.ok(len(pose_calls(after)) == 1, "the headhost pending pose was discarded; only the in-flight pose was sent")
        last_report_running = page.evaluate("window.__FAKE__.reports[window.__FAKE__.reports.length-1].status.running")
        r.ok(last_report_running is False, "headhost reports itself stopped to api/headhost/report")
        r.ok(not errs, f"no JavaScript errors in headhost.html ({errs[:1]})")
    finally:
        page.close()


def scenario_filter_rebuild(e: Env, r: Report):
    print("\n[A5] filter rebuilt with current sensitivity, fresh centre per session")
    # old session: coarse gain and establish a centre
    e.js("headTracker.set('yaw.gain', 6); headTracker.set('curve', 0); headTracker.set('deadzone', 0)")
    e.start_local("cam-local-1")
    e.fset("detectPose", {"a": 0})
    e.pump(12)
    e.wait("!!window.headTracker.__diag().filterCenter", 4000)
    old_center = e.diag()["filterCenter"]
    r.ok(old_center is not None, "the old session established its centring baseline")

    # change sensitivity, then switch to the other local camera
    e.js("headTracker.set('yaw.gain', 2)")
    e.set_cam("cam-local-2")
    e.wait("window.headTracker.isRunning() === true", 10000)
    e.sleep(0.2)
    d0 = e.diag()
    r.ok(d0["filterCenter"] is None and abs(d0["filterGain"] - 2) < 1e-9,
         f"the new session has no inherited centre and uses the current gain ({d0['filterGain']})")

    # a new centre is built from the new session's own first steady frames
    e.fset("detectPose", {"a": 0})
    e.pump(12)
    e.wait("!!window.headTracker.__diag().filterCenter", 4000)
    r.ok(e.diag()["filterCenter"] is not None, "the new session builds a fresh centre")

    # 10 degrees of head yaw with gain 2 / no curve / no dead-zone -> about 20 degrees of view
    e.fset("detectPose", {"a": -10})
    e.pump(28)
    ys = [c["body"]["yaw"] for c in pose_calls(e.head_calls()) if abs(c["body"].get("yaw", 0)) > 0.5]
    r.ok(bool(ys) and max(ys[-8:]) > 14, f"new poses follow the current gain 2 (recent yaw values {[round(y,1) for y in ys[-5:]]})")

    # a settings edit while running reaches the live filter immediately (then restore gain 2)
    e.js("headTracker.set('yaw.gain', 3.5)")
    r.ok(abs(e.diag()["filterYawGain"] - 3.5) < 1e-9, "a sensitivity edit takes effect on the running filter at once")
    e.js("headTracker.set('yaw.gain', 2)")
    r.ok(not e.errors, f"no JavaScript errors ({e.errors[:1]})")


def run_all():
    r = Report()
    server = Server()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = launch_browser(pw)
            env = None
            try:
                env = Env(browser, server)
                scenario_local_to_remote(env, r)
                env.close()
                env = Env(browser, server)
                scenario_remote_to_local(env, r)
                env.close()
                env = Env(browser, server)
                scenario_start_failure(env, r)
                env.close()
                env = Env(browser, server)
                scenario_remote_stopped(env, r)
                env.close()
                env = Env(browser, server)
                scenario_pending_discard(env, r)
                env.close()
                env = Env(browser, server)
                scenario_filter_rebuild(env, r)
                env.close()
                env = Env(browser, server)
                scenario_headhost_queue(env, r)
            finally:
                try:
                    if env is not None:
                        env.close()
                except Exception:
                    pass
                browser.close()
    except Exception:
        traceback.print_exc()
        r.ok(False, "the test harness itself ran without an exception (see traceback)")
    finally:
        server.shutdown()
        server.server_close()
    print("\n" + ("all head source-switch checks passed" if not r.bad else f"{len(r.bad)} CHECK(S) FAILED"))
    return r.bad


def test_head_switch_paths():
    bad = run_all()
    assert not bad, "failed checks: " + "; ".join(bad)


if __name__ == "__main__":
    sys.exit(1 if run_all() else 0)
