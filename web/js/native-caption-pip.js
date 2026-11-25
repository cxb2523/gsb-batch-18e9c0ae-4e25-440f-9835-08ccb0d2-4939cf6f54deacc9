/** Native subtitles: send the timeline once, then synchronize the native clock.
 *
 *  The native window owns its own clock anchor, so every update we send must be a
 *  *fresh* snapshot of the page media. Two things are easy to get wrong:
 *
 *  * after the page returns from the background the web clock is frozen or
 *    extrapolated from an old anchor; we refresh the media first and force a sync
 *    instead of trusting the throttled last value;
 *  * a queued clock update must never discard a timeline/translation that has not
 *    been confirmed by the native side yet. Pending content is reattached to every
 *    outgoing update until `bridge.update` accepts it.
 *
 *  Events are always matched against the live session id, so a late close/replay
 *  from a retired window cannot end or drive the current one.
 */
import { trackCfg } from './trackcfg.js';
import { pipLines } from './video-pip.js';
import { randomId, toast } from './util.js';
import { mediaControl } from './media-controls.js';

const CLOCK_THROTTLE = 500;
const RESUME_TIMEOUT = 3000;
const MEDIA_EVENTS = ['timeupdate', 'play', 'playing', 'pause', 'ended', 'waiting', 'stalled',
  'seeking', 'seeked', 'ratechange', 'canplay'];

export function setupNativeCaptionPip({ bridge, media, engine, onStateChange }) {
  let session = '', sequence = 0, active = false, opening = false, closing = false;
  let disposed = false, stalled = false, lastSent = -Infinity;
  let inFlight = false, queued = null, queuedSignature = '', resyncToken = 0, resuming = 0;
  // `sentTimeline` is the signature native acknowledged; `contentDirty` says "the live
  // timeline may differ from it". On an unconfirmed push we mark dirty again, so the next
  // sync recomputes the *current* sentences instead of resurrecting a stale snapshot.
  let sentTimeline = '', contentDirty = true, lastTrack = null;
  let originalDisablePip = null;
  let attached = false;
  const offs = [];
  let observer = null;

  // Active means the native window is attached. Permission/startup requests are only busy.
  const isActive = () => active;
  const hasSession = () => active || opening || closing;
  const isBusy = () => opening || closing;
  const buffering = () => stalled || !!media.seeking;
  const state = () => ({ session, sequence: ++sequence,
    nativeAudioSession: media.nativeSession || '',
    position: Number(media.currentTime) || 0,
    duration: Number.isFinite(media.duration) ? media.duration : engine.track?.duration || 0,
    rate: media.playbackRate || 1,
    paused: media.paused || media.ended || buffering(),
    playing: !media.paused && !media.ended,
    captionSize: trackCfg.video.captionSize, showTranslation: document.documentElement.dataset.tr !== '0' });
  const timeline = () => (engine.track?.sentences || []).map((sentence, i) => ({
    start: engine.track.sStart[i], ...pipLines(sentence, true),
  }));

  function clear() {
    if (originalDisablePip !== null) {
      media.disablePictureInPicture = originalDisablePip; originalDisablePip = null;
    }
    session = ''; active = opening = closing = false; queued = null;
    sentTimeline = ''; contentDirty = true; lastTrack = null; resyncToken++;
    onStateChange?.();
  }

  async function send() {
    if (inFlight || !queued) return;
    const next = queued, signature = queuedSignature;
    queued = null; queuedSignature = ''; inFlight = true;
    try {
      await bridge.update(next);
      if (next.session === session && signature) {
        // Compare against what actually went out: a newer local edit may already differ.
        if (JSON.stringify(timeline()) === signature) sentTimeline = signature;
      }
    } catch (error) {
      // Unconfirmed content stays dirty so the next update re-reads the live timeline
      // rather than resurrecting this (possibly already superseded) snapshot.
      if (next.session === session && signature) contentDirty = true;
      console.warn('[caption-pip] 字幕同步失败', error);
    }
    finally { inFlight = false; if (queued) void send(); }
  }

  function sync(force = false, content = false) {
    if (!hasSession() || closing || disposed) return false;
    // While a resume is re-reading the native clock, drop clock traffic: the resume's
    // final forced sync recomputes both the timeline and the media state, so nothing
    // queued here would survive anyway — and a stale position must never be sent.
    if (resuming) return false;
    const now = performance.now();
    if (!force && !content && now - lastSent < CLOCK_THROTTLE) return false;
    lastSent = now;
    // A different track means the whole timeline is stale even without an explicit
    // content refresh, so the next update must carry the new sentences.
    const track = engine.track || null;
    if (track !== lastTrack) { lastTrack = track; content = true; }
    if (content) contentDirty = true;
    const next = state();
    let signature = '';
    if (contentDirty) {
      const sentences = timeline();
      signature = JSON.stringify(sentences);
      if (signature === sentTimeline) contentDirty = false; else next.sentences = sentences;
    }
    queued = next; queuedSignature = signature; void send();
    return true;
  }

  /**
   * 页面/应用回到前台或原生上报状态变化: 先让媒体桥用原生时钟刷新自己, 再按刷新后的
   * 位置、时长、倍速、播放/缓冲状态强制同步, 而不是把后台前的外推锚点继续送过去。
   */
  async function resync() {
    if (disposed || closing || !hasSession()) return false;
    const token = ++resyncToken;
    // Hold outbound clock traffic while the media bridge re-reads the native clock:
    // sending an extrapolated pre-background position would briefly flash the wrong
    // sentence. The forced content sync below carries everything that changed meanwhile.
    resuming++;
    let settle;
    // A bridge that never answers must neither freeze caption updates nor leak this call.
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(resolve, RESUME_TIMEOUT);
      settle = () => { clearTimeout(timer); resolve(); };
    });
    try { await Promise.race([Promise.resolve(media.refresh?.()).catch(() => {}), timeout]); }
    catch { /* 页面可能正在离开, 保留现有状态 */ }
    finally { settle?.(); resuming = Math.max(0, resuming - 1); }
    if (token !== resyncToken || disposed || closing || !hasSession()) return false;
    return sync(true, true);
  }

  async function open() {
    if (disposed || hasSession()) return;
    session = randomId(); sequence = 0; opening = true;
    const current = session;
    // Own the <video> PiP flag only once, so a failed teardown whose close was
    // rejected cannot later be "restored" to true and disable browser PiP forever.
    if (originalDisablePip === null) originalDisablePip = !!media.disablePictureInPicture;
    media.disablePictureInPicture = true;
    sentTimeline = ''; contentDirty = true;
    onStateChange?.();
    const sentences = timeline();
    const signature = JSON.stringify(sentences);
    try {
      await bridge.open({ ...state(), sentences });
      if (session !== current || disposed || closing) {
        await bridge.close({ session: current }); return;
      }
      active = true; opening = false;
      sentTimeline = signature; contentDirty = false;
      sync(true, true); onStateChange?.();
    } catch (error) {
      if (session !== current || closing || disposed) return;
      // Native failure may arrive before its stop animation finishes. Wait for cleanup
      // before offering a retry. The UI maps the preserved error code to actionable guidance.
      closing = true;
      onStateChange?.();
      try {
        await bridge.close({ session: current });
        if (session === current) clear();
      } catch {
        // Teardown was refused (e.g. the window is still on screen). Keep the session
        // so its own close event can release it; the next open reuses the ownership.
        if (session === current) {
          closing = false; opening = false; onStateChange?.();
        }
      }
      throw error;
    }
  }

  async function close() {
    if (!hasSession()) return true;
    const current = session;
    closing = true;
    queued = null; queuedSignature = '';
    onStateChange?.();
    try {
      await bridge.close({ session: current });
      if (session === current) clear(); return true;
    } catch (error) {
      // The matching close event may have already cleared the session while this call
      // was in flight; the window is gone, so report success without a misleading toast.
      if (session !== current) return true;
      // Keep `active` (and the browser-PiP lock) until the matching native close
      // event arrives: the window is still on screen and only the system can end it.
      closing = false; onStateChange?.();
      // A page that is going away cannot show or act on this guidance.
      if (!disposed) toast('无法关闭字幕小窗，请使用系统小窗的关闭按钮');
      return false;
    }
  }

  function onNative({ detail }) {
    // Only the live session may be ended or driven; retired windows are ignored.
    if (disposed || !session || !detail || detail.session !== session) return;
    if (detail.action) {
      if (active && !closing) mediaControl(media, engine, detail.action);
      return;
    }
    if (!detail.active) {
      // During startup the open promise owns failure/cancellation so its error stays visible.
      if (opening && !closing) return;
      clear();
      return;
    }
    active = true;
    if (typeof detail.closing === 'boolean') closing = detail.closing;
    if (!closing) opening = false;
    onStateChange?.();
    // A state report (e.g. the system restored the window) means the native anchor
    // may be stale; resync from the live media clock.
    if (!closing) void resync();
  }

  function onMedia(event) {
    if (event === 'waiting' || event === 'stalled' || event === 'seeking') stalled = true;
    else if (event === 'playing' || event === 'seeked' || event === 'ended' || event === 'canplay') stalled = false;
    sync(event !== 'timeupdate');
  }

  function observe() {
    observer ??= new MutationObserver(() => sync(true, true));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tr'] });
  }
  function stopObserve() { observer?.disconnect(); }

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    offs.push(() => target.removeEventListener(type, handler));
  }

  function attach() {
    if (attached) return;
    attached = true;
    for (const event of MEDIA_EVENTS) listen(media, event, () => onMedia(event));
    listen(window, 'native-caption-pip', onNative);
    // The native shell reports foreground/background transitions that the page does not
    // see; both are a strong hint that the native anchor has drifted from the media clock.
    listen(window, 'native-app-state', ({ detail } = {}) => { if (detail?.active) void resync(); });
    listen(document, 'visibilitychange', () => {
      // Leaving the foreground: send one accurate snapshot. Returning: the page clock
      // may have been frozen while native kept playing, so re-read it before syncing.
      if (document.hidden) sync(true); else void resync();
    });
    listen(window, 'pageshow', () => { if (hasSession()) void resync(); });
    listen(window, 'pagehide', (event) => {
      // BFCache keeps the page (and its native session) alive; unload releases everything.
      if (event?.persisted) return;
      disposed = true; detach(); void close();
    });
    observe();
  }

  function detach() {
    attached = false;
    for (const off of offs.splice(0)) off();
    stopObserve();
  }

  attach();

  return {
    open, close,
    refresh: () => sync(true, true),
    resync,
    // 页面卸载: 释放原生会话与所有监听, 避免旧实例继续驱动已经消失的小窗。
    dispose() {
      if (disposed) return;
      disposed = true; detach(); void close();
    },
    isActive, hasSession, isBusy,
    // 诊断用: 打开/关闭一个会话时不应累积监听.
    listenerCount: () => offs.length,
  };
}
