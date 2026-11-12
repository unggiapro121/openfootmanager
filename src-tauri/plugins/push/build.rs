// The commands the app's webview may call (M3c2, m3-tech-spec §5.3), and where the native halves
// live. `register_listener` / `remove_listener` are Tauri's own: the "opened" and "token" events.
const COMMANDS: &[&str] = &[
    "permission_state",
    "request_permission",
    "token",
    "take_opened",
    "open_settings",
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
