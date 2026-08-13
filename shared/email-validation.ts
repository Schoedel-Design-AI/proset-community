const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMMON_DOMAIN_FIXES: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.om": "gmail.com",
  "gmaol.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
};

export interface EmailValidationResult {
  valid: boolean;
  normalizedEmail?: string;
  error?: string;
  suggestedEmail?: string;
}

export function validateEmailAddress(rawEmail: string): EmailValidationResult {
  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (!normalizedEmail) {
    return { valid: false, error: "Email is required." };
  }

  if (!EMAIL_REGEX.test(normalizedEmail)) {
    return { valid: false, normalizedEmail, error: "Please enter a valid email address." };
  }

  const [localPart, domain] = normalizedEmail.split("@");
  const suggestedDomain = COMMON_DOMAIN_FIXES[domain];
  if (suggestedDomain) {
    const suggestedEmail = `${localPart}@${suggestedDomain}`;
    return {
      valid: false,
      normalizedEmail,
      suggestedEmail,
      error: `Please check the email address. Did you mean ${suggestedEmail}?`,
    };
  }

  return { valid: true, normalizedEmail };
}
