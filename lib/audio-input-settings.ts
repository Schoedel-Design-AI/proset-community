import { useState, useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getIosAudioDevices, onIosRouteChanged } from "./audio-route-ios";

const DEVICE_ID_KEY = "audio_input_device_id";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  kind: string;
}

export interface AudioInputSettings {
  devices: AudioInputDevice[];
  selectedDeviceId: string | null;
  loading: boolean;
  refreshDevices: () => Promise<void>;
  selectDevice: (deviceId: string | null) => Promise<void>;
}

export function useAudioInputSettings(): AudioInputSettings {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selectDeviceRef = useRef<(deviceId: string | null) => Promise<void>>(async () => {});

  const refreshDevices = useCallback(async () => {
    setLoading(true);
    try {
      let deviceList: AudioInputDevice[] = [];

      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
        try {
          // Do NOT call getUserMedia() here — activating the mic interrupts
          // audio routing (e.g., headphones briefly route to the device speaker).
          // enumerateDevices() returns real labels when the user has already
          // granted mic permission (e.g., after their first recording).
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          deviceList = allDevices
            .filter(d => d.kind === "audioinput")
            .map(d => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
              kind: d.kind,
            }));
        } catch { /* labels may be empty */ }
      } else if (Platform.OS === "ios") {
        try { deviceList = await getIosAudioDevices(); } catch { /* fallback */ }
      } else if (Platform.OS === "android") {
        // Android: device routing is not yet exposed by the Nitro Sound wrapper.
        // Show a single non-selectable entry so the user knows this is a known limitation.
        deviceList = [{
          deviceId: "default",
          label: "Android Default",
          kind: "audioinput",
        }];
      }

      if (deviceList.length === 0) {
        deviceList = [{
          deviceId: "default",
          label: Platform.OS === "ios" ? "iPhone Microphone"
               : Platform.OS === "android" ? "Device Microphone"
               : "Microphone",
          kind: "audioinput",
        }];
      }

      setDevices(deviceList);

      const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (saved && deviceList.some(d => d.deviceId === saved)) {
        setSelectedDeviceId(saved);
      } else if (deviceList.length > 0) {
        setSelectedDeviceId(deviceList[0].deviceId);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, []);

  // Route change listeners for mobile platforms
  useEffect(() => {
    if (Platform.OS === "ios") {
      return onIosRouteChanged((newDevices) => {
        if (newDevices.length > 0) {
          setDevices(newDevices);
          if (newDevices.length === 1) selectDeviceRef.current(newDevices[0].deviceId);
        }
      });
    }
  }, []);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);

  const selectDevice = useCallback(async (deviceId: string | null) => {
    if (deviceId === null || deviceId === "default") {
      setSelectedDeviceId(null);
      await AsyncStorage.removeItem(DEVICE_ID_KEY);
    } else {
      setSelectedDeviceId(deviceId);
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
  }, []);

  selectDeviceRef.current = selectDevice;

  return { devices, selectedDeviceId, loading, refreshDevices, selectDevice };
}
