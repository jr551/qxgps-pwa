mod monitor;

use monitor::init_store;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let store = init_store(app.handle());
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            monitor::monitor_sync_session,
            monitor::monitor_apply_prefs,
            monitor::monitor_get_status,
            monitor::monitor_request_post_notifications,
            monitor::monitor_open_battery_optimization_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
