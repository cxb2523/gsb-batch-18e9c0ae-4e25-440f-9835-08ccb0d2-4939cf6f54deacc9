/** Pure-caption PiP is available only through the supported native transparent-view path. */
import { nativeApp } from './native.js';
import { setupNativeCaptionPip } from './native-caption-pip.js';
import { toast } from './util.js';
import { errorMessage } from './errors.js';

// One native caption window per page. Opening a new track builds a new controller, so the
// previous one must release its listeners and native session first; otherwise a stale
// instance keeps answering events and its close can tear down the new window.
let current = null;

export function setupAudioPip({ media, engine, app, beforeOpen, releaseLandscape, onStateChange }) {
  const getBridge = () => nativeApp()?.captionPip ?? null;
  let nativePip = null, nativeBridge = null, opening = false, disposed = false;
  const offs = [];
  const supported = () => !!getBridge() || hasSession();
  const isActive = () => !!nativePip?.isActive();
  const hasSession = () => !!nativePip?.hasSession();
  const isBusy = () => !!nativePip?.isBusy();
  const notify = () => {
    if (disposed) return;
    app.classList.toggle('is-audio-pip', isActive());
    onStateChange?.();
    if (isActive()) void releaseLandscape?.();
  };
  // A missing capability must not tear down an already attached native window; only a
  // different (or newly available) bridge forces a rebind.
  const bind = () => {
    if (disposed) return;
    const bridge = getBridge();
    if (bridge && nativePip && nativeBridge !== bridge) { nativePip.dispose?.(); nativePip = null; }
    if (bridge && !nativePip) {
      nativeBridge = bridge;
      nativePip = setupNativeCaptionPip({ bridge, media, engine, onStateChange: notify });
    }
  };
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    offs.push(() => target.removeEventListener(type, handler));
  };

  async function toggle() {
    if (disposed || !supported() || opening || isBusy()) return;
    if (isActive()) { await nativePip.close(); return; }
    if (media.error) { toast('媒体加载失败，请重新加载后再试字幕小窗'); return; }
    if (media.readyState < 2) { toast('媒体正在加载，请稍后再试字幕小窗'); return; }
    opening = true;
    try {
      if (beforeOpen) {
        const result = beforeOpen();
        if (!(result?.then ? await result : result)) return;
      }
      await nativePip.open();
    } catch (error) { toast(errorMessage(error, '字幕小窗启动失败，请重试')); }
    finally { opening = false; }
  }

  const api = {
    toggle, close: () => nativePip?.close() ?? Promise.resolve(true),
    refresh: () => nativePip?.refresh(),
    // 回到前台/原生状态变化后, 用当前媒体位置重新对齐系统时钟.
    resync: () => nativePip?.resync(),
    // 页面卸载或换曲目时释放监听与原生会话, 不让旧实例继续驱动新窗口.
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs.splice(0)) off();
      nativePip?.dispose?.();
      nativePip = null; nativeBridge = null;
      app.classList.remove('is-audio-pip');
      if (current === api) current = null;
    },
    isActive, hasSession, isBusy, supported, ownsActivity: () => false,
    // 诊断用: 卸载后应归零, 换曲/能力变化不应累积监听.
    listenerCount: () => (nativePip?.listenerCount?.() ?? 0) + offs.length,
  };

  // A previous page view's controller may still be listening; retire it before binding ours.
  if (current && current !== api) current.dispose();
  current = api;
  bind();
  listen(window, 'native-caption-capabilities', () => { bind(); notify(); });
  listen(media, 'play', () => { void nativeApp()?.refreshCaptionPip?.(); });
  listen(window, 'pagehide', (event) => {
    // BFCache froze the page but will revive it with the same native window, so keep the
    // session; a real unload releases listeners and the native session.
    if (!event?.persisted) api.dispose();
  });

  return api;
}
