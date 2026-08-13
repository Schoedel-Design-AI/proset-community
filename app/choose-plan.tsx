import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "@/lib/navigation";
import Feather from "@react-native-vector-icons/feather/static";
import { useSafeAreaInsets } from "react-native-safe-area-context";
const expoFetch = globalThis.fetch;
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { sf, useTextScale, type TextScale } from "@/lib/typography";
import { useLanguage } from "@/lib/i18n";
import { getPlanFeatures, PLAN_PRICES } from "@shared/plan-limits";
import { getEarlyAdopterPrice } from "@shared/stripe-catalog";
import { trackPlausibleEvent, trackPlausibleEventOnce } from "@/lib/plausible";
import {
  findRevenueCatPackage,
  getOfferings,
  purchasePackage,
  purchaseResultHasExpectedAccess,
  setupPurchases,
  syncRevenueCatPurchase,
} from "@/lib/purchases";
import type { PurchasesOffering, PurchasesPackage } from "react-native-purchases";

type BillingInterval = "month" | "year";
type PublicTier = "free" | "base" | "pro";
type DisplayTier = PublicTier;

type SubscriptionResponse = {
  tier?: string | null;
  displayTier?: string | null;
  active?: boolean;
  billingSources?: {
    stripe?: boolean;
    revenueCat?: boolean;
  };
  checkout?: {
    amountTotal: number | null;
    currency: string | null;
  };
  friendsOfBarry?: {
    active: boolean;
    termMonths: number;
    grantedAt: string | null;
    renewedAt: string | null;
    expiresAt: string | null;
    daysRemaining: number | null;
  } | null;
};

type CloudSyncStatus = {
  enabled?: boolean;
  syncAllowed?: boolean;
  inGracePeriod?: boolean;
};

const PLAN_COPY: Record<PublicTier, {
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
  recommended?: boolean;
}> = {
  free: {
    ...PLAN_PRICES.free,
    description: "Start with core voice capture and lighter conversions.",
    features: getPlanFeatures("free"),
  },
  base: {
    ...PLAN_PRICES.base,
    description: "For day-to-day use across all standard Proset workflows.",
    recommended: true,
    features: getPlanFeatures("base"),
  },
  pro: {
    ...PLAN_PRICES.pro,
    description: "For heavier work with advanced usage behavior already included.",
    features: getPlanFeatures("pro"),
  },
};


function normalizePlanTier(tier?: string | null): PublicTier {
  const normalizedTier = String(tier || "").toLowerCase();
  if (normalizedTier === "pro") return "pro";
  if (normalizedTier === "base" || normalizedTier === "plus" || normalizedTier === "cloud_plus") return "base";
  return "free";
}

function normalizeDisplayTier(tier?: string | null, displayTier?: string | null): DisplayTier {
  const normalizedDisplay = String(displayTier || tier || "").toLowerCase();
  return normalizePlanTier(normalizedDisplay);
}

function formatPrice(cents: number) {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
}

export default function ChoosePlanScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const { language } = useLanguage();
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [currentTier, setCurrentTier] = useState<PublicTier>("free");
  const [displayTier, setDisplayTier] = useState<DisplayTier>("free");
  const [, setCloudSyncActive] = useState(false);
  const [stateLoading, setStateLoading] = useState(true);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [hasActiveWebSubscription, setHasActiveWebSubscription] = useState(false);

  const [promoCode, setPromoCode] = useState("");
  const [redeemingPromo, setRedeemingPromo] = useState(false);
  const [promoMessage, setPromoMessage] = useState<{type: "error"|"success", text: string} | null>(null);
  const handleRedeemPromo = useCallback(async () => {
    const code = promoCode.trim();
    if (!code) return;
    setRedeemingPromo(true);
    setPromoMessage(null);
    try {
      const baseUrl = getApiUrl();
      const response = await expoFetch(new URL("/api/stripe/redeem-coupon", baseUrl).toString(), {
        method: "POST",
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Invalid promo code.");
      }
      setPromoMessage({ type: "success", text: `Success! You now have ${data.tier} access.` });
      setPromoCode("");
      await refreshUser();
      
      const [subscriptionRes] = await Promise.all([
        expoFetch(new URL("/api/stripe/subscription", baseUrl).toString(), {
          credentials: "include",
          headers: getAuthHeaders(),
        }).then((response) => response.ok ? response.json() : null).catch(() => null),
      ]);
      const subscription = subscriptionRes as SubscriptionResponse | null;
        if (subscription) {
          setCurrentTier(normalizePlanTier(subscription.tier));
          setDisplayTier(normalizeDisplayTier(subscription.tier, subscription.displayTier));
          setHasActiveWebSubscription(subscription.billingSources?.stripe === true);
        }
    } catch (err: any) {
      setPromoMessage({ type: "error", text: err?.message || "Invalid promo code." });
    } finally {
      setRedeemingPromo(false);
    }
  }, [promoCode, refreshUser]);

  useEffect(() => {
    const loadState = async () => {
      setStateLoading(true);
      try {
        const baseUrl = getApiUrl();
        const billingStatus = Platform.OS === "web"
          ? await expoFetch(new URL("/api/stripe/status", baseUrl).toString(), {
              credentials: "include",
              headers: getAuthHeaders(),
            }).then((response) => response.ok ? response.json() : { enabled: false }).catch(() => ({ enabled: false }))
          : { enabled: true };
        const webBillingEnabled = billingStatus?.enabled !== false;
        setBillingEnabled(webBillingEnabled);
        if (Platform.OS === "web") {
          const params = new URLSearchParams(window.location.search);
          const sessionId = params.get("session_id");
          if (webBillingEnabled && params.get("subscription") === "success" && sessionId) {
            const reconciliation = await expoFetch(new URL("/api/stripe/reconcile-checkout", baseUrl).toString(), {
              method: "POST",
              credentials: "include",
              headers: {
                ...getAuthHeaders(),
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sessionId }),
            });
            if (!reconciliation.ok) {
              throw new Error("Your payment succeeded, but Proset is still verifying the subscription. Refresh this page in a moment.");
            }
            const confirmedSubscription = await reconciliation.json() as SubscriptionResponse;
            const confirmedTier = normalizePlanTier(confirmedSubscription.tier);
            if (confirmedSubscription.active && confirmedTier !== "free") {
              const amountTotal = confirmedSubscription.checkout?.amountTotal;
              const currency = confirmedSubscription.checkout?.currency?.toUpperCase();
              trackPlausibleEventOnce(`subscription-purchase:${sessionId}`, "subscription_purchase", {
                props: {
                  plan: confirmedTier,
                  billing_source: "stripe",
                },
                ...(currency === "USD" && typeof amountTotal === "number"
                  ? { revenue: { currency: "USD", amount: amountTotal / 100 } }
                  : {}),
              });
            }
            await refreshUser();
            window.history.replaceState({}, "", "/choose-plan");
          }
        } else {
          await setupPurchases(user?.id);
          const offerings = await getOfferings();
          setOffering(offerings?.current || null);
        }

        const [subscriptionRes, cloudSyncRes] = await Promise.all([
          webBillingEnabled
            ? expoFetch(new URL("/api/stripe/subscription", baseUrl).toString(), {
                credentials: "include",
                headers: getAuthHeaders(),
              }).then((response) => response.ok ? response.json() : null).catch(() => null)
            : Promise.resolve(null),
          expoFetch(new URL("/api/cloud-sync", baseUrl).toString(), {
            credentials: "include",
            headers: getAuthHeaders(),
          }).then((response) => response.ok ? response.json() : null).catch(() => null),
        ]);

        const subscription = subscriptionRes as SubscriptionResponse | null;
        const cloudSync = cloudSyncRes as CloudSyncStatus | null;

        setCurrentTier(normalizePlanTier(subscription?.tier));
        setDisplayTier(normalizeDisplayTier(subscription?.tier, subscription?.displayTier));
        setCloudSyncActive(Boolean(cloudSync?.enabled || cloudSync?.syncAllowed || cloudSync?.inGracePeriod));
      } finally {
        setStateLoading(false);
      }
    };

    loadState();
  }, [refreshUser, user?.id]);

  const findNativePackage = useCallback((plan: PublicTier, interval: BillingInterval): PurchasesPackage | undefined => {
    if (plan === "free") return undefined;
    return findRevenueCatPackage(offering, plan, interval);
  }, [offering]);

  const handleSelectPlan = useCallback(async (planKey: PublicTier) => {
    setLoading(planKey);
    setError("");

    if (Platform.OS === "web") {
      trackPlausibleEvent("plan_selected", {
        props: { plan: planKey, interval: billingInterval },
      });
    }

    try {
      if (planKey === "free") {
        const baseUrl = getApiUrl();
        const response = await expoFetch(new URL("/api/plan-selection/complete", baseUrl).toString(), {
          method: "POST",
          credentials: "include",
          headers: {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error("Could not save your plan selection.");
        }

        await refreshUser();
        router.replace("/");
        return;
      }

      if (Platform.OS !== "web") {
        const pkg = findNativePackage(planKey, billingInterval);
        if (!pkg) {
          throw new Error(
            language === "es"
              ? "Esta suscripción de Google Play aún no está disponible."
              : "This Google Play subscription is not available yet.",
          );
        }
        try {
          const customerInfo = await purchasePackage(pkg);
          if (!purchaseResultHasExpectedAccess(customerInfo, planKey)) {
            throw new Error(
              language === "es"
                ? "Google Play completó la compra, pero el acceso de Proset aún no está activo."
                : "Google Play completed the purchase, but the Proset entitlement is not active yet.",
            );
          }
        } catch (purchaseError: any) {
          if (purchaseError?.userCancelled) return;
          throw purchaseError;
        }
        await expoFetch(new URL("/api/plan-selection/complete", getApiUrl()).toString(), {
          method: "POST",
          credentials: "include",
          headers: {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
          },
        });
        await syncRevenueCatPurchase();
        await refreshUser();
        router.replace("/");
        return;
      }

      // Web-only Early Adopter checkout. Native subscriptions stay in Google
      // Play through RevenueCat and are never sent to Stripe.
      const baseUrl = getApiUrl();
      const response = await expoFetch(new URL("/api/stripe/checkout-plan", baseUrl).toString(), {
        method: "POST",
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan: planKey, interval: billingInterval }),
      });
      const data = await response.json();
      if (data?.url) {
        if (Platform.OS === "web") {
          trackPlausibleEvent("checkout_start", {
            props: { plan: planKey, interval: billingInterval },
          });
          window.location.href = data.url;
        } else {
          await Linking.openURL(data.url);
        }
      } else {
        setError("Could not start checkout. Please try again.");
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }, [billingInterval, findNativePackage, language, refreshUser]);

  const webTopPadding = Platform.OS === "web" ? 24 : 0;
  const intervalLabel = billingInterval === "month"
    ? (language === "es" ? "/mes" : "/month")
    : (language === "es" ? "/año" : "/year");

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopPadding }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Feather name="layers" size={30} color={Colors.primary} />
          <Text style={styles.title}>
            {language === "es" ? "Elige tu plan" : "Choose Your Plan"}
          </Text>
          <Text style={styles.subtitle}>
            {language === "es"
              ? "Free, Base y Pro. Paga anualmente y recibe 2 meses gratis."
              : "Free, Base, and Pro. Pay annually and get 2 months free."}
          </Text>
        </View>

        <View style={styles.intervalToggle}>
          {([
            { key: "month" as const, label: language === "es" ? "Mensual" : "Monthly" },
            { key: "year" as const, label: language === "es" ? "Anual" : "Annual" },
          ]).map((option) => {
            const isActive = billingInterval === option.key;
            return (
              <Pressable
                key={option.key}
                style={[styles.intervalBtn, isActive && styles.intervalBtnActive]}
                onPress={() => setBillingInterval(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.intervalBtnText, isActive && styles.intervalBtnTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {stateLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading current plan…</Text>
          </View>
        ) : null}

        {Platform.OS === "web" && !billingEnabled ? (
          <View style={styles.errorBanner}>
            <Feather name="info" size={16} color={Colors.textSecondary} />
            <Text style={styles.errorText}>Billing is disabled in this Community Edition build. Use the hosted Proset at proset.ai for subscriptions.</Text>
          </View>
        ) : null}

        <View style={styles.plansContainer}>
          {(["free", "base", "pro"] as PublicTier[]).map((planKey) => {
            const plan = PLAN_COPY[planKey];
            const isCurrent = currentTier === planKey;
            const displayedPrice = billingInterval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
            const billingUnavailable = Platform.OS === "web" && !billingEnabled && planKey !== "free";
            const isDiscounted = Platform.OS === "web" && billingEnabled && planKey !== "free";
            const discountedPrice = isDiscounted ? getEarlyAdopterPrice(displayedPrice) : displayedPrice;
            const nativePackage = Platform.OS !== "web" && planKey !== "free"
              ? findNativePackage(planKey, billingInterval)
              : undefined;
            const nativeBillingUnavailable =
              Platform.OS !== "web" && planKey !== "free" && !nativePackage;
            const nativeBillingBlockedByWeb =
              Platform.OS !== "web" && planKey !== "free" && hasActiveWebSubscription;
            const displayedPriceLabel = nativePackage?.product.priceString
              || (nativeBillingUnavailable
                ? (language === "es" ? "No disponible" : "Unavailable")
                : formatPrice(discountedPrice));
            const actionLabel = planKey === "free"
              ? (language === "es" ? "Continuar con Free" : "Continue with Free")
              : billingUnavailable
                ? (language === "es" ? "No disponible en pruebas" : "Unavailable on staging")
              : nativeBillingBlockedByWeb
                ? (language === "es" ? "Administrado en la web" : "Managed on web")
              : nativeBillingUnavailable
                ? (language === "es" ? "No disponible en Google Play" : "Unavailable in Google Play")
              : `${isCurrent
                ? (language === "es" ? "Plan actual" : "Current Plan")
                : `${language === "es" ? "Elegir" : "Choose"} ${plan.name}`} ${plan.monthlyPrice ? `${displayedPriceLabel}${intervalLabel}` : ""}`;

            return (
              <View
                key={planKey}
                style={[
                  styles.planCard,
                  plan.recommended && styles.planCardRecommended,
                  isCurrent && styles.planCardCurrent,
                ]}
              >
                <View style={styles.planHeaderRow}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  {plan.recommended ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Recommended</Text>
                    </View>
                  ) : null}
                  {isCurrent ? (
                    <View style={[styles.badge, styles.currentBadge]}>
                      <Text style={[styles.badgeText, styles.currentBadgeText]}>Current</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.planPrice}>
                  {isDiscounted ? (
                    <Text style={{ textDecorationLine: "line-through", color: Colors.textMuted, fontSize: sf(20, ts) }}>
                      {formatPrice(displayedPrice)}
                    </Text>
                  ) : null}
                  {isDiscounted ? " " : ""}
                  {displayedPriceLabel}
                  {plan.monthlyPrice ? <Text style={styles.planPeriod}>{intervalLabel}</Text> : null}
                </Text>
                {isDiscounted ? (
                  <Text style={{ color: Colors.primary, fontFamily: "Inter_600SemiBold", fontSize: sf(13, ts), marginBottom: 8, marginTop: -4 }}>
                    50% Early Adopter discount
                  </Text>
                ) : null}
                <Text style={styles.planDescription}>{plan.description}</Text>
                <View style={styles.featuresContainer}>
                  {plan.features.map((feature) => (
                    <View key={feature} style={styles.featureRow}>
                      <Feather name="check" size={14} color={plan.recommended ? Colors.primary : Colors.textSecondary} />
                      <Text style={styles.featureText}>{feature}</Text>
                    </View>
                  ))}
                </View>
                <Pressable
                    style={[
                      styles.selectButton,
                      planKey === "free" && styles.selectButtonFree,
                      (loading === planKey || billingUnavailable || nativeBillingUnavailable || nativeBillingBlockedByWeb || (isCurrent && planKey !== "free")) && styles.selectButtonDisabled,
                    ]}
                    onPress={() => handleSelectPlan(planKey)}
                    disabled={loading !== null || billingUnavailable || nativeBillingUnavailable || nativeBillingBlockedByWeb || (isCurrent && planKey !== "free")}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading !== null || billingUnavailable || nativeBillingUnavailable || nativeBillingBlockedByWeb || (isCurrent && planKey !== "free") }}
                    testID={`select-plan-${planKey}`}
                  >
                    {loading === planKey ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Text style={[styles.selectButtonText, planKey === "free" && styles.selectButtonTextFree]}>
                        {actionLabel}
                      </Text>
                    )}
                </Pressable>
              </View>
            );
          })}
        </View>

        {Platform.OS !== "web" ? (
          <>
            {hasActiveWebSubscription ? (
              <Text style={styles.billingTerms}>
                {language === "es"
                  ? "Esta cuenta ya tiene una suscripción web activa. Adminístrala en proset.ai antes de cambiar a Google Play para evitar dos cobros."
                  : "This account already has an active web subscription. Manage it at proset.ai before switching to Google Play to avoid duplicate charges."}
              </Text>
            ) : null}
            <Text style={styles.billingTerms}>
              {language === "es"
                ? "Las suscripciones se cobran a tu cuenta de Google Play y se renuevan automáticamente por el período y precio mostrados, a menos que las canceles. Puedes administrarlas o cancelarlas en Google Play; el acceso continúa hasta el final del período pagado."
                : "Subscriptions are charged to your Google Play account and automatically renew for the displayed period and price unless canceled. You can manage or cancel in Google Play; access continues through the paid period."}
            </Text>
          </>
        ) : null}

        {Platform.OS === "web" && billingEnabled ? <View style={styles.promoContainer}>
          <Text style={styles.promoTitle}>Have a promo code?</Text>
          <View style={styles.promoInputRow}>
            <TextInput
              style={styles.promoInput}
              placeholder="Enter code"
              placeholderTextColor={Colors.textMuted}
              value={promoCode}
              onChangeText={(text) => {
                setPromoCode(text.toUpperCase());
                setPromoMessage(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!redeemingPromo}
            />
            <Pressable 
              style={[styles.promoButton, (!promoCode.trim() || redeemingPromo) && styles.promoButtonDisabled]} 
              onPress={handleRedeemPromo}
              disabled={!promoCode.trim() || redeemingPromo}
            >
              {redeemingPromo ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.promoButtonText}>Redeem</Text>}
            </Pressable>
          </View>
          {promoMessage && (
            <View style={[styles.promoMessage, promoMessage.type === "success" ? styles.promoMessageSuccess : styles.promoMessageError]}>
              <Feather name={promoMessage.type === "success" ? "check-circle" : "alert-circle"} size={14} color={promoMessage.type === "success" ? Colors.primary : Colors.error} />
              <Text style={[styles.promoMessageText, promoMessage.type === "success" ? styles.promoMessageTextSuccess : styles.promoMessageTextError]}>
                {promoMessage.text}
              </Text>
            </View>
          )}
        </View> : null}



      </ScrollView>
    </View>
  );
}

function makeStyles(ts: TextScale) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
      gap: 16,
    },
    header: {
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    title: {
      fontSize: sf(24, ts),
      fontFamily: "Inter_700Bold",
      color: Colors.text,
      textAlign: "center",
    },
    subtitle: {
      fontSize: sf(14, ts),
      color: Colors.textSecondary,
      lineHeight: sf(20, ts),
      textAlign: "center",
      maxWidth: 500,
      fontFamily: "Inter_400Regular",
    },
    intervalToggle: {
      flexDirection: "row",
      alignSelf: "center",
      backgroundColor: Colors.surface,
      borderRadius: 14,
      padding: 4,
      gap: 4,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    intervalBtn: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 10,
    },
    intervalBtnActive: {
      backgroundColor: Colors.primary,
    },
    intervalBtnText: {
      color: Colors.textSecondary,
      fontFamily: "Inter_600SemiBold",
      fontSize: sf(13, ts),
    },
    intervalBtnTextActive: {
      color: Colors.white,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "rgba(248, 113, 113, 0.1)",
      borderRadius: 12,
      padding: 12,
    },
    errorText: {
      color: Colors.error,
      fontSize: sf(13, ts),
      fontFamily: "Inter_500Medium",
      flex: 1,
    },
    loadingState: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      paddingVertical: 8,
    },
    loadingText: {
      color: Colors.textSecondary,
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
    },
    plansContainer: {
      gap: 16,
    },
    planCard: {
      backgroundColor: Colors.surface,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: Colors.border,
      gap: 10,
    },
    planCardRecommended: {
      borderColor: Colors.primary,
      borderWidth: 2,
    },
    planCardCurrent: {
      borderColor: Colors.primary,
      borderWidth: 2,
    },
    planHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    badge: {
      backgroundColor: "rgba(0,180,216,0.12)",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    badgeText: {
      color: Colors.primary,
      fontFamily: "Inter_600SemiBold",
      fontSize: sf(11, ts),
    },
    currentBadge: {
      backgroundColor: "rgba(255,255,255,0.08)",
    },
    currentBadgeText: {
      color: Colors.text,
    },
    planName: {
      color: Colors.text,
      fontSize: sf(24, ts),
      fontFamily: "Inter_700Bold",
    },
    planPrice: {
      color: Colors.text,
      fontSize: sf(34, ts),
      fontFamily: "Inter_700Bold",
    },
    planPeriod: {
      color: Colors.textSecondary,
      fontSize: sf(16, ts),
      fontFamily: "Inter_400Regular",
    },
    planDescription: {
      color: Colors.textSecondary,
      fontSize: sf(14, ts),
      lineHeight: sf(20, ts),
      fontFamily: "Inter_400Regular",
    },
    featuresContainer: {
      gap: 8,
      marginTop: 4,
    },
    featureRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    featureText: {
      flex: 1,
      color: Colors.textSecondary,
      fontSize: sf(13, ts),
      lineHeight: sf(19, ts),
      fontFamily: "Inter_400Regular",
    },
    selectButton: {
      marginTop: 6,
      backgroundColor: Colors.primary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 50,
    },
    selectButtonFree: {
      backgroundColor: Colors.surfaceLight,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    selectButtonDisabled: {
      opacity: 0.65,
    },
    selectButtonText: {
      color: Colors.white,
      fontSize: sf(14, ts),
      fontFamily: "Inter_600SemiBold",
      textAlign: "center",
    },
    selectButtonTextFree: {
      color: Colors.text,
    },
    helperText: {
      color: Colors.textSecondary,
      fontSize: sf(13, ts),
      fontFamily: "Inter_500Medium",
      lineHeight: sf(19, ts),
      marginTop: 4,
    },
    billingTerms: {
      color: Colors.textMuted,
      fontSize: sf(12, ts),
      lineHeight: sf(18, ts),
      fontFamily: "Inter_400Regular",
      textAlign: "center",
      paddingHorizontal: 8,
    },
    superAdminNote: {
      backgroundColor: Colors.surface,
      borderRadius: 16,
      padding: 18,
      borderWidth: 1,
      borderColor: Colors.border,
      gap: 6,
    },
    superAdminTitle: {
      color: Colors.text,
      fontSize: sf(18, ts),
      fontFamily: "Inter_700Bold",
      textTransform: "none",
    },
    superAdminText: {
      color: Colors.textSecondary,
      fontSize: sf(13, ts),
      fontFamily: "Inter_400Regular",
      lineHeight: sf(19, ts),
    },
    promoContainer: {
      backgroundColor: Colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: Colors.border,
      marginTop: 8,
      gap: 12,
    },
    promoTitle: {
      color: Colors.text,
      fontSize: sf(15, ts),
      fontFamily: "Inter_600SemiBold",
    },
    promoInputRow: {
      flexDirection: "row",
      gap: 8,
    },
    promoInput: {
      flex: 1,
      backgroundColor: Colors.background,
      borderWidth: 1,
      borderColor: Colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: Colors.text,
      fontSize: sf(14, ts),
      fontFamily: "Inter_500Medium",
    },
    promoButton: {
      backgroundColor: Colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      justifyContent: "center",
      alignItems: "center",
      minWidth: 80,
    },
    promoButtonDisabled: {
      opacity: 0.6,
    },
    promoButtonText: {
      color: Colors.white,
      fontSize: sf(13, ts),
      fontFamily: "Inter_600SemiBold",
    },
    promoMessage: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: 10,
      borderRadius: 8,
    },
    promoMessageSuccess: {
      backgroundColor: "rgba(0,180,216,0.1)",
    },
    promoMessageError: {
      backgroundColor: "rgba(248, 113, 113, 0.1)",
    },
    promoMessageText: {
      fontSize: sf(13, ts),
      fontFamily: "Inter_500Medium",
    },
    promoMessageTextSuccess: {
      color: Colors.primary,
    },
    promoMessageTextError: {
      color: Colors.error,
    },
  });
}
