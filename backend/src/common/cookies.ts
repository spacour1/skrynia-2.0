import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const CSRF_COOKIE = "csrf_token";

const isProd = env.NODE_ENV === "production";

const baseOptions: CookieOptions = {
  secure: isProd,
  sameSite: "lax",
  domain: env.COOKIE_DOMAIN
};

export function accessCookieOptions(): CookieOptions {
  return { ...baseOptions, httpOnly: true, path: "/", maxAge: env.ACCESS_TOKEN_TTL_MIN * 60 * 1000 };
}

export function refreshCookieOptions(): CookieOptions {
  return { ...baseOptions, httpOnly: true, path: "/auth", maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 };
}

export function csrfCookieOptions(): CookieOptions {
  // Must be readable by frontend JS so it can be echoed back in the X-CSRF-Token header.
  // Lives as long as the refresh token so it stays valid across silent access-token refreshes.
  return { ...baseOptions, httpOnly: false, path: "/", maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 };
}

export function setAuthCookies(res: Response, input: { accessToken: string; refreshToken: string; csrfToken: string }) {
  res.cookie(ACCESS_COOKIE, input.accessToken, accessCookieOptions());
  res.cookie(REFRESH_COOKIE, input.refreshToken, refreshCookieOptions());
  res.cookie(CSRF_COOKIE, input.csrfToken, csrfCookieOptions());
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions, httpOnly: true, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions, httpOnly: true, path: "/auth" });
  res.clearCookie(CSRF_COOKIE, { ...baseOptions, httpOnly: false, path: "/" });
}
