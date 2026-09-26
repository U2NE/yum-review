"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type RefreshableImageProps = {
  src: string;
  alt: string;
  loading?: "eager" | "lazy";
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
  fallbackLabel?: string;
  onRefresh?: () => void | Promise<void>;
};

/** Refreshes the current server/client supplied signed URL once when the image request fails. */
export function RefreshableImage({
  src,
  alt,
  loading,
  className,
  style,
  fallback,
  fallbackLabel = "사진을 불러오지 못했어요",
  onRefresh,
}: RefreshableImageProps) {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);
  const currentSource = useRef(src);
  const refreshRequestedFrom = useRef<string | null>(null);
  const retrySource = useRef<string | null>(null);
  const refreshedSources = useRef(new Set<string>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (currentSource.current === src) return;

    if (refreshRequestedFrom.current && src !== refreshRequestedFrom.current) {
      retrySource.current = src;
      refreshRequestedFrom.current = null;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }

    currentSource.current = src;
    setUnavailable(false);
  }, [src]);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const handleLoad = useCallback(() => {
    if (retrySource.current === src) retrySource.current = null;
  }, [src]);

  const handleError = useCallback(() => {
    if (src !== currentSource.current) return;
    setUnavailable(true);

    // The refreshed URL is the single retry. If that request also fails, stop here.
    if (retrySource.current === src || refreshedSources.current.has(src)) return;

    refreshedSources.current.add(src);
    refreshRequestedFrom.current = src;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      if (currentSource.current === src) setUnavailable(true);
      refreshTimer.current = null;
    }, 10_000);

    try {
      const refresh = onRefresh ? onRefresh() : router.refresh();
      if (refresh && typeof refresh.then === "function") {
        void refresh.catch(() => setUnavailable(true));
      }
    } catch {
      setUnavailable(true);
    }
  }, [onRefresh, router, src]);

  if (unavailable) {
    return fallback ?? (
      <div className={className} style={{ ...style, display: "grid", placeItems: "center" }} role="img" aria-label={fallbackLabel}>
        사진을 불러올 수 없어요
      </div>
    );
  }

  return <img src={src} alt={alt} loading={loading} className={className} style={style} onError={handleError} onLoad={handleLoad} />;
}
