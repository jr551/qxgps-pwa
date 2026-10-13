use super::diff::{collect_new_alarms, diff_devices, snapshot_from_item};
use super::mapi::MapiClient;
use super::state::MonitorStore;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub struct MonitorRunner {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl MonitorRunner {
    pub fn new() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            thread: None,
        }
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
        self.stop = Arc::new(AtomicBool::new(false));
    }

    pub fn start(&mut self, app: AppHandle, store: Arc<MonitorStore>) {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        self.stop = stop.clone();
        let handle = thread::spawn(move || run_loop(app, store, stop));
        self.thread = Some(handle);
    }
}

fn run_loop(app: AppHandle, store: Arc<MonitorStore>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        let prefs = store.prefs.lock().unwrap().clone();
        if !prefs.enabled {
            thread::sleep(Duration::from_secs(2));
            continue;
        }
        let interval = prefs.interval_sec.clamp(120, 900);
        if let Err(err) = poll_once(&app, &store) {
            let mut status = store.status.lock().unwrap();
            status.last_poll_ok = false;
            status.last_error = Some(err);
            status.last_poll_at = Some(chrono_now());
        } else {
            let mut status = store.status.lock().unwrap();
            status.last_poll_ok = true;
            status.last_error = None;
            status.last_poll_at = Some(chrono_now());
        }
        store.save_persisted();

        let mut slept = 0u64;
        while slept < interval && !stop.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_secs(1));
            slept += 1;
        }
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

pub fn poll_once_public(app: &AppHandle, store: &MonitorStore) -> Result<(), String> {
    poll_once(app, store)
}

fn poll_once(app: &AppHandle, store: &MonitorStore) -> Result<(), String> {
    let session = store
        .session
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "monitor: no session".to_string())?;
    let client = MapiClient::new()?;
    let mut sid = session.sid.clone();
    let mut familyid = session.familyid.clone();

    let run = |sid: &str, familyid: &str| client.get_run_info(sid, familyid);
    let items = match run(&sid, &familyid) {
        Ok(items) => items,
        Err(err) if err.starts_with("session_expired:") => {
            let login = client.login(&session.account, &session.password)?;
            sid = login.sid;
            familyid = login.familyid;
            {
                let mut locked = store.session.lock().unwrap();
                if let Some(sess) = locked.as_mut() {
                    sess.sid = sid.clone();
                    sess.familyid = familyid.clone();
                }
            }
            client.get_run_info(&sid, &familyid)?
        }
        Err(err) => return Err(err),
    };

    let snapshots: Vec<_> = items.iter().map(snapshot_from_item).collect();
    let mut persisted = store.persisted.lock().unwrap();
    let (next_devices, device_events) = diff_devices(
        &persisted.device_snapshots,
        &snapshots,
        persisted.device_primed,
    );
    persisted.device_snapshots = next_devices;
    persisted.device_primed = true;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let start = now - 2 * 24 * 3600;

    let mut notifications: Vec<(String, String)> = Vec::new();
    for event in device_events {
        notifications.push((event.title, event.body));
    }

    for item in &items {
        let alarms = match client.get_alarms(&sid, &item.simei, start, now, 10) {
            Ok(rows) => rows,
            Err(err) if err.starts_with("session_expired:") => {
                let login = client.login(&session.account, &session.password)?;
                sid = login.sid;
                client.get_alarms(&sid, &item.simei, start, now, 10)?
            }
            Err(err) => return Err(err),
        };
        let label = item.car_number.clone().unwrap_or_else(|| "QXGPS Lite".to_string());
        let primed_flag = persisted.alarm_primed;
        let (alarm_events, primed) = collect_new_alarms(
            &mut persisted.seen_alarms,
            &alarms,
            &label,
            primed_flag,
        );
        persisted.alarm_primed = primed;
        for event in alarm_events {
            notifications.push((event.title, event.body));
        }
    }

    for (title, body) in notifications.into_iter().take(6) {
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    Ok(())
}
