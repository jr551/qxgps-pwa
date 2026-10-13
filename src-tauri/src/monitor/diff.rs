//! Mirrors src/lib/monitor-shared.ts for native notifications.

use super::mapi::{AlarmItemWire, RunInfoItem};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const LOW_BATTERY_PERCENT: i64 = 20;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeviceSnapshot {
    pub simei: String,
    pub car_number: String,
    pub state: String,
    pub power: Option<i64>,
    pub last_com_time: i64,
}

pub fn snapshot_from_item(item: &RunInfoItem) -> DeviceSnapshot {
    DeviceSnapshot {
        simei: item.simei.clone(),
        car_number: item.car_number.clone().unwrap_or_default(),
        state: item.state.clone(),
        power: item.power,
        last_com_time: item.last_com_time.unwrap_or(0),
    }
}

fn link_tone(state: &str) -> &'static str {
    if state == "e_line_on" {
        "online"
    } else if state == "e_line_sleep" {
        "sleep"
    } else {
        "offline"
    }
}

fn link_label(tone: &str) -> &'static str {
    match tone {
        "online" => "Online",
        "sleep" => "Sleep",
        _ => "Offline",
    }
}

pub struct MonitorNotification {
    pub id: String,
    pub title: String,
    pub body: String,
}

pub fn diff_devices(
    previous: &HashMap<String, DeviceSnapshot>,
    current: &[DeviceSnapshot],
    primed: bool,
) -> (HashMap<String, DeviceSnapshot>, Vec<MonitorNotification>) {
    let mut next = HashMap::new();
    let mut events = Vec::new();
    for snap in current {
        next.insert(snap.simei.clone(), snap.clone());
        let prior = previous.get(&snap.simei);
        if !primed || prior.is_none() {
            continue;
        }
        let prior = prior.unwrap();
        let label = if snap.car_number.is_empty() {
            "Device"
        } else {
            snap.car_number.as_str()
        };
        let prev_tone = link_tone(&prior.state);
        let next_tone = link_tone(&snap.state);
        if prev_tone != next_tone {
            events.push(MonitorNotification {
                id: format!("link-{}-{}-{}", snap.simei, snap.state, snap.last_com_time),
                title: label.to_string(),
                body: format!(
                    "Link state: {} → {}",
                    link_label(prev_tone),
                    link_label(next_tone)
                ),
            });
        }
        if let (Some(p_now), Some(p_was)) = (snap.power, prior.power) {
            if p_was > LOW_BATTERY_PERCENT && p_now <= LOW_BATTERY_PERCENT {
                events.push(MonitorNotification {
                    id: format!("battery-{}-{}", snap.simei, p_now),
                    title: label.to_string(),
                    body: format!("Battery reported at {}%", p_now),
                });
            }
        }
    }
    (next, events)
}

pub fn alarm_id(imei: i64, time: i64, alarm_type: &str) -> String {
    format!("{imei}-{time}-{alarm_type}")
}

pub fn collect_new_alarms(
    seen: &mut HashSet<String>,
    rows: &[AlarmItemWire],
    device_label: &str,
    primed: bool,
) -> (Vec<MonitorNotification>, bool) {
    let mut events = Vec::new();
    let mut next_primed = primed;
    for row in rows {
        let id = alarm_id(row.imei, row.time, &row.alarm_type);
        if seen.contains(&id) {
            continue;
        }
        seen.insert(id.clone());
        if next_primed {
            let title = row
                .car_number
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| device_label.to_string());
            events.push(MonitorNotification {
                id,
                title,
                body: if row.alarm_name.is_empty() {
                    row.alarm_type.clone()
                } else {
                    row.alarm_name.clone()
                },
            });
        }
    }
    next_primed = true;
    (events, next_primed)
}
