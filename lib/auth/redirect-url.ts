const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type AuthSiteOriginOptions = {
  siteUrl?: string | null;
  requestOrigin?: string | null;
  environment?: string;
};

function parseOrigin(value: string, environment: string): string | null {
  try {
    const url = new URL(value);
    const isLoopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    const protocolAllowed = url.protocol === "https:" || (environment !== "production" && isLoopback && url.protocol === "http:");
    if (
      !protocolAllowed ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) return null;
    if (environment === "production" && (url.protocol !== "https:" || isLoopback)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Resolve the single application origin used for auth callbacks. Production never falls back to the request host. */
export function resolveAuthSiteOrigin(options: AuthSiteOriginOptions = {}): string | null {
  const environment = options.environment ?? process.env.NODE_ENV ?? "production";
  const configured = options.siteUrl === undefined ? process.env.NEXT_PUBLIC_SITE_URL : options.siteUrl;
  if (configured?.trim()) return parseOrigin(configured.trim(), environment);

  if (environment !== "production" && options.requestOrigin) {
    const requestOrigin = parseOrigin(options.requestOrigin, environment);
    if (requestOrigin) {
      const host = new URL(requestOrigin).hostname.toLowerCase();
      return LOOPBACK_HOSTS.has(host) ? requestOrigin : null;
    }
  }
  return null;
}

export function safeAuthReturnTo(candidate: string | null | undefined): string {
  const value = candidate?.trim();
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return "/";
  }
  try {
    const base = "https://hanip.invalid";
    const target = new URL(value, base);
    // URL normalization can produce a protocol-relative pathname from
    // `/..//host/path` without changing the parsed origin.
    if (target.origin !== base || target.pathname.startsWith("//")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

export function buildAuthConfirmationRedirectUrl(returnTo: string, requestOrigin?: string | null): string | null {
  const origin = resolveAuthSiteOrigin({ requestOrigin });
  if (!origin) return null;
  const callback = new URL("/auth/callback", origin);
  const safeTarget = safeAuthReturnTo(returnTo);
  if (safeTarget !== "/") callback.searchParams.set("next", safeTarget);
  return callback.toString();
}
