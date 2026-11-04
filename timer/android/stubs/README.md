Compile-time stand-ins for the few Android APIs that are newer than the API 16 stubs jar `build-apk.sh`
downloads (notification channels, exact alarms, `@JavascriptInterface`), plus `org.json`, which that jar
leaves out. They are only on the javac classpath and never go into the APK: on the phone the real framework
classes are used. Each class declares just the members the app calls, with the real signatures and constant
values.
