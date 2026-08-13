import { Platform, NativeModules, NativeEventEmitter } from "react-native";
import type { AudioInputDevice } from "./audio-input-settings";

const MODULE_NAME = "AudioRouteManager";

interface AudioRouteManagerNative {
  getCurrentRoute(): Promise<Array<{
    deviceId: string;
    label: string;
    kind: string;
    portType: string;
  }>>;
  refreshDevices(): Promise<Array<{
    deviceId: string;
    label: string;
    kind: string;
    portType: string;
  }>>;
}

function getNativeModule(): AudioRouteManagerNative | null {
  if (Platform.OS !== "ios") return null;
  const module = NativeModules[MODULE_NAME];
  if (!module) return null;
  return module as AudioRouteManagerNative;
}

function mapDevice(d: { deviceId?: string; label?: string }): AudioInputDevice {
  return {
    deviceId: d.deviceId || "default",
    label: d.label || "iPhone Microphone",
    kind: "audioinput",
  };
}

export function getIosAudioDevices(): Promise<AudioInputDevice[]> {
  const mod = getNativeModule();
  if (!mod) return Promise.resolve([]);
  return mod.getCurrentRoute().then((devices) => devices.map(mapDevice));
}

export function onIosRouteChanged(callback: (devices: AudioInputDevice[]) => void): () => void {
  if (Platform.OS !== "ios") {
    return () => {};
  }
  const mod = NativeModules[MODULE_NAME];
  if (!mod) return () => {};

  try {
    const emitter = new NativeEventEmitter(mod);
    const subscription = emitter.addListener("onAudioRouteChanged", (devices: any[]) => {
      callback((devices || []).map(mapDevice));
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
