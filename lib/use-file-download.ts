/**
 * One download interaction for every screen: busy state, duplicate-tap
 * protection, outcome-accurate confirmation, and a failure dialog that offers
 * recovery actions instead of silently redirecting the file somewhere else
 * (issues #190 / #201).
 */
import { useCallback, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { useLanguage } from "./i18n";
import {
  DownloadFailedError,
  saveToDevice,
  type SaveToDeviceInput,
} from "./downloads";
import { downloadOutcomeMessageKey, intentForFailureAction } from "./download-plan";

type SavedHandler = (fileName: string, messageKey: string) => void;

export function useFileDownload(onSaved: SavedHandler) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  // A ref, not the state value: two taps in the same frame would both read a
  // stale `busyId` and start duplicate work.
  const inFlight = useRef(false);

  const reportGenericFailure = useCallback(() => {
    if (Platform.OS === "web") {
      alert(t("detail.exportFailed"));
    } else {
      Alert.alert(t("detail.exportFailedTitle"), t("detail.exportFailed"));
    }
  }, [t]);

  const save = useCallback(
    async (input: SaveToDeviceInput, id = "download"): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusyId(id);
      try {
        const result = await saveToDevice(input);
        // A dismissed picker is neutral: no error, no success claim.
        if (result.delivery === "cancelled") return;
        const messageKey = downloadOutcomeMessageKey(result.delivery);
        if (result.confirmed && messageKey) onSaved(result.fileName, messageKey);
      } catch (err) {
        if (err instanceof DownloadFailedError && err.actions.length > 0) {
          Alert.alert(
            t("detail.saveFailedTitle"),
            input.fileName,
            [
              { text: t("common.cancel"), style: "cancel" as const },
              ...err.actions.map((action) => ({
                text: action === "choose-location" ? t("detail.chooseLocation") : t("detail.shareFile"),
                onPress: () => {
                  void save({ ...input, intent: intentForFailureAction(action) }, id);
                },
              })),
            ],
          );
          return;
        }
        console.error("Download failed:", err);
        reportGenericFailure();
      } finally {
        inFlight.current = false;
        setBusyId(null);
      }
    },
    [onSaved, reportGenericFailure, t],
  );

  return {
    save,
    /** Id passed to `save()`, so a single control can show its own spinner. */
    busyId,
    isBusy: busyId !== null,
    /** Accessible label for a control in the busy state. */
    busyLabel: t("detail.preparingDownload"),
  };
}
