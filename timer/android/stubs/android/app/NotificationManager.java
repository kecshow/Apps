package android.app;

/** The members of android.app.NotificationManager the app uses, up to API 26. */
public class NotificationManager {
    public static final int IMPORTANCE_HIGH = 4;

    public void notify(int id, Notification notification) { throw new RuntimeException("Stub!"); }
    public void cancel(int id) { throw new RuntimeException("Stub!"); }
    public void cancelAll() { throw new RuntimeException("Stub!"); }
    public boolean areNotificationsEnabled() { throw new RuntimeException("Stub!"); }               // API 24
    public void createNotificationChannel(NotificationChannel channel) { throw new RuntimeException("Stub!"); } // API 26
}
