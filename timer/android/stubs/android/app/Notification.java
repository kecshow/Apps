package android.app;

import android.content.Context;
import android.net.Uri;

/** The members of android.app.Notification the app uses, up to API 26. */
public class Notification {
    public static final int FLAG_INSISTENT = 4;
    public static final int PRIORITY_MAX = 2;
    public static final String CATEGORY_ALARM = "alarm";   // API 21
    public static final int VISIBILITY_PUBLIC = 1;         // API 21

    public int flags;

    public static class Builder {
        public Builder(Context context) { throw new RuntimeException("Stub!"); }
        public Builder(Context context, String channelId) { throw new RuntimeException("Stub!"); } // API 26
        public Builder setSmallIcon(int icon) { throw new RuntimeException("Stub!"); }
        public Builder setContentTitle(CharSequence title) { throw new RuntimeException("Stub!"); }
        public Builder setContentText(CharSequence text) { throw new RuntimeException("Stub!"); }
        public Builder setContentIntent(PendingIntent intent) { throw new RuntimeException("Stub!"); }
        public Builder setDeleteIntent(PendingIntent intent) { throw new RuntimeException("Stub!"); }
        public Builder addAction(int icon, CharSequence title, PendingIntent intent) { throw new RuntimeException("Stub!"); }
        public Builder setWhen(long when) { throw new RuntimeException("Stub!"); }
        public Builder setShowWhen(boolean show) { throw new RuntimeException("Stub!"); }
        public Builder setUsesChronometer(boolean b) { throw new RuntimeException("Stub!"); }
        public Builder setAutoCancel(boolean autoCancel) { throw new RuntimeException("Stub!"); }
        public Builder setPriority(int pri) { throw new RuntimeException("Stub!"); }
        public Builder setSound(Uri sound, int streamType) { throw new RuntimeException("Stub!"); }
        public Builder setVibrate(long[] pattern) { throw new RuntimeException("Stub!"); }
        public Builder setCategory(String category) { throw new RuntimeException("Stub!"); }        // API 21
        public Builder setVisibility(int visibility) { throw new RuntimeException("Stub!"); }       // API 21
        public Builder setColor(int argb) { throw new RuntimeException("Stub!"); }                  // API 21
        public Builder setTimeoutAfter(long durationMs) { throw new RuntimeException("Stub!"); }    // API 26
        public Notification build() { throw new RuntimeException("Stub!"); }
    }
}
