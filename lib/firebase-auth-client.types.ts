export type FirebaseClientIdentity = {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
};

export type FirebaseClientSession = {
  identity: FirebaseClientIdentity;
  idToken: string;
};

export type FirebaseMfaHint = {
  uid: string;
  displayName: string | null;
  factorId: string;
};

export type FirebasePasswordSignInResult =
  | {
      status: "signed_in";
      session: FirebaseClientSession;
    }
  | {
      status: "mfa_required";
      challengeId: string;
      hints: FirebaseMfaHint[];
    };

export type FirebaseTotpEnrollment = {
  secretKey: string;
  qrCodeUrl: string;
};

export type FirebaseTokenListener = (
  session: FirebaseClientSession | null,
) => void | Promise<void>;
