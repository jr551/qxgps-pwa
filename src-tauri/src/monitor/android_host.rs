use super::state::MonitorStore;
use jni::objects::JValue;
use jni::JNIEnv;
use std::sync::Arc;
use tauri::AppHandle;

fn with_jni<F>(f: F) -> Result<(), String>
where
    F: FnOnce(&mut JNIEnv) -> Result<(), String>,
{
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    f(&mut env)
}

pub fn apply_service(app: &AppHandle, enabled: bool, interval_sec: u64) -> Result<(), String> {
    let store = app
        .try_state::<Arc<MonitorStore>>()
        .ok_or_else(|| "monitor store missing".to_string())?;
    with_jni(|env| {
        let activity = ndk_context::android_context().activity();
        let activity = unsafe { jni::objects::JObject::from_raw(activity as jni::sys::jobject) };
        let class = env
            .find_class("io/github/placeholder/qxgps/MonitorController")
            .map_err(|e| e.to_string())?;
        env.call_static_method(
            class,
            "apply",
            "(Landroid/content/Context;ZJ)V",
            &[
                JValue::Object(&activity),
                JValue::Bool(i8::from(enabled)),
                JValue::Long(interval_sec as i64),
            ],
        )
        .map_err(|e| e.to_string())?;
        store.status.lock().unwrap().android_service_running = enabled;
        Ok(())
    })
}

pub fn request_post_notifications(_app: &AppHandle) -> Result<(), String> {
    with_jni(|env| {
        let activity = ndk_context::android_context().activity();
        let activity = unsafe { jni::objects::JObject::from_raw(activity as jni::sys::jobject) };
        let class = env
            .find_class("io/github/placeholder/qxgps/MonitorController")
            .map_err(|e| e.to_string())?;
        env.call_static_method(
            class,
            "requestPostNotifications",
            "(Landroid/content/Context;)V",
            &[JValue::Object(&activity)],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn open_battery_settings(_app: &AppHandle) -> Result<(), String> {
    with_jni(|env| {
        let activity = ndk_context::android_context().activity();
        let activity = unsafe { jni::objects::JObject::from_raw(activity as jni::sys::jobject) };
        let class = env
            .find_class("io/github/placeholder/qxgps/MonitorController")
            .map_err(|e| e.to_string())?;
        env.call_static_method(
            class,
            "openBatteryOptimizationSettings",
            "(Landroid/content/Context;)V",
            &[JValue::Object(&activity)],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
