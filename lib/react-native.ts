export * from "react-native-web";

// Re-export common React Native web modules
import React from "react";

export const TurboModuleRegistry = {
  get: (name: string) => null,
  getEnforcing: (name: string) => null,
};

export const PermissionsAndroid = {
  request: async () => "denied",
  requestMultiple: async () => ({}),
  check: async () => false,
  RESULTS: {
    GRANTED: "granted",
    DENIED: "denied",
    NEVER_ASK_AGAIN: "never_ask_again",
  },
  PERMISSIONS: {},
};

export class DrawerLayoutAndroid extends React.Component<any> {
  render() {
    return null;
  }
}
