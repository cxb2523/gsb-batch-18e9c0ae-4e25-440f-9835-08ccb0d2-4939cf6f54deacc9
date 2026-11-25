package com.puffsco.toontownanywhere;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Toontown: Anywhere, web wrapper: nothing but the website's own WASM build in a full-screen WebView. It opens the same page the Home Screen app
 * opens, and the page fetches and caches the game files exactly as it does there. Nothing about the game lives here.
 */
public class MainActivity extends Activity {
    private WebView web;
    private final Handler handler = new Handler();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {                   // draw under the camera cut-out; the page keeps its buttons inside env(safe-area-inset-*)
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        web = new WebView(this);
        web.setBackgroundColor(0xFF5A9EF2);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                        // the page keeps its settings and file cache here
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " TTAWebWrap/1");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String host = u.getHost();
                if (host != null && host.endsWith("puffsco.com")) return false;
                String sc = u.getScheme();
                if ("about".equals(sc) || "blob".equals(sc) || "data".equals(sc)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }      // a link to another site opens in the browser
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) handler.postDelayed(new Runnable() { public void run() { load(); } }, 4000);      // no connection: try again
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // the system ended the page's process (almost always memory): start the game page again instead of closing the app
                web.destroy();
                recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {       // the page's alert() / confirm()
            @Override
            public boolean onJsAlert(WebView v, String url, String message, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() { public void onClick(DialogInterface d, int w) { r.confirm(); } }).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, final JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() { public void onClick(DialogInterface d, int w) { r.confirm(); } })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() { public void onClick(DialogInterface d, int w) { r.cancel(); } }).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView v, String url, String message, String def, JsPromptResult r) {
                r.cancel();
                return true;
            }
        });
        setContentView(web);
        immersive();
        load();
    }

    private void load() {
        if (web != null) web.loadUrl(getString(R.string.page_url));
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    private AlertDialog exitDialog;

    @Override
    public void onBackPressed() {
        // the game is one page, so Back asks before leaving instead of closing the game by accident
        if (exitDialog != null && exitDialog.isShowing()) { exitDialog.dismiss(); return; }
        exitDialog = new AlertDialog.Builder(this).setMessage("Exit Toontown: Anywhere?")
            .setPositiveButton("Exit", new DialogInterface.OnClickListener() { public void onClick(DialogInterface d, int w) { finish(); } })
            .setNegativeButton("Stay", null).create();
        exitDialog.setOnDismissListener(new DialogInterface.OnDismissListener() { public void onDismiss(DialogInterface d) { immersive(); } });
        exitDialog.show();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
