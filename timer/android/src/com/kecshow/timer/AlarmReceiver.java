package com.kecshow.timer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A timer's alarm went off, its notification's Stop button was pressed, or a workout phase changed. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (Workout.FIRE.equals(i.getAction())) {
            Workout.fire(c);
            return;
        }
        String id = i.getStringExtra("id");
        if (id == null) return;
        if (Alarms.STOP.equals(i.getAction())) {
            Alarms.dismiss(c, id);
        } else if (Alarms.FIRE.equals(i.getAction()) && !MainActivity.foreground) {
            // With the app open, the page rings the timer itself.
            Alarms.notifyDone(c, id, i.getStringExtra("label"));
        }
    }
}
