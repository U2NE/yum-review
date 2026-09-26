import "server-only";

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 };

/** Read and parse JSON without ever buffering more than maxBytes from the request. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const contentLength = request.headers.get("content-length");
  let declaredLength: number | undefined;
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, status: 400 };
    declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength)) return { ok: false, status: 400 };
    if (declaredLength > maxBytes) return { ok: false, status: 413 };
  }

  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return { ok: false, status: 400 };
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (value.byteLength > maxBytes - total) {
        try { await reader.cancel(); } catch { /* The size limit still fails closed. */ }
        return { ok: false, status: 413 };
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    try { reader.releaseLock(); } catch { /* A canceled stream may already be released. */ }
  }

  if (total === 0 || (declaredLength !== undefined && declaredLength !== total)) {
    return { ok: false, status: 400 };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
