import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  loadStripe,
  type Appearance,
  type Stripe,
  type StripeElements,
  type StripePaymentElement as StripePaymentElementInstance,
} from "@stripe/stripe-js";
import Colors from "@/constants/colors";
import { useLanguage } from "@/lib/i18n";
import type { StripePaymentElementProps } from "./StripePaymentElement";

// Client-exposed publishable key. Inlined by Vite's `define` block (kept in
// sync with server/stripe-client.ts). Never a secret — it ships in the bundle.
const PUBLISHABLE_KEY =
  process.env.AIFORMS_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  process.env.AIFORMS_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST ||
  "";

// Dark, brand-matched Appearance for the Payment Element's inner fields,
// mirroring the training app's buildAppearance() but on Proset's palette.
function buildAppearance(): Appearance {
  return {
    theme: "night",
    variables: {
      colorPrimary: Colors.primary,
      colorBackground: Colors.background,
      colorText: Colors.text,
      colorTextSecondary: Colors.textSecondary,
      colorDanger: Colors.error,
      colorSuccess: Colors.success,
      colorIcon: Colors.textSecondary,
      colorIconHover: Colors.text,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      borderRadius: "10px",
      spacingUnit: "4px",
      fontSizeBase: "16px",
    },
    rules: {
      ".Input": {
        border: `1px solid ${Colors.border}`,
        boxShadow: "none",
      },
      ".Input:focus": {
        border: `1px solid ${Colors.primary}`,
        boxShadow: "none",
      },
      ".Label": {
        color: Colors.text,
        fontWeight: "600",
      },
      ".Tab": {
        border: `1px solid ${Colors.border}`,
        backgroundColor: Colors.surface,
      },
      ".Tab:hover": {
        border: `1px solid ${Colors.primary}`,
      },
      ".Tab--selected": {
        border: `1px solid ${Colors.primary}`,
        backgroundColor: Colors.surfaceLight,
      },
      ".Error": {
        color: Colors.error,
      },
    },
  };
}

/**
 * Embedded Stripe Payment Element for Proset web (React Native Web). Loads
 * Stripe.js, mounts the Payment Element into a real DOM node, and confirms a
 * PaymentIntent (mode="payment") or SetupIntent (mode="setup") in place with
 * `redirect: "if_required"` — no Checkout-Session redirect.
 */
export default function StripePaymentElement({
  mode,
  clientSecret,
  ctaLabel,
  returnUrl,
  email,
  onCancel,
  onSuccess,
}: StripePaymentElementProps) {
  const { language } = useLanguage();
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const mountNodeRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const paymentElementRef = useRef<StripePaymentElementInstance | null>(null);

  useEffect(() => {
    if (!PUBLISHABLE_KEY) {
      setError(
        language === "es"
          ? "El pago no está configurado en este sitio."
          : "Payment is not configured on this site.",
      );
      return;
    }
    let alive = true;
    loadStripe(PUBLISHABLE_KEY)
      .then((s) => {
        if (!alive) return;
        if (s) {
          setStripe(s);
        } else {
          setError(
            language === "es"
              ? "No se pudo cargar el pago seguro. Inténtalo de nuevo."
              : "Could not load secure payment. Please try again.",
          );
        }
      })
      .catch(() => {
        if (!alive) return;
        setError(
          language === "es"
            ? "No se pudo cargar el pago seguro. Inténtalo de nuevo."
            : "Could not load secure payment. Please try again.",
        );
      });
    return () => {
      alive = false;
    };
  }, [language]);

  useEffect(() => {
    if (!stripe || !clientSecret) return;
    const elements = stripe.elements({
      clientSecret,
      appearance: buildAppearance(),
    });
    const paymentElement = elements.create("payment", { layout: "tabs" });
    elementsRef.current = elements;
    paymentElementRef.current = paymentElement;
    if (mountNodeRef.current) {
      paymentElement.mount(mountNodeRef.current);
    }
    return () => {
      paymentElement.destroy();
      elementsRef.current = null;
      paymentElementRef.current = null;
    };
  }, [stripe, clientSecret]);

  const handleConfirm = useCallback(async () => {
    if (!stripe || !elementsRef.current) return;
    setProcessing(true);
    setError("");
    try {
      if (mode === "setup") {
        const { error: confirmError } = await stripe.confirmSetup({
          elements: elementsRef.current,
          redirect: "if_required",
          confirmParams: { return_url: returnUrl },
        });
        if (confirmError) {
          setError(
            confirmError.message ||
              (language === "es"
                ? "El pago falló. Inténtalo de nuevo."
                : "Payment failed. Please try again."),
          );
        } else {
          onSuccess?.();
        }
      } else {
        const { error: confirmError } = await stripe.confirmPayment({
          elements: elementsRef.current,
          redirect: "if_required",
          confirmParams: {
            return_url: returnUrl,
            ...(email
              ? { payment_method_data: { billing_details: { email } } }
              : {}),
          },
        });
        if (confirmError) {
          setError(
            confirmError.message ||
              (language === "es"
                ? "El pago falló. Inténtalo de nuevo."
                : "Payment failed. Please try again."),
          );
        } else {
          onSuccess?.();
        }
      }
    } catch {
      setError(
        language === "es"
          ? "El pago falló. Vuelve a intentarlo."
          : "Payment failed. Please try again.",
      );
    } finally {
      setProcessing(false);
    }
  }, [stripe, mode, returnUrl, email, onSuccess, language]);

  return (
    <View style={styles.container}>
      <div
        ref={mountNodeRef}
        style={{
          minHeight: 64,
          borderRadius: 10,
          border: `1px solid ${Colors.border}`,
          background: Colors.surface,
          padding: 12,
        }}
      />
      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {onCancel ? (
          <Pressable
            style={[styles.cancelBtn, processing && styles.btnDisabled]}
            onPress={onCancel}
            disabled={processing}
            accessibilityRole="button"
          >
            <Text style={styles.cancelBtnText}>
              {language === "es" ? "Cancelar" : "Cancel"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[
            styles.confirmBtn,
            (processing || !stripe) && styles.btnDisabled,
          ]}
          onPress={handleConfirm}
          disabled={processing || !stripe}
          accessibilityRole="button"
        >
          {processing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.confirmBtnText}>{ctaLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  actions: { flexDirection: "row", gap: 10, alignItems: "center" },
  cancelBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: { color: Colors.textSecondary, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  confirmBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  confirmBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  btnDisabled: { opacity: 0.6 },
  errorText: { color: Colors.error, fontFamily: "Inter_500Medium", fontSize: 12 },
});
