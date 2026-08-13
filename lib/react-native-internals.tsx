import React from "react";

// Default dummy React component / function
const DummyInternal = (props: any) => {
  return props?.children || null;
};
export default DummyInternal;

// Named exports commonly needed by codegen and native shims
export const supportedCommands = [];
export const codegenNativeCommands = () => ({});
export const codegenNativeComponent = (name: string, options?: any) => () => null;
export const findHostInstance_deprecated = (ref: any) => null;
export const PressabilityDebugView = () => null;
export const customDirectEventTypes = {};
export const ReactNativeViewConfigRegistry = {
  register: () => {},
  get: () => ({}),
};
export const ReactFabric = {
  unstable_createEventHandle: () => {},
};
export const ReactNative = {
  findHostInstance_deprecated: () => null,
};
