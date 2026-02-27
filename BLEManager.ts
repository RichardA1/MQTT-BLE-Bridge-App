// src/ble/BLEManager.ts
// ---------------------------------------------------------------------------
// Singleton BLE manager.
//
// Target hardware : Google Pixel 5
// Android version : 13 (API 33)
// BLE version     : BLE 5.0
//
// Permission model (API 31+ / Android 12+):
//   BLUETOOTH_SCAN  — with android:usesPermissionFlags="neverForLocation"
//                     so ACCESS_FINE_LOCATION is NOT required for BLE scanning
//   BLUETOOTH_CONNECT — required to connect to and communicate with devices
//
// No legacy BLUETOOTH / BLUETOOTH_ADMIN / ACCESS_FINE_LOCATION needed.
//
// Phase 1: 1 connected device  (MAX_DEVICES = 1)
// Phase 2: 3 connected devices (MAX_DEVICES = 3) — flip the constant below
// ---------------------------------------------------------------------------

import {BleManager, Device, State} from 'react-native-ble-plx';
import {PermissionsAndroid} from 'react-native';
import {BLEDevice, OnDataCallback} from './BLEDevice';
import {SCAN_TIMEOUT_MS, RECONNECT_DELAY_MS, NUS_SERVICE_UUID} from './constants';

/** Change to 3 when ready for Phase 2 multi-device support */
export const MAX_DEVICES = 1;

export type ScanResult = {id: string; name: string; rssi: number};

class BLEManagerSingleton {
  private manager = new BleManager();
  private devices = new Map<string, BLEDevice>();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private onData: OnDataCallback | null = null;
  private onStateChange?: (state: string) => void;
  private onScanResult?: (result: ScanResult) => void;

  // ── Initialise ────────────────────────────────────────────────────────────

  init(callbacks: {
    onData: OnDataCallback;
    onStateChange?: (state: string) => void;
    onScanResult?: (result: ScanResult) => void;
  }): void {
    this.onData = callbacks.onData;
    this.onStateChange = callbacks.onStateChange;
    this.onScanResult = callbacks.onScanResult;

    this.manager.onStateChange(state => {
      console.log('[BLEManager] Adapter state:', state);
      this.onStateChange?.(state);
    }, true /* emitCurrentState */);
  }

  // ── Permissions ───────────────────────────────────────────────────────────

  /**
   * Request BLE permissions for Android 13 (API 33) / Pixel 5.
   *
   * On API 31+ the user sees two prompts:
   *   1. "Allow [App] to find, connect to, and determine the relative
   *      position of nearby devices?" → BLUETOOTH_SCAN
   *   2. "Allow [App] to find and connect to nearby Bluetooth devices?"
   *      → BLUETOOTH_CONNECT
   *
   * Because BLUETOOTH_SCAN is declared with neverForLocation in the manifest,
   * Android does NOT show a location permission dialog for BLE on API 33.
   */
  async requestPermissions(): Promise<boolean> {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);

    const allGranted = Object.values(results).every(
      r => r === PermissionsAndroid.RESULTS.GRANTED,
    );

    if (!allGranted) {
      console.warn('[BLEManager] Permissions not fully granted:', results);
    }

    return allGranted;
  }

  // ── Scan ──────────────────────────────────────────────────────────────────

  async startScan(): Promise<void> {
    const hasPerms = await this.requestPermissions();
    if (!hasPerms) {
      throw new Error(
        'Bluetooth permissions denied.\n' +
        'Go to Settings → Apps → [App] → Permissions → Nearby devices and allow all.',
      );
    }

    const btState = await this.manager.state();
    if (btState !== State.PoweredOn) {
      throw new Error(
        `Bluetooth adapter is not ready (state: ${btState}).\n` +
        'Please enable Bluetooth on the Pixel 5 and try again.',
      );
    }

    console.log('[BLEManager] Starting BLE scan (NUS service filter)…');

    // Filter scan results to devices advertising the Nordic UART Service UUID.
    // This avoids flooding the UI with every nearby BLE peripheral.
    this.manager.startDeviceScan(
      [NUS_SERVICE_UUID],
      {allowDuplicates: false},
      (error, device) => {
        if (error) {
          console.warn('[BLEManager] Scan error:', error.message);
          return;
        }
        if (device) {
          console.log(`[BLEManager] Found: ${device.name ?? device.id}  RSSI: ${device.rssi}`);
          this.onScanResult?.({
            id: device.id,
            name: device.name ?? device.id,
            rssi: device.rssi ?? -100,
          });
        }
      },
    );

    // Auto-stop scan after timeout to save battery
    this.scanTimer = setTimeout(() => {
      console.log('[BLEManager] Scan timeout — stopping.');
      this.stopScan();
    }, SCAN_TIMEOUT_MS);
  }

  stopScan(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.manager.stopDeviceScan();
    console.log('[BLEManager] Scan stopped.');
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async connect(deviceId: string): Promise<void> {
    if (this.devices.size >= MAX_DEVICES) {
      throw new Error(
        `Max device limit (${MAX_DEVICES}) reached. ` +
        `Disconnect an existing device first, or increase MAX_DEVICES for Phase 2.`,
      );
    }
    if (this.devices.has(deviceId)) {
      console.log('[BLEManager] Already connected to:', deviceId);
      return;
    }

    // Stop scan before connecting — Pixel 5 / Android 13 performs better
    // when scan is halted prior to initiating a GATT connection.
    this.stopScan();

    console.log(`[BLEManager] Connecting to ${deviceId}…`);

    const rawDevice: Device = await this.manager.connectToDevice(deviceId, {
      autoConnect: false,          // Direct connect — faster on Pixel 5
      requestMTU: 512,             // Request max MTU upfront; BLE 5.0 supports it
    });

    const bleDevice = new BLEDevice(rawDevice, (id, data) => {
      this.onData?.(id, data);
    });

    await bleDevice.setup();
    this.devices.set(deviceId, bleDevice);

    // Monitor for unexpected disconnects and auto-reconnect
    this.manager.onDeviceDisconnected(deviceId, (error, _device) => {
      if (error) {
        console.warn(`[BLEManager] ${deviceId} disconnected with error:`, error.message);
      } else {
        console.warn(`[BLEManager] ${deviceId} disconnected cleanly.`);
      }
      this.devices.delete(deviceId);
      console.log(`[BLEManager] Scheduling reconnect in ${RECONNECT_DELAY_MS}ms…`);
      setTimeout(() => this.connect(deviceId), RECONNECT_DELAY_MS);
    });

    console.log(`[BLEManager] ✓ Connected to ${bleDevice.name}`);
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async write(deviceId: string, data: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Cannot write — device ${deviceId} is not connected.`);
    }
    await device.write(data);
  }

  /** Broadcast the same payload to all connected devices */
  async broadcast(data: string): Promise<void> {
    const writes = [...this.devices.values()].map(d => d.write(data));
    await Promise.allSettled(writes);
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getConnectedIds(): string[] {
    return [...this.devices.keys()];
  }

  isConnected(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }

  getDeviceCount(): number {
    return this.devices.size;
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  async disconnectAll(): Promise<void> {
    console.log('[BLEManager] Disconnecting all devices…');
    const disconnects = [...this.devices.values()].map(d => d.disconnect());
    await Promise.allSettled(disconnects);
    this.devices.clear();
  }

  destroy(): void {
    this.stopScan();
    this.disconnectAll();
    this.manager.destroy();
    console.log('[BLEManager] Destroyed.');
  }
}

export const BLEMgr = new BLEManagerSingleton();
