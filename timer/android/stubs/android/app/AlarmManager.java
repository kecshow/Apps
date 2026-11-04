package android.app;

/** The members of android.app.AlarmManager the app uses, up to API 23. */
public class AlarmManager {
    public static final int RTC_WAKEUP = 0;

    public void setExactAndAllowWhileIdle(int type, long triggerAtMillis, PendingIntent operation) { throw new RuntimeException("Stub!"); } // API 23
    public void setAndAllowWhileIdle(int type, long triggerAtMillis, PendingIntent operation) { throw new RuntimeException("Stub!"); }      // API 23
    public void cancel(PendingIntent operation) { throw new RuntimeException("Stub!"); }
}
