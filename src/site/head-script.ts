import { DEFAULT_LOCALE, ENTERED_KEY, LOCALES, LOCALE_KEY, THEME_KEY } from './i18n'

/**
 * Inline, render-blocking <head> script (runs before first paint):
 * 1. Theme: the stored choice, else the system preference → <html data-theme>. No flash.
 * 2. Language, first visit only: on an English URL, with no stored choice, when the
 *    browser's first supported language is Turkish → location.replace to /tr/….
 *    Turkish URLs never redirect (no loops); crawlers see both languages.
 */
export function headScript(): string {
  const others = LOCALES.filter((l) => l !== DEFAULT_LOCALE)
  return (
    '(function(){try{' +
    `var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
    'if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";' +
    'document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;' +
    `try{if(sessionStorage.getItem(${JSON.stringify(ENTERED_KEY)}))document.documentElement.setAttribute("data-entered","")}catch(e){}` +
    `var o=${JSON.stringify(others)},p=location.pathname,s=p.split("/")[1];` +
    `if(o.indexOf(s)>-1||localStorage.getItem(${JSON.stringify(LOCALE_KEY)}))return;` +
    'var a=navigator.languages||[navigator.language];' +
    'for(var i=0;i<a.length;i++){var l=String(a[i]||"").toLowerCase().split("-")[0];' +
    `if(l===${JSON.stringify(DEFAULT_LOCALE)})return;` +
    'if(o.indexOf(l)>-1){document.documentElement.style.visibility="hidden";' +
    'location.replace("/"+l+(p==="/"?"":p)+location.search+location.hash);return}}' +
    '}catch(e){}})()'
  )
}
