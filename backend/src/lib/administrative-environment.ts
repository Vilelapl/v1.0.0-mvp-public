import { normalizeEmail } from "./normalization.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 254;
const MINIMUM_PASSWORD_LENGTH = 12;

export class AdministrativeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdministrativeConfigurationError";
  }
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim().length === 0) {
    throw new AdministrativeConfigurationError(
      `${name} must be set to a non-empty value.`,
    );
  }

  return value;
}

export function readBootstrapEmail(): string {
  const email = normalizeEmail(
    requireEnvironmentVariable("BOOTSTRAP_USER_EMAIL"),
  );

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new AdministrativeConfigurationError(
      "BOOTSTRAP_USER_EMAIL must contain a valid email address.",
    );
  }

  return email;
}

export function readBootstrapPassword(): string {
  const password = requireEnvironmentVariable("BOOTSTRAP_USER_PASSWORD");

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new AdministrativeConfigurationError(
      `BOOTSTRAP_USER_PASSWORD must contain at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    );
  }

  return password;
}
