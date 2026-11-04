package com.kecshow.timer;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A running workout's phase changes, so they are announced with the app closed or the screen off. The page
 * sends the coming changes as JSON ({at, end, kind, title, text, color}); one exact alarm is set for the next
 * change, and each alarm sets the one after it. With the app open, the page plays the sounds itself.
 */
final class Workout {
    static final String FIRE = "com.kecshow.timer.WORKOUT";
    private static final int ID = 0x5770;
    static final long[] VIBRATE_GO = {0, 350};
    static final long[] VIBRATE_REST = {0, 150, 100, 150};
    static final long[] VIBRATE_DONE = {0, 200, 100, 200, 100, 500};

    private Workout() {}

    /** Stores the coming phase changes ("" when no workout is running) and sets an alarm for the next one. */
    static void set(Context c, String json) {
        c.getSharedPreferences("workout", Context.MODE_PRIVATE).edit().putString("plan", json == null ? "" : json).apply();
        armNext(c, System.currentTimeMillis());
    }

    /** An alarm went off: announce the phase that has just started (unless the app is open), then set the next one. */
    static void fire(Context c) {
        JSONArray plan = plan(c);
        if (plan == null) return;
        long now = System.currentTimeMillis();
        JSONObject current = null;
        for (int i = 0; i < plan.length(); i++) {
            JSONObject e = plan.optJSONObject(i);
            if (e != null && e.optLong("at") <= now + 1000) current = e;
        }
        if (current != null && !MainActivity.foreground) announce(c, current);
        armNext(c, now);
    }

    private static void armNext(Context c, long now) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, ID, new Intent(c, AlarmReceiver.class).setAction(FIRE),
                PendingIntent.FLAG_UPDATE_CURRENT | Alarms.FLAG_IMMUTABLE);
        am.cancel(pi);
        JSONArray plan = plan(c);
        if (plan == null) return;
        for (int i = 0; i < plan.length(); i++) {
            JSONObject e = plan.optJSONObject(i);
            long at = e == null ? 0 : e.optLong("at");
            if (at > now + 1000) {
                try {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } catch (SecurityException ex) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
                return;
            }
        }
    }

    private static void announce(Context c, JSONObject e) {
        String kind = e.optString("kind");
        int sound;
        long[] vibrate;
        String channel, name;
        if ("go".equals(kind)) {
            sound = R.raw.w_go; vibrate = VIBRATE_GO; channel = "workout_go"; name = "Workout: round starts";
        } else if ("done".equals(kind)) {
            sound = R.raw.w_done; vibrate = VIBRATE_DONE; channel = "workout_done"; name = "Workout: finished";
        } else {
            sound = R.raw.w_rest; vibrate = VIBRATE_REST; channel = "workout_rest"; name = "Workout: rest starts";
        }
        Uri uri = Uri.parse("android.resource://" + c.getPackageName() + "/" + sound);
        Notification.Builder b = Alarms.builder(c, channel, name, "Beeps when a workout phase starts with the app closed", uri, vibrate)
                .setContentTitle(e.optString("title"))
                .setContentText(e.optString("text"));
        try {
            b.setColor(Color.parseColor(e.optString("color", "#FF8A3D")));
        } catch (IllegalArgumentException ignored) { }
        long end = e.optLong("end", 0);
        if (end > 0) { // the notification counts down to the end of the phase
            b.setWhen(end).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
        } else {
            b.setWhen(System.currentTimeMillis()).setShowWhen(true);
        }
        Alarms.nm(c).notify(ID, b.build());
    }

    private static JSONArray plan(Context c) {
        String s = c.getSharedPreferences("workout", Context.MODE_PRIVATE).getString("plan", "");
        if (s == null || s.isEmpty()) return null;
        try {
            return new JSONArray(s);
        } catch (JSONException e) {
            return null;
        }
    }
}
