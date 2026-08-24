export type StripePaymentElementMode = "payment" | "setup";

export type StripePaymentElementProps = {
  /** "payment" for a one-time PaymentIntent (AI-Credit packs); "setup" for a
   *  recurring SetupIntent (plan / storage add-on). */
  mode: StripePaymentElementMode;
  clientSecret: string;
  ctaLabel: string;
  returnUrl: string;
  email?: string;
  onCancel?: () => void;
  onSuccess?: () => void;
};

/**
 * Native (Android/iOS) placeholder. Native purchases go through Google Play via
 * RevenueCat, never the Stripe Payment Element; this stub keeps the shared
 * screens importable without pulling @stripe/stripe-js into the Metro bundle.
 * The web implementation lives in StripePaymentElement.web.tsx.
 */
export default function StripePaymentElement(_props: StripePaymentElementProps) {
  return null;
}
