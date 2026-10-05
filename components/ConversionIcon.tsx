import React from "react";
import Feather from "@react-native-vector-icons/feather/static";
import FontAwesome from "@react-native-vector-icons/fontawesome/static";

/**
 * Renders a conversion type's icon.
 *
 * Most conversion types name a Feather icon, but `linkedin_post` names "linkedin",
 * which Feather does not have — it lives in the FontAwesome set (and in
 * lib/FontAwesome.web.tsx on web). Two screens had grown their own copy of this
 * mapping; the conversion picker needs the same behaviour, so it lives here once.
 */
export default function ConversionIcon({ name, size, color }: { name: string; size: number; color: string }) {
  if (name === "linkedin") {
    return <FontAwesome name="linkedin-square" size={size} color={color} />;
  }
  return <Feather name={name as any} size={size} color={color} />;
}
