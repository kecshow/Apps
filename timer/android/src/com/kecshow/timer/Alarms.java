package com.kecshow.timer;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import java.util.HashSet;
import java.util.Set;

/**
 * System alarms and notifications for timers. Every running timer gets an exact alarm; when it fires with the
 * app in the background, a notification rings with the phone's alarm sound until it is opened or stopped.
 */
final class Alarms {
    static final String FIRE = "com.kecshow.timer.FIRE";
    static final String STOP = "com.kecshow.timer.STOP";
    static final long[] VIBRATE = {0, 600, 400, 600, 400, 600, 1200};
    private static final String CHANNEL = "timer_done";
    private static final String PREFS = "alarms";
    private static final int FLAG_IMMUTABLE = 0x04000000; // PendingIntent.FLAG_IMMUTABLE (API 23)

    private Alarms() {}

    static void schedule(Context c, String id, long endAt, String label) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = broadcast(c, FIRE, id, label, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
        } catch (SecurityException e) {
            // Exact alarms not allowed on this phone: fall back to an alarm that may be a little late.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
        }
    }

    /** Cancels the timer's alarm and removes its notification (which stops the sound). */
    static void cancel(Context c, String id) {
        PendingIntent pi = broadcast(c, FIRE, id, null, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE)).cancel(pi);
            pi.cancel();
        }
        nm(c).cancel(id.hashCode());
    }

    static void cancelAllNotifications(Context c) {
        nm(c).cancelAll();
    }

    static boolean notificationsEnabled(Context c) {
        return nm(c).areNotificationsEnabled();
    }

    /** The notification's Stop button, or swiping it away: remember it so the app resets the timer. */
    static void dismiss(Context c, String id) {
        nm(c).cancel(id.hashCode());
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> ids = new HashSet<String>(p.getStringSet("dismissed", new HashSet<String>()));
        ids.add(id);
        p.edit().putStringSet("dismissed", ids).apply();
    }

    /** Timer ids stopped from a notification since the last call, comma separated. */
    static String takeDismissed(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> ids = p.getStringSet("dismissed", new HashSet<String>());
        p.edit().remove("dismissed").apply();
        StringBuilder sb = new StringBuilder();
        for (String id : ids) {
            if (sb.length() > 0) sb.append(',');
            sb.append(id);
        }
        return sb.toString();
    }

    static void notifyDone(Context c, String id, String label) {
        NotificationManager nm = nm(c);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Timer alarms", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Rings when a timer finishes");
            ch.setSound(alarmSound(), new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            ch.enableVibration(true);
            ch.setVibrationPattern(VIBRATE);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch); // does nothing if it already exists
            b = new Notification.Builder(c, CHANNEL).setTimeoutAfter(10 * 60 * 1000L);
        } else {
            b = new Notification.Builder(c)
                    .setPriority(Notification.PRIORITY_MAX)
                    .setSound(alarmSound(), AudioManager.STREAM_ALARM)
                    .setVibrate(VIBRATE);
        }
        PendingIntent stop = broadcast(c, STOP, id, label, PendingIntent.FLAG_UPDATE_CURRENT);
        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        b.setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(0xFFFF8A3D)
                .setContentTitle("Time's up")
                .setContentText(label == null || label.isEmpty() ? "Timer" : label)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setUsesChronometer(true) // counts the time since it went off
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE))
                .setDeleteIntent(stop)
                .addAction(0, "Stop", stop);
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // repeat the sound until the notification goes away
        nm.notify(id.hashCode(), n);
    }

    /** The phone's alarm sound, or another sound if no alarm sound is set. */
    static Uri alarmSound() {
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return u;
    }

    private static PendingIntent broadcast(Context c, String action, String id, String label, int flags) {
        Intent i = new Intent(c, AlarmReceiver.class)
                .setAction(action)
                .setData(Uri.parse("timer://" + Uri.encode(id))) // one PendingIntent per timer
                .putExtra("id", id)
                .putExtra("label", label);
        return PendingIntent.getBroadcast(c, id.hashCode(), i, flags | FLAG_IMMUTABLE);
    }

    private static NotificationManager nm(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }
}
