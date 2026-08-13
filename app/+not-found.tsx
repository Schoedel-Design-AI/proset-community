import { Link, Stack } from "@/lib/navigation";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTextScale, sf, type TextScale } from "@/lib/typography";
import Colors from "@/constants/colors";

export default function NotFoundScreen() {
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn&apos;t exist.</Text>
        <Text style={styles.subtitle}>The link you followed may be broken, or the page may have been moved.</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to home screen</Text>
        </Link>
      </View>
    </>
  );
}

const makeStyles = (ts: TextScale) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: Colors.background,
  },
  title: {
    fontSize: sf(22, ts),
    fontWeight: "700",
    color: Colors.text,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 10,
    fontSize: sf(14, ts),
    color: Colors.textMuted,
    textAlign: "center",
    maxWidth: 360,
    lineHeight: 20,
  },
  link: {
    display: "flex",
    minHeight: 48,
    marginTop: 22,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  linkText: {
    fontSize: sf(15, ts),
    color: Colors.white,
    fontWeight: "600",
  },
});
