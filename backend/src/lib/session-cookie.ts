import type { CookieOptions, Response } from "express";

export type SessionCookieConfiguration = {
  cookieName: string;
  secure: boolean;
};

function cookieOptions(
  configuration: SessionCookieConfiguration,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: configuration.secure,
    path: "/",
  };
}

export function setSessionCookie(
  response: Response,
  configuration: SessionCookieConfiguration,
  token: string,
  expiresAt: Date,
): void {
  response.cookie(configuration.cookieName, token, {
    ...cookieOptions(configuration),
    expires: expiresAt,
  });
}

export function clearSessionCookie(
  response: Response,
  configuration: SessionCookieConfiguration,
): void {
  response.clearCookie(
    configuration.cookieName,
    cookieOptions(configuration),
  );
}

export function readCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  let value: string | null = null;

  for (const segment of cookieHeader.split(";")) {
    const separatorIndex = segment.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const name = segment.slice(0, separatorIndex).trim();
    if (name !== cookieName) {
      continue;
    }

    if (value !== null) {
      return null;
    }

    try {
      value = decodeURIComponent(segment.slice(separatorIndex + 1).trim());
    } catch {
      return null;
    }
  }

  return value;
}
