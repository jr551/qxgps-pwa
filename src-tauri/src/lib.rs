mod monitor;

use monitor::{init_store, MonitorStore};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.setup(|app| {
            let store = init_store(app.handle());
            app.manage(store);

            let show_i = MenuItem::with_id(app, "show", "Show QXGPS Lite", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("QXGPS Lite")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        });
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder = builder.setup(|app| {
            let store = init_store(app.handle());
            app.manage(store);
            Ok(())
        });
    }

    builder
        .invoke_handler(tauri::generate_handler![
            monitor::monitor_sync_session,
            monitor::monitor_apply_prefs,
            monitor::monitor_get_status,
            monitor::monitor_request_post_notifications,
            monitor::monitor_open_battery_optimization_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    let store = app_handle.state::<Arc<MonitorStore>>();
                    if store.prefs.lock().unwrap().enabled {
                        api.prevent_exit();
                    }
                }
            }
        });
}
