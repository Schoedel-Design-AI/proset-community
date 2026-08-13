import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "@/lib/navigation";
import { getApiUrl } from "@/lib/query-client";

export default function DocumentationRedirect() {
  useEffect(() => {
    if (Platform.OS === "web") {
      window.location.href = "/documentation/";
    } else {
      const baseUrl = getApiUrl();
      const url = new URL("/documentation/", baseUrl).toString();
      import("react-native").then(({ Linking }) => {
        Linking.openURL(url);
      });
      router.back();
    }
  }, []);

  return null;
}
