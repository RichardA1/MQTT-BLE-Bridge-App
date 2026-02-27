// src/ble/BLEManager.ts
// ---------------------------------------------------------------------------
// Singleton BLE manager.
// Handles permissions, scanning, connecting, and routing inbound BLE data.
// Phase 1: supports 1 device. Phase 2: scales to MAX_DEVICES.
// ---------------------------------------------------------------------------

import {BleManager, Device, State} from 'react-native-ble-plx';
import {PermissionsAndroid} from 'react-native'; // Android only — no iOS
import {BLEDevice, OnDataCallback} from './BLEDevice';
import {SCAN_TIMEOUT_MS, RECONNECT_DELAY_MS, NUS_SERVICE_UUID} from './constants';

export const MAX_DEVICES = 1; // Phase 1. Set to 3 for Phase 2.

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
  }) {
    this.onData = callbacks.onData;
    this.onStateChange = callbacks.onStateChange;
    this.onScanResult = callbacks.onScanResult;

    this.manager.onStateChange(state => {
      console.log('[BLEManager] State:', state);
      this.onStateChange?.(state);
    }, true);
  }

  // ── Permissions ───────────────────────────────────────────────────────────

  // Android-only — iOS support is not included in this project.
  async requestPermissions(): Promise<boolean> {
    const apiLevel = parseInt(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN ? '31' : '30', 10);

    // Android 12+ (API 31+): need BLUETOOTH_SCAN + BLUETOOTH_CONNECT
    // Android 11 and below: need ACCESS_FINE_LOCATION instead
    const isAndroid12Plus =
      typeof PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN !== 'undefined';

    if (isAndroid12Plus) {
      const grants = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(grants).every(
        v => v === PermissionsAndroid.RESULTS.GRANTED,
      );
    } else {
      // Legacy Android ≤ 11
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  }

  // ── Scan ──────────────────────────────────────────────────────────────────

  async startScan(): Promise<void> {
    const hasPerms = await this.requestPermissions();
    if (!hasPerms) throw new Error('Bluetooth permissions denied');

    const btState = await this.manager.state();
    if (btState !== State.PoweredOn) {
      throw new Error(`Bluetooth not ready: ${btState}`);
    }

    console.log('[BLEManager] Scanning…');

    // Filter by NUS service UUID so we only see bridge-compatible devices
    this.manager.startDeviceScan(
      [NUS_SERVICE_UUID],
      {allowDuplicates: false},
      (error, device) => {
        if (error) {
          console.warn('[BLEManager] Scan error:', error.message);
          return;
        }
        if (device) {
          this.onScanResult?.({
            id: device.id,
            name: device.name ?? device.id,
            rssi: device.rssi ?? -100,
          });
        }
      },
    );

    // Auto-stop after timeout
    this.scanTimer = setTimeout(() => this.stopScan(), SCAN_TIMEOUT_MS);
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
      throw new Error(`Max device limit (${MAX_DEVICES}) reached`);
    }
    if (this.devices.has(deviceId)) {
      console.log('[BLEManager] Already connected:', deviceId);
      return;
    }

    this.stopScan();

    const rawDevice: Device = await this.manager.connectToDevice(deviceId, {
      autoConnect: false,
    });

    const bleDevice = new BLEDevice(rawDevice, (id, data) => {
      this.onData?.(id, data);
    });

    await bleDevice.setup();
    this.devices.set(deviceId, bleDevice);

    // Watch for unexpected disconnection and auto-reconnect
    this.manager.onDeviceDisconnected(deviceId, (_error, _device) => {
      console.warn(`[BLEManager] ${deviceId} disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
      this.devices.delete(deviceId);
      setTimeout(() => this.connect(deviceId), RECONNECT_DELAY_MS);
    });

    console.log(`[BLEManager] Connected to ${bleDevice.name}`);
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async write(deviceId: string, data: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not connected`);
    await device.write(data);
  }

  /** Broadcast to ALL connected devices */
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

  // ── Teardown ──────────────────────────────────────────────────────────────

  async disconnectAll(): Promise<void> {
    const disconnects = [...this.devices.values()].map(d => d.disconnect());
    await Promise.allSettled(disconnects);
    this.devices.clear();
  }

  destroy(): void {
    this.disconnectAll();
    this.manager.destroy();
  }
}

export const BLEMgr = new BLEManagerSingleton();
