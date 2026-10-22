//! Read-only vendor mapi client for the background monitor (mirrors src/api/client.ts).

use serde::Deserialize;
use serde_json::json;

pub const MAPI_URL: &str = "https://www.gps666.net/mapi";
pub const MERCHANT_TYPE: i32 = 58;
pub const ERR_SESSION_EXPIRED: i64 = 268_697_631;

#[derive(Clone)]
pub struct MapiClient {
    http: reqwest::blocking::Client,
}

impl MapiClient {
    pub fn new() -> Result<Self, String> {
        let http = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { http })
    }

    fn post(
        &self,
        sid: Option<&str>,
        module: &str,
        func: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let url = match sid {
            Some(token) => format!("{}?sid={}", MAPI_URL, urlencoding::encode(token)),
            None => MAPI_URL.to_string(),
        };
        let res = self
            .http
            .post(url)
            .header("user-agent", "Dart/3.6 (dart:io)")
            .header("content-type", "application/json; charset=utf-8")
            // No accept-encoding: reqwest is built without gzip support, so
            // offering it would return an undecodable body. The Dart UA keeps
            // the vendor-side fingerprint consistent with the app.
            .json(&json!({ "module": module, "func": func, "params": params }))
            .send()
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("mapi http {}", res.status()));
        }
        let body: serde_json::Value = res.json().map_err(|e| e.to_string())?;
        let errcode = body
            .get("errcode")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| "mapi response missing errcode".to_string())?;
        if errcode != 0 {
            let message = body
                .get("error_message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if errcode == ERR_SESSION_EXPIRED {
                return Err(format!("session_expired:{message}"));
            }
            return Err(format!("mapi {errcode}: {message}"));
        }
        Ok(body)
    }

    pub fn login(&self, account: &str, password: &str) -> Result<LoginResult, String> {
        let pwd_md5 = format!("{:x}", md5::compute(password.trim()));
        let body = self.post(
            None,
            "user",
            "Login",
            json!({
                "account": account,
                "pwd_md5": pwd_md5,
                "info": "",
                "lang": "en",
                "platform": "web",
                "type": MERCHANT_TYPE,
            }),
        )?;
        let sid = body
            .get("sid")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "login missing sid".to_string())?;
        let familyid = body
            .get("familys")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|f| f.get("sid"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| "login missing familys[0].sid".to_string())?;
        Ok(LoginResult {
            sid: sid.to_string(),
            familyid: familyid.to_string(),
        })
    }

    pub fn get_run_info(&self, sid: &str, familyid: &str) -> Result<Vec<RunInfoItem>, String> {
        let body = self.post(
            Some(sid),
            "family",
            "GetRunInfo",
            json!({
                "call_all_dev": true,
                "call_simei": serde_json::Value::Null,
                "limit_size": 200,
                "sfamily": familyid,
            }),
        )?;
        let items = body
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut out = Vec::new();
        for item in items {
            if let Ok(parsed) = serde_json::from_value::<RunInfoItem>(item) {
                out.push(parsed);
            }
        }
        Ok(out)
    }

    pub fn get_alarms(
        &self,
        sid: &str,
        simei: &str,
        start: i64,
        end: i64,
        limit: i64,
    ) -> Result<Vec<AlarmItemWire>, String> {
        let body = self.post(
            Some(sid),
            "alarm",
            "Get",
            json!({
                "simei": [simei],
                "limit_size": limit,
                "start_time": start,
                "end_time": end,
            }),
        )?;
        let items = body
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut out = Vec::new();
        for item in items {
            if let Ok(parsed) = serde_json::from_value::<AlarmItemWire>(item) {
                out.push(parsed);
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Clone)]
pub struct LoginResult {
    pub sid: String,
    pub familyid: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunInfoItem {
    pub simei: String,
    pub car_number: Option<String>,
    pub state: String,
    pub power: Option<i64>,
    pub last_com_time: Option<i64>,
    pub expire: Option<bool>,
    pub imei: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlarmItemWire {
    pub imei: i64,
    pub time: i64,
    #[serde(rename = "type")]
    pub alarm_type: String,
    pub alarm_name: String,
    pub car_number: Option<String>,
}
