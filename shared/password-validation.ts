export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialCharacter: boolean;
}

export type PasswordValidationErrorCode =
  | "minLength"
  | "missingUppercase"
  | "missingLowercase"
  | "missingNumber"
  | "missingSpecialCharacter";

export interface PasswordValidationResult {
  valid: boolean;
  errorCode?: PasswordValidationErrorCode;
  minLength?: number;
}

const DEFAULT_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialCharacter: true,
};

const ADMIN_REQUIREMENTS: PasswordRequirements = {
  minLength: 32,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialCharacter: true,
};

export function getPasswordRequirements(isAdmin: boolean): PasswordRequirements {
  return isAdmin ? ADMIN_REQUIREMENTS : DEFAULT_REQUIREMENTS;
}

export function validatePassword(
  password: string,
  isAdmin: boolean = false,
): PasswordValidationResult {
  const reqs = getPasswordRequirements(isAdmin);

  if (password.length < reqs.minLength) {
    return { valid: false, errorCode: "minLength", minLength: reqs.minLength };
  }

  if (reqs.requireUppercase && !/[A-Z]/.test(password)) {
    return { valid: false, errorCode: "missingUppercase" };
  }

  if (reqs.requireLowercase && !/[a-z]/.test(password)) {
    return { valid: false, errorCode: "missingLowercase" };
  }

  if (reqs.requireNumbers && !/[0-9]/.test(password)) {
    return { valid: false, errorCode: "missingNumber" };
  }

  if (reqs.requireSpecialCharacter && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return { valid: false, errorCode: "missingSpecialCharacter" };
  }

  return { valid: true };
}
