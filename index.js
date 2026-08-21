import { AppRegistry } from "react-native";
import App from "./app/_layout";
import { installStructuredClonePolyfill } from "./lib/structured-clone-polyfill";

// Hermes lacks structuredClone; dicebear avatar rendering requires it.
installStructuredClonePolyfill();

AppRegistry.registerComponent("proset-native", () => App);
