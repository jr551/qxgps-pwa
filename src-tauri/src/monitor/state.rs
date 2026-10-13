use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use super::diff::DeviceSnapshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorSession {
    pub sid: String,
    pub familyid: String,
    pub account: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorPrefs {
    pub enabled: bool,
    pub interval_sec: u64,
}

impl Default for MonitorPrefs {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_sec: 300,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedMonitorState {
    pub device_snapshots: HashMap<String, DeviceSnapshot>,
    pub device_primed: bool,
    pub seen_alarms: HashSet<String>,
    pub alarm_primed: bool,
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeStatus {
    pub last_poll_ok: bool,
    pub last_poll_at: Option<String>,
    pub last_error: Option<String>,
    pub android_service_running: bool,
}

pub struct MonitorStore {
    path: PathBuf,
    pub session: Mutex<Option<MonitorSession>>,
    pub prefs: Mutex<MonitorPrefs>,
    pub persisted: Mutex<PersistedMonitorState>,
    pub status: Mutex<RuntimeStatus>,
}

impl MonitorStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let path = app_data_dir.join("monitor-state.json");
        let persisted = load_persisted(&path);
        Self {
            path,
            session: Mutex::new(None),
            prefs: Mutex::new(MonitorPrefs::default()),
            persisted: Mutex::new(persisted),
            status: Mutex::new(RuntimeStatus::default()),
        }
    }

    pub fn save_persisted(&self) {
        let state = self.persisted.lock().unwrap().clone();
        if let Ok(raw) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(&self.path, raw);
        }
    }
}

fn load_persisted(path: &PathBuf) -> PersistedMonitorState {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => PersistedMonitorState::default(),
    }
}
