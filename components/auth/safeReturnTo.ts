const FALLBACK_PATH = "/";

export function safeReturnTo(candidate: string | null | undefined) {
  const value = candidate?.trim();
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return FALLBACK_PATH;
  }

  try {
    const origin = "https://hanip.invalid";
    const target = new URL(value, origin);
    if (target.origin !== origin) return FALLBACK_PATH;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return FALLBACK_PATH;
  }
}
