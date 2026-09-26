import "server-only";

import { createHmac, randomBytes, randomUUID } from "node:crypto";

export const MEDIA_PROOF_TTL_SECONDS = 60;

export type MediaVerificationPayload = {
  version: 1;
  keyId: string;
  mediaId: string;
  objectPath: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  originalBytes: number;
  storedBytes: number;
  sha256: string;
  verifiedAt: string;
  nonce: string;
};

export type MediaKeyPreflight = {
  keyId: string;
  challenge: string;
  signature: string;
};

function keyPreflightMessage(mediaId: string, keyId: string, challenge: string): string {
  return `yum-review-media-key-preflight-v1\n${mediaId}\n${keyId}\n${challenge}`;
}

function loadSigningKey(): { keyId: string; key: Buffer } {
  const keyId = process.env.MEDIA_VALIDATION_KEY_ID;
  const encoded = process.env.MEDIA_VALIDATION_HMAC_KEY;
  if (!keyId || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || !encoded) {
    throw new Error("Media verification is not configured.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length < 32 || key.toString("base64") !== encoded) {
    throw new Error("Media verification is not configured.");
  }
  return { keyId, key };
}

/** Fails closed without exposing key material or configuration details to callers. */
export function assertMediaVerificationConfigured(): void {
  loadSigningKey();
}

/** Creates a short-lived challenge proving this server key matches the Vault key. */
export function createMediaKeyPreflight(mediaId: string): MediaKeyPreflight {
  const { keyId, key } = loadSigningKey();
  const challenge = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", key)
    .update(keyPreflightMessage(mediaId, keyId, challenge), "utf8")
    .digest("hex");
  return { keyId, challenge, signature };
}

/** Signs one canonical, short-lived attestation. The key never leaves this server module. */
export function createMediaVerificationProof(
  input: Omit<MediaVerificationPayload, "version" | "keyId" | "verifiedAt" | "nonce">,
): { payload: string; signature: string } {
  const { keyId, key } = loadSigningKey();
  const value: MediaVerificationPayload = {
    version: 1,
    keyId,
    mediaId: input.mediaId,
    objectPath: input.objectPath,
    contentType: input.contentType,
    originalBytes: input.originalBytes,
    storedBytes: input.storedBytes,
    sha256: input.sha256,
    verifiedAt: new Date().toISOString(),
    nonce: randomUUID(),
  };
  const payload = JSON.stringify(value);
  const signature = createHmac("sha256", key).update(payload, "utf8").digest("hex");
  return { payload, signature };
}
