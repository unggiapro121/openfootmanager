# Tauri finds the plugin class and its @Command / @PermissionCallback methods by reflection, and
# Firebase starts the messaging service by its name from the manifest: R8 must keep their names
# in a release build (spike m3c2 B4).
-keep class app.ofm.push.PushPlugin { *; }
-keep class app.ofm.push.PushMessagingService { *; }
