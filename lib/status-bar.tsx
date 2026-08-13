import React from "react";
import { Platform, StatusBar as RNStatusBar } from "react-native";

export const StatusBar: React.FC<any> = ({ style, ...props }) => {
  if (Platform.OS === "web") return null;
  return <RNStatusBar barStyle={style === "light" ? "light-content" : "dark-content"} {...props} />;
};
