import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
import ConversionIcon from "@/components/ConversionIcon";
import { useLanguage } from "@/lib/i18n";
import { useTextScale, sf } from "@/lib/typography";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { CONVERSION_COMPLEXITY_GROUPS, CONVERSION_COMPLEXITY_MAP, PACK_GROUPS } from "@/lib/utils";

export type PickableConversionType = {
  value: string;
  label: string;
  icon: string;
  module?: string;
};

const COMPLEXITY_ACCENTS: Record<string, string> = {
  simple: "#00B4D8",
  intermediate: "#A78BFA",
  advanced: "#F59E0B",
};

/**
 * The conversion-type picker, as a sheet: search field on top, then Recents, then the
 * core types grouped by complexity, then one section per shipped pack, each under its
 * own accent colour.
 *
 * Shared by the Thought Thread page — where it replaced a wall of 44 wrapping chips
 * (Barry, 2026-09-30: "this is way too many chips to have all in one place") — and by
 * the recording screen's convert menu, which carried a search query with no setter and
 * no input, so its search filters never ran.
 *
 * `types` is the list to SHOW; whether a type may be used is the host's question,
 * answered through `isLocked`, `isDone` and `lockedLabelFor`. That keeps the two
 * callers' different intents intact: the Thought Thread page hands over an
 * already-offered list (nothing appears that the account cannot use), while the
 * recording menu lists everything and marks what is out of reach so the tap can offer
 * the upgrade.
 */
export default function ConversionTypePicker({
  visible,
  onClose,
  types,
  selectedType,
  onSelect,
  recentTypes,
  title,
  isLocked,
  onLockedPress,
  lockedLabelFor,
  isDone,
  doneLabel,
  showDoneCounts,
  headerExtras,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  types: readonly PickableConversionType[];
  selectedType?: string;
  onSelect: (value: string) => void;
  recentTypes?: readonly string[];
  title?: string;
  isLocked?: (value: string) => boolean;
  onLockedPress?: (value: string) => void;
  lockedLabelFor?: (value: string) => string;
  isDone?: (value: string) => boolean;
  doneLabel?: string;
  showDoneCounts?: boolean;
  headerExtras?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const ts = useTextScale();
  const layout = useResponsiveLayout();
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState("");

  // Drag the handle up to elongate the sheet, down to shrink it — the behaviour the
  // recording screen's convert menu had before this component owned it. Reset on open.
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const measuredHeightRef = useRef(0);
  const dragStartRef = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartRef.current = sheetHeight ?? measuredHeightRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const natural = measuredHeightRef.current || windowHeight * 0.5;
        const minHeight = Math.min(windowHeight * 0.4, natural);
        const maxHeight = windowHeight * 0.94;
        setSheetHeight(Math.max(minHeight, Math.min(maxHeight, dragStartRef.current - gesture.dy)));
      },
    }),
  ).current;
  React.useEffect(() => {
    if (visible) setSheetHeight(null);
  }, [visible]);

  const labelOf = useCallback((type: PickableConversionType) => t(`conversion.${type.value}` as any), [t]);

  const matches = useCallback(
    (type: PickableConversionType) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return labelOf(type).toLowerCase().includes(needle);
    },
    [labelOf, query],
  );

  const byLabel = useCallback(
    (a: PickableConversionType, b: PickableConversionType) => labelOf(a).localeCompare(labelOf(b)),
    [labelOf],
  );

  const offered = useMemo(() => new Map(types.map((type) => [type.value, type])), [types]);

  const recents = useMemo(
    () => (recentTypes || []).map((value) => offered.get(value)).filter((type): type is PickableConversionType => !!type),
    [offered, recentTypes],
  );

  const coreGroups = useMemo(
    () => CONVERSION_COMPLEXITY_GROUPS.map((group) => ({
      key: group.key,
      labelKey: group.labelKey,
      icon: group.icon,
      accent: COMPLEXITY_ACCENTS[group.key] || Colors.primary,
      items: types
        .filter((type) => !type.module && CONVERSION_COMPLEXITY_MAP[type.value] === group.key && matches(type))
        .sort(byLabel),
    })).filter((group) => group.items.length > 0),
    [byLabel, matches, types],
  );

  const packGroups = useMemo(
    () => PACK_GROUPS.map((pack) => ({
      ...pack,
      items: types.filter((type) => type.module === pack.moduleName && matches(type)).sort(byLabel),
    })).filter((pack) => pack.items.length > 0),
    [byLabel, matches, types],
  );

  const nothingMatches = coreGroups.length === 0 && packGroups.length === 0;

  const renderItem = (type: PickableConversionType, accent?: string) => {
    const locked = isLocked?.(type.value) === true;
    const done = !locked && isDone?.(type.value) === true;
    const isSelected = type.value === selectedType;
    const subtitle = done ? doneLabel : locked ? lockedLabelFor?.(type.value) : undefined;
    return (
      <Pressable
        key={type.value}
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed, locked && styles.itemLocked]}
        onPress={() => {
          if (locked) {
            onLockedPress?.(type.value);
            return;
          }
          onSelect(type.value);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: locked }}
        accessibilityLabel={labelOf(type)}
      >
        <View style={[styles.itemIcon, { backgroundColor: `${accent || Colors.primary}1F` }]}>
          {locked ? (
            <Feather name="lock" size={17} color={Colors.textMuted} />
          ) : done ? (
            <Feather name="check" size={19} color={Colors.success} />
          ) : (
            <ConversionIcon name={type.icon} size={18} color={accent || Colors.primary} />
          )}
        </View>
        <View style={styles.itemTextColumn}>
          <Text
            style={[styles.itemText, { fontSize: ts.body2 }, locked && { color: Colors.textMuted }, done && styles.itemTextDone]}
            numberOfLines={2}
          >
            {labelOf(type)}
          </Text>
          {subtitle ? <Text style={styles.itemSubtitle}>{subtitle}</Text> : null}
        </View>
        {!locked && isSelected ? <Feather name="check" size={16} color={Colors.primary} /> : null}
      </Pressable>
    );
  };

  const doneCountFor = (items: readonly PickableConversionType[]) =>
    showDoneCounts ? items.filter((type) => !isLocked?.(type.value) && isDone?.(type.value) === true).length : 0;

  const sectionHeader = (accent: string, icon: string, label: string, doneCount: number) => (
    <View style={styles.sectionHeaderRow} accessibilityRole="header">
      <View style={[styles.sectionAccentDot, { backgroundColor: accent }]} />
      <Feather name={icon as any} size={13} color={accent} />
      <Text style={[styles.sectionHeaderLabel, { fontSize: sf(11, ts), color: accent }]}>{label}</Text>
      {doneCount > 0 ? (
        <View style={styles.sectionDonePill}>
          <Feather name="check" size={9} color={Colors.success} />
          <Text style={styles.sectionDonePillText}>{doneCount}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable
        style={[styles.overlay, !layout.isMobile && styles.overlayCentered]}
        onPress={onClose}
        accessibilityLabel={t("common.close")}
        accessibilityRole="button"
      >
        <Pressable
          style={[
            styles.sheet,
            !layout.isMobile && styles.sheetCentered,
            sheetHeight != null && { height: sheetHeight, maxHeight: sheetHeight },
          ]}
          onPress={(event) => event.stopPropagation?.()}
          onLayout={(event) => { measuredHeightRef.current = event.nativeEvent.layout.height; }}
        >
          {layout.isMobile ? (
            <View style={styles.handleTouchZone} {...panResponder.panHandlers}>
              <View style={styles.handle} />
            </View>
          ) : null}
          <View style={styles.header}>
            <Text style={[styles.title, { fontSize: ts.heading3 }]} accessibilityRole="header">
              {title || t("conversionPicker.title")}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.closeButton}
              accessibilityLabel={t("common.close")}
              accessibilityRole="button"
            >
              <Feather name="x" size={18} color={Colors.text} />
            </Pressable>
          </View>

          {headerExtras}

          <View style={styles.searchRow}>
            <Feather name="search" size={16} color={Colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("conversionPicker.search")}
              placeholderTextColor={Colors.textMuted}
              style={[styles.searchInput, { fontSize: ts.body2 }]}
              accessibilityLabel={t("conversionPicker.search")}
              autoCorrect={false}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("conversionPicker.clearSearch")}
              >
                <Feather name="x" size={15} color={Colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {recents.length > 0 && !query.trim() ? (
              <View style={styles.section}>
                {sectionHeader(Colors.textMuted, "clock", t("detail.recentTypes"), 0)}
                {recents.map((type) => renderItem(type))}
              </View>
            ) : null}

            {coreGroups.map((group) => (
              <View key={group.key} style={styles.section}>
                {sectionHeader(group.accent, group.icon, t(group.labelKey as any), doneCountFor(group.items))}
                {group.items.map((type) => renderItem(type, group.accent))}
              </View>
            ))}

            {packGroups.map((pack) => (
              <View key={pack.moduleName} style={styles.section}>
                {sectionHeader(pack.accent, pack.icon, t(pack.labelKey as any), doneCountFor(pack.items))}
                {pack.items.map((type) => renderItem(type, pack.accent))}
              </View>
            ))}

            {footer}

            {nothingMatches ? (
              <Text style={[styles.empty, { fontSize: ts.body2 }]}>
                {t("conversionPicker.empty", { query: query.trim() })}
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: "flex-end" },
  overlayCentered: { justifyContent: "center", alignItems: "center", padding: 32 },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, maxHeight: "86%" },
  sheetCentered: { borderRadius: 20, width: "92%", maxWidth: 760, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", paddingHorizontal: 24 },
  handleTouchZone: { alignSelf: "stretch", alignItems: "center", paddingVertical: 10, marginTop: -10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceHighlight, alignSelf: "center", marginTop: 12, marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, marginBottom: 10 },
  title: { color: Colors.text, fontFamily: "Inter_700Bold", flex: 1 },
  closeButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.surfaceHighlight, justifyContent: "center", alignItems: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceHighlight, paddingHorizontal: 12, marginBottom: 4 },
  searchInput: { flex: 1, color: Colors.text, fontFamily: "Inter_400Regular", paddingVertical: 10 },
  scroll: { marginTop: 4 },
  scrollContent: { paddingBottom: 8 },
  section: { marginBottom: 2 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingTop: 14, paddingBottom: 6 },
  sectionAccentDot: { width: 4, height: 4, borderRadius: 2 },
  sectionHeaderLabel: { fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 1, flex: 1 },
  sectionDonePill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(74, 222, 128, 0.1)", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  sectionDonePillText: { fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.success },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12, minHeight: 44 },
  itemPressed: { backgroundColor: Colors.surfaceHighlight },
  itemLocked: { opacity: 0.5 },
  itemIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: "rgba(0, 180, 216, 0.12)", alignItems: "center", justifyContent: "center" },
  itemTextColumn: { flex: 1, gap: 2 },
  itemText: { color: Colors.text, fontFamily: "Inter_500Medium" },
  itemTextDone: { color: Colors.textSecondary },
  itemSubtitle: { color: Colors.textMuted, fontFamily: "Inter_400Regular", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  empty: { color: Colors.textMuted, fontFamily: "Inter_400Regular", paddingVertical: 24, textAlign: "center" },
});
