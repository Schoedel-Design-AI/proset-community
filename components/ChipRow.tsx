import React from "react";
import { Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

/**
 * A row of chips that a mouse can actually reach.
 *
 * On native this stays a horizontal ScrollView: dragging with a finger is the
 * expected gesture, and the row scrolls under the thumb.
 *
 * On web the same control is a dead end for a mouse. react-native-web renders the
 * ScrollView as an overflow container, so a vertical mouse wheel scrolls the page
 * instead of the row, and `showsHorizontalScrollIndicator={false}` removes the only
 * other affordance (the scrollbar you could drag). Chips past the right edge were
 * simply unreachable on desktop.
 *
 * On web the chips therefore WRAP: every option is visible without any scrolling,
 * which is also how a desktop user expects a list of choices to behave.
 */
export function ChipRow({
  children,
  style,
  contentContainerStyle,
  testID,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (Platform.OS === "web") {
    return (
      <View testID={testID} style={[style, styles.wrap, contentContainerStyle]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
});
