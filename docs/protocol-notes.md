# Vendor mapi protocol notes (public summary)

This document summarises **interoperability research** on the QXGPS / QXHL
tracker platform HTTP JSON API (`mapi`). It does **not** include vendor
firmware, proprietary binaries, or copied vendor application code.

## Transport

- `POST` JSON body: `{"module":"<name>","func":"<Name>","params":{…}}`
- Session token on the query string: `?sid=<token>` (except `user.Login`)
- Response envelope: `{"errcode":0,"error_message":"…", …payload}`

The official web portal exposes HTTPS mapi with CORS (`Access-Control-Allow-Origin: *`),
which allows this PWA to call `https://www.gps666.net/mapi` directly from the
browser. Self-hosted deployments may use the optional Node relay in `server/relay.mjs`
when serving over HTTP or when mimicking the native app's request fingerprint.

## Login (read-only client)

- Module `user`, function `Login`
- Password is sent as unsalted MD5 of the trimmed password (`pwd_md5`, lowercase hex)
- Merchant / white-label `type` **58** for the QXHL build (type `2` fails on this label)
- Account email: local part lowercased, domain preserved

## Verified read calls used by this PWA

| Feature | module.func | Notes |
| --- | --- | --- |
| Device list / live poll | `family.GetRunInfo`, `family.GetDeviceList` | `last_pos` is JSON inside a string |
| Device detail / config | `device.GetDetail`, `device.GetConfig` | Read-only display |
| History track | `location.QueryLocation` | Paged via `is_finish`, `limit_size` ≤ 2000 |
| Track calendar | `location.QueryTrackDate` | Per-day `distance` in metres, UTC+8 day epochs |
| Alarms | `alarm.Get` | `simei` must be a **one-element array** |
| Alarm types | `alarm.GetAlarmTypeList` | Account taxonomy |
| Geofences | `fence.Get` | Item shape pending when fences exist on device |

## Coordinates

- Integer `lat` / `lon` are degrees × 1e6; `wgs` is a decimal `"lat,lon"` string
- Sample data in docs and screenshots uses neutral London-area coordinates only

## Safety policy

This open-source client is **read-only**: no `Set*`, `Add*`, `Del*`, command, or
mark-read calls. Users are responsible for complying with local privacy and
tracking laws.
