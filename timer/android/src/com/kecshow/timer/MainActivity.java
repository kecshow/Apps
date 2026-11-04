package com.kecshow.timer;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Shows the bundled web app (assets/index.html) and gives it system alarms through window.TimerBridge. */
public class MainActivity extends Activity {
    /** True while the app is on screen. Alarms that fire then are rung by the page instead of a notification. */
    static volatile boolean foreground;

    private WebView web;
    private MediaPlayer player;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // keeps timers and the stopwatch between sessions
        s.setTextZoom(100);             // ignore system font scaling so the layout fits
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(0xFF0D1015);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith("file:///android_asset/");
            }
        });
        web.addJavascriptInterface(new Bridge(), "TimerBridge");
        setContentView(web);
        if (state != null) web.restoreState(state);
        else web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        Alarms.cancelAllNotifications(this); // opening the app silences ringing timers
        web.onResume();
        web.loadUrl("javascript:window.appResumed&&appResumed()");
    }

    @Override
    protected void onPause() {
        foreground = false;
        stopRinging();
        web.loadUrl("javascript:window.appPaused&&appPaused()");
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // The page closes the keypad or goes back to the Timer tab, otherwise it calls exitApp().
        web.loadUrl("javascript:window.appBack?appBack():TimerBridge.exitApp()");
    }

    /** Plays the phone's alarm sound (at alarm volume) and vibrates while a timer rings in the app. */
    private void startRinging() {
        stopRinging();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Uri sound = Alarms.alarmSound();
        if (sound != null) {
            try {
                player = new MediaPlayer();
                player.setDataSource(this, sound);
                player.setAudioStreamType(AudioManager.STREAM_ALARM);
                player.setLooping(true);
                player.prepare();
                player.start();
            } catch (Exception e) {
                if (player != null) player.release();
                player = null;
            }
        }
        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null && v.hasVibrator()) v.vibrate(Alarms.VIBRATE, 1);
    }

    private void stopRinging() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { }
            player.release();
            player = null;
        }
        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null) v.cancel();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !getPreferences(MODE_PRIVATE).getBoolean("askedNotify", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("askedNotify", true).apply();
            try { // Activity.requestPermissions (API 23) is newer than the API stubs this is compiled against
                Activity.class.getMethod("requestPermissions", String[].class, int.class)
                        .invoke(this, new String[] {"android.permission.POST_NOTIFICATIONS"}, 1);
                return;
            } catch (Exception ignored) { }
        }
        // Asked before (or older Android): open this app's notification settings instead.
        Intent i = new Intent("android.settings.APP_NOTIFICATION_SETTINGS")
                .putExtra("android.provider.extra.APP_PACKAGE", getPackageName());
        try {
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent("android.settings.APPLICATION_DETAILS_SETTINGS", Uri.parse("package:" + getPackageName())));
        }
    }

    /** window.TimerBridge. Called by the page on a background thread. */
    private class Bridge {
        @JavascriptInterface
        public void schedule(String id, String endAt, String label) {
            Alarms.schedule(MainActivity.this, id, Long.parseLong(endAt), label);
        }

        @JavascriptInterface
        public void cancel(String id) {
            Alarms.cancel(MainActivity.this, id);
        }

        @JavascriptInterface
        public void ring(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on && foreground) startRinging();
                    else stopRinging();
                }
            });
        }

        @JavascriptInterface
        public String takeDismissed() {
            return Alarms.takeDismissed(MainActivity.this);
        }

        @JavascriptInterface
        public boolean canNotify() {
            return Alarms.notificationsEnabled(MainActivity.this);
        }

        @JavascriptInterface
        public void askNotify() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { askForNotifications(); }
            });
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { moveTaskToBack(true); }
            });
        }
    }
}
