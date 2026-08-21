import { Linking as RNLinking } from "react-native";

export const openURL = async (url: string) => RNLinking.openURL(url);
export const canOpenURL = async (url: string) => RNLinking.canOpenURL(url);
export const createURL = (path: string) => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `proset://${cleanPath}`;
};
export const addEventListener = (type: string, handler: any) => RNLinking.addEventListener(type as "url", handler);

export const Linking = {
  openURL,
  canOpenURL,
  createURL,
  addEventListener,
};
