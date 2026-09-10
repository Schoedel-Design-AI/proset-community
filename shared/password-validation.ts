export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialCharacter: boolean;
}

export type PasswordValidationErrorCode = "minLength";

export interface PasswordValidationResult {
  valid: boolean;
  errorCode?: PasswordValidationErrorCode;
  minLength?: number;
}

export const USER_PASSWORD_MIN_LENGTH = 15;
export const ADMIN_PASSWORD_MIN_LENGTH = 15;

const DEFAULT_REQUIREMENTS: PasswordRequirements = {
  minLength: USER_PASSWORD_MIN_LENGTH,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialCharacter: false,
};

const ADMIN_REQUIREMENTS: PasswordRequirements = {
  minLength: ADMIN_PASSWORD_MIN_LENGTH,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialCharacter: false,
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

  return { valid: true };
}
