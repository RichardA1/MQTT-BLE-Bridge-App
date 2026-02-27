# MQTT ↔ BLE Bridge App

A React Native **Android** application that acts as a bidirectional bridge between MQTT (over the phone's internet connection — WiFi or mobile data) and BLE peripheral devices.

> **Platform:** Android only  
> **Dev machine:** Windows (Surface Pro 11 or any Windows 10/11 x64 machine)

---

## Architecture Overview

```
[ BLE Device(s) ] ←——BLE——→ [ Android Phone ] ←——MQTT over WSS/TCP——→ [ MQTT Broker ]
```

- The **Android phone** is the hub — it holds the MQTT client connection and manages BLE centrally.
- **BLE devices** never touch the internet directly; the phone proxies all messages.
- MQTT topics are mapped to BLE characteristics per device.
- The phone's OS automatically routes MQTT traffic over whatever interface is active (WiFi or mobile data) — no special handling required.

---

## Toolchain — Windows Development Environment

### Required installs (in order)

| Tool | Purpose | Download |
|---|---|---|
| **Node.js 20 LTS** | JS runtime + npm | https://nodejs.org |
| **JDK 17 (Temurin)** | Android build system | https://adoptium.net |
| **Android Studio** | SDK, emulator, ADB, Gradle | https://developer.android.com/studio |
| **Git for Windows** | Source control | https://git-scm.com |
| **Windows Terminal** | Better shell experience | Microsoft Store |
| **VS Code** | Editor (optional but recommended) | https://code.visualstudio.com |

### Android Studio setup (critical steps)

1. Install Android Studio → run the setup wizard fully
2. Open **SDK Manager** → install:
   - Android SDK Platform **34** (Android 14) — minimum target
   - Android SDK Build-Tools **34.0.0**
   - Android Emulator
   - Android SDK Platform-Tools (ADB)
3. Open **AVD Manager** → create a virtual device:
   - Pixel 7 or Pixel 8 profile
   - System image: **API 34 (x86_64)**
   - ⚠️ BLE does **not** work on the emulator — use a real Android phone for BLE testing

### Environment variables

Open: **Start → Search "Edit the system environment variables" → Environment Variables**

| Variable | Value |
|---|---|
| `JAVA_HOME` | `C:\Program Files\Eclipse Adoptium\jdk-17.x.x.x-hotspot` |
| `ANDROID_HOME` | `C:\Users\<YourName>\AppData\Local\Android\Sdk` |

Add to **Path**:
```
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\tools
%ANDROID_HOME%\tools\bin
%JAVA_HOME%\bin
```

### Verify your setup

Open Windows Terminal and run:
```powershell
node --version        # v20.x.x
java --version        # 17.x.x
adb --version         # Android Debug Bridge...
npx react-native doctor
```

---

## App Toolchain

| Layer | Tool | Version |
|---|---|---|
| Framework | React Native (bare workflow) | 0.74+ |
| Language | TypeScript | 5.x |
| BLE | `react-native-ble-plx` | 3.x |
| MQTT | `mqtt` (MQTT.js) | 5.x |
| State | Zustand | 4.x |
| Navigation | React Navigation | 6.x |
| Build | Android Studio + Gradle | Latest stable |

---

## Related / Reference Projects

| Project | Why it's relevant |
|---|---|
| [`react-native-ble-plx`](https://github.com/dotintent/react-native-ble-plx) | Best-maintained BLE library for React Native Android |
| [`MQTT.js`](https://github.com/mqttjs/MQTT.js) | Battle-tested MQTT client; works in RN with minor polyfills |
| [`react-native-mqtt`](https://github.com/Introvertedtech/react-native-mqtt) | Alternative if MQTT.js polyfilling proves complex |
| [`mqtt-ble-bridge` (Node)](https://github.com/hobbyquaker/mqtt-ble-bridge) | Server-side concept for the same bridge pattern |
| [Nordic UART Service (NUS)](https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/libraries/bluetooth_services/services/nus.html) | Common BLE UART profile for ESP32 / nRF52 hardware |
| [nRF Connect for Mobile](https://www.nordicsemi.com/Products/Development-tools/nrf-connect-for-mobile) | Excellent Android BLE debugging tool — install on your test phone |
| [MQTT Explorer](https://mqtt-explorer.com/) | Free Windows GUI to monitor broker traffic during development |

---

## Project Structure

```
mqtt-ble-bridge/
├── src/
│   ├── ble/
│   │   ├── BLEManager.ts          # Central BLE manager (scan, connect, read/write/notify)
│   │   ├── BLEDevice.ts           # Per-device state and characteristic handles
│   │   └── constants.ts           # UUIDs for services/characteristics
│   ├── mqtt/
│   │   ├── MQTTClient.ts          # MQTT connection, subscribe, publish
│   │   └── topicMap.ts            # Maps MQTT topics ↔ BLE characteristics
│   ├── bridge/
│   │   └── Bridge.ts              # Orchestrates BLE ↔ MQTT routing
│   ├── store/
│   │   └── useAppStore.ts         # Zustand global state
│   ├── screens/
│   │   ├── HomeScreen.tsx
│   │   ├── BLEScreen.tsx
│   │   └── MQTTScreen.tsx
│   └── App.tsx
├── android/                       # Android native project
├── index.js                       # Entry point (includes Buffer polyfill)
├── README.md
└── package.json
```

> No `ios/` directory — this project targets Android only.

---

## Getting Started

### 1. Bootstrap the project

```powershell
npx react-native@latest init MQTTBLEBridge --template react-native-template-typescript
cd MQTTBLEBridge
```

### 2. Install dependencies

```powershell
npm install react-native-ble-plx mqtt zustand @react-navigation/native @react-navigation/native-stack
npm install react-native-screens react-native-safe-area-context
```

### 3. Required polyfills for MQTT.js in React Native

```powershell
npm install @craftzdog/react-native-buffer react-native-tcp-socket events
```

Add to `index.js` **before** any other imports:
```js
import {Buffer} from '@craftzdog/react-native-buffer';
global.Buffer = Buffer;
```

### 4. Android permissions

Edit `android/app/src/main/AndroidManifest.xml`:
```xml
<!-- Internet (MQTT over WiFi or mobile data) -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- BLE — Android 12+ (API 31+) -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- BLE — Android 11 and below (API ≤ 30) -->
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- Declare BLE as a required hardware feature -->
<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

### 5. Enable USB debugging on your Android phone

1. Settings → About Phone → tap **Build Number** 7 times
2. Settings → Developer Options → enable **USB Debugging**
3. Connect phone via USB cable to your Surface Pro
4. In Windows Terminal: `adb devices` — your device should appear with a serial number

### 6. Run on device

```powershell
# Confirm device is visible
adb devices

# Build and install the app
npx react-native run-android

# If multiple devices are connected, specify one
npx react-native run-android --deviceId <serial-from-adb-devices>
```

---

## Physical BLE Testing

The Android emulator **does not support Bluetooth**. A real Android device connected via USB is required.

**Recommended test workflow:**
1. Connect Android phone via USB → confirm with `adb devices`
2. Run `npx react-native run-android` to build and install
3. Install **[nRF Connect for Mobile](https://play.google.com/store/apps/details?id=no.nordicsemi.android.mcp)** on a second phone to simulate a BLE peripheral during early testing
4. Install **[MQTT Explorer](https://mqtt-explorer.com/)** on your Surface Pro to monitor broker traffic in real time

---

## User Interface

### Home Screen
- MQTT connection status (connected / offline)
- BLE adapter state (powered on / off)
- Connected device count
- Recent message log (last 10 entries)
- Start / Stop bridge buttons

### BLE Screen
- Scan for nearby BLE devices (filtered by NUS service UUID)
- Connect to a device
- Send a test payload directly to a connected device
- Auto-reconnect on unexpected disconnect

### MQTT Screen
- Configure broker URL, client ID, username/password
- Subscribe to additional topics
- Publish messages manually
- Full scrollable message log (last 200 entries) with direction indicator

---

## BLE ↔ MQTT Message Flow

### BLE → MQTT (device sends data to broker)
1. BLE device sends a notification on the TX characteristic.
2. `BLEDevice` decodes the base64 payload to UTF-8.
3. `Bridge` publishes it to `devices/<deviceId>/out` on the MQTT broker.

### MQTT → BLE (broker sends command to device)
1. Broker publishes to `devices/<deviceId>/in`.
2. `MQTTClient` receives the message.
3. `Bridge` writes the payload to the device's RX characteristic via `BLEManager`.

### Topic Convention

| Topic | Direction | Description |
|---|---|---|
| `devices/<id>/in` | Broker → BLE device | Commands sent to the device |
| `devices/<id>/out` | BLE device → Broker | Data sent from the device |

---

## Scaling to 3 BLE Devices

`BLEManager` manages a `Map<deviceId, BLEDevice>`. Each device gets its own:
- GATT connection with independent MTU negotiation
- Characteristic subscriptions
- Topic namespace under `devices/<deviceId>/`

To enable 3-device mode, change one line in `BLEManager.ts`:
```ts
export const MAX_DEVICES = 3; // was 1
```

Phase 1 — 1 device ✅  
Phase 2 — 3 concurrent devices 🔜

---

## Troubleshooting (Windows / Android)

| Problem | Fix |
|---|---|
| `adb devices` shows nothing | Re-plug USB; install your phone's OEM USB driver; set USB mode to "File Transfer" (MTP) |
| `JAVA_HOME` not found | Close and reopen terminal after setting env vars, or restart Windows |
| Gradle build fails | `cd android && gradlew.bat clean` then retry |
| BLE scan returns no results | Grant Location permission at runtime (required on Android ≤ 11); verify Bluetooth is on |
| MQTT not connecting | Use `wss://` for WebSocket brokers; confirm port (8883 = TLS TCP, 8884 = TLS WS) |
| Metro bundler port conflict | `npx react-native start --port 8082` |
| App crashes on launch | Check `adb logcat` in Windows Terminal for the actual Java exception |

---

## Commit Summary (v0.1.1 — Android-only + Windows dev environment)

```
chore:

- Added full Windows dev environment guide: Node 20 LTS, JDK 17 (Temurin),
  Android Studio SDK Manager + AVD setup, JAVA_HOME + ANDROID_HOME env vars
- Updated AndroidManifest BLE permissions to cover both API 31+ and legacy ≤ 30
- Added USB debugging setup steps and adb device verification
- Noted Android emulator BLE limitation — physical device required
- Added nRF Connect (Android) and MQTT Explorer (Windows) as recommended dev tools
- Removed ios/ from project structure; Android-only build confirmed
- BLEManager.ts: removed Platform.OS iOS branch, Android-only permission flow
```
