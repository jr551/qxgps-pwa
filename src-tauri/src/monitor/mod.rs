mod diff;
mod mapi;
mod runner;
mod state;

#[cfg(target_os = "android")]
mod android_host;

use runner::MonitorRunner;
use state::{MonitorPrefs, MonitorSession, MonitorStore, RuntimeStatus};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};

static RUNNER: Mutex<MonitorRunner> = Mutex::new(MonitorRunner::new());
static STORE: OnceLock<Arc<MonitorStore>> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init_store(app: &AppHandle) -> Arc<MonitorStore> {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app data dir");
    let _ = std::fs::create_dir_all(&dir);
    let store = Arc::new(MonitorStore::new(dir));
    let _ = STORE.set(store.clone());
    let _ = APP_HANDLE.set(app.clone());
    store
}

fn store() -> Result<Arc<MonitorStore>, String> {
    STORE.get().cloned().ok_or_else(|| "monitor store not ready".to_string())
}

#[derive(serde::Deserialize)]
pub struct SessionPayload {
    pub sid: String,
    pub familyid: String,
    pub account: String,
    pub password: String,
}

#[derive(serde::Deserialize)]
pub struct PrefsPayload {
    pub enabled: bool,
    pub interval_sec: u64,
}

#[derive(serde::Serialize)]
pub struct StatusPayload {
    pub enabled: bool,
    pub interval_sec: u64,
    pub last_poll_ok: bool,
    pub last_poll_at: Option<String>,
    pub last_error: Option<String>,
    pub android_service_running: bool,
}

#[tauri::command]
pub fn monitor_sync_session(
    store_state: State<'_, Arc<MonitorStore>>,
    payload: SessionPayload,
) -> Result<(), String> {
    if payload.sid.is_empty() || payload.familyid.is_empty() {
        return Err("session payload incomplete".into());
    }
    let mut session = store_state.session.lock().unwrap();
    *session = Some(MonitorSession {
        sid: payload.sid,
        familyid: payload.familyid,
        account: payload.account,
        password: payload.password,
    });
    Ok(())
}

#[tauri::command]
pub fn monitor_apply_prefs(
    app: AppHandle,
    store_state: State<'_, Arc<MonitorStore>>,
    payload: PrefsPayload,
) -> Result<StatusPayload, String> {
    let interval = payload.interval_sec.clamp(120, 900);
    {
        let mut prefs = store_state.prefs.lock().unwrap();
        prefs.enabled = payload.enabled;
        prefs.interval_sec = interval;
    }

    if payload.enabled {
        #[cfg(not(target_os = "android"))]
        {
            let mut runner = RUNNER.lock().unwrap();
            runner.start(app.clone(), store_state.inner().clone());
        }
        #[cfg(target_os = "android")]
        {
            let mut runner = RUNNER.lock().unwrap();
            runner.start(app.clone(), store_state.inner().clone());
            android_host::apply_service(&app, true, interval)?;
        }
    } else {
        let mut runner = RUNNER.lock().unwrap();
        runner.stop();
        #[cfg(target_os = "android")]
        android_host::apply_service(&app, false, interval)?;
        store_state.status.lock().unwrap().android_service_running = false;
    }

    status_payload(&store_state)
}

fn status_payload(store_state: &Arc<MonitorStore>) -> Result<StatusPayload, String> {
    let prefs = store_state.prefs.lock().unwrap().clone();
    let status = store_state.status.lock().unwrap().clone();
    Ok(StatusPayload {
        enabled: prefs.enabled,
        interval_sec: prefs.interval_sec,
        last_poll_ok: status.last_poll_ok,
        last_poll_at: status.last_poll_at,
        last_error: status.last_error,
        android_service_running: status.android_service_running,
    })
}

#[tauri::command]
pub fn monitor_get_status(store_state: State<'_, Arc<MonitorStore>>) -> Result<StatusPayload, String> {
    status_payload(store_state.inner())
}

#[tauri::command]
#[cfg(target_os = "android")]
pub fn monitor_request_post_notifications(app: AppHandle) -> Result<(), String> {
    android_host::request_post_notifications(&app)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
pub fn monitor_request_post_notifications() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(target_os = "android")]
pub fn monitor_open_battery_optimization_settings(app: AppHandle) -> Result<(), String> {
    android_host::open_battery_settings(&app)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
pub fn monitor_open_battery_optimization_settings() -> Result<(), String> {
    Ok(())
}

/// Called from Android WorkManager / foreground service on a background thread.
#[no_mangle]
pub extern "C" fn qxgps_monitor_poll_native() -> i32 {
    let app = APP_HANDLE.get().cloned();
    let store = STORE.get().cloned();
    if app.is_none() || store.is_none() {
        return -1;
    }
    let app = app.unwrap();
    let store = store.unwrap();
    match runner::poll_once_public(&app, &store) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_io_github_placeholder_qxgps_QxgpsMonitorNative_pollOnce(
    _env: jni::sys::JNIEnv,
    _class: jni::sys::jclass,
) -> jni::sys::jint {
    qxgps_monitor_poll_native()
}
