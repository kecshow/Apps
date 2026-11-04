Compile-time stand-ins for the few Android APIs newer than the API 16 stubs jar that `build-apk.sh`
downloads (notification channels, exact alarms, `@JavascriptInterface`). They are only on the javac
classpath, never in the APK: on the phone the real framework classes are used. Each class declares just
the members the app calls, with the real signatures and constant values.
