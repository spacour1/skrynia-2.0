const RETURN_PATH_KEY = "returnPathBeforeLogin";

function isTrackable(path: string) {
  return path.startsWith("/") && !path.startsWith("/login") && !path.startsWith("/register");
}

/** Called on every route change so the login page can send the user back to whatever protected page redirected them here, instead of always landing on /dashboard. */
export function rememberReturnPath(path: string) {
  if (typeof window === "undefined" || !isTrackable(path)) return;
  window.sessionStorage.setItem(RETURN_PATH_KEY, path);
}

export function consumeReturnPath(fallback = "/dashboard"): string {
  if (typeof window === "undefined") return fallback;
  const stored = window.sessionStorage.getItem(RETURN_PATH_KEY);
  return stored && isTrackable(stored) ? stored : fallback;
}
