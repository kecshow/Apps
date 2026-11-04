package android.app;

import android.media.AudioAttributes;
import android.net.Uri;

/** API 26. */
public final class NotificationChannel {
    public NotificationChannel(String id, CharSequence name, int importance) { throw new RuntimeException("Stub!"); }
    public void setDescription(String description) { throw new RuntimeException("Stub!"); }
    public void setSound(Uri sound, AudioAttributes audioAttributes) { throw new RuntimeException("Stub!"); }
    public void enableVibration(boolean vibration) { throw new RuntimeException("Stub!"); }
    public void setVibrationPattern(long[] vibrationPattern) { throw new RuntimeException("Stub!"); }
    public void setLockscreenVisibility(int lockscreenVisibility) { throw new RuntimeException("Stub!"); }
}
