export const MAX_IMAGE_BYTES = 100_000_000;
export const OPTIMIZE_IMAGE_BYTES = 10_000_000;
export const TUS_UPLOAD_THRESHOLD = 6 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_SIDE = 30_000;

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

export type ImageHeader = {
  contentType: SupportedImageType;
  width: number;
  height: number;
};

export type PreparedImage = {
  file: File;
  contentType: SupportedImageType;
  originalBytes: number;
  storedBytes: number;
  width: number;
  height: number;
  optimized: boolean;
};

const signatures: Array<{ contentType: SupportedImageType; bytes: number[] }> = [
  { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !startsWith(bytes, signatures[1].bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || !startsWith(bytes, signatures[0].bytes)) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null;
  }

  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return { width: readUint24Le(bytes, 24) + 1, height: readUint24Le(bytes, 27) + 1 };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    return { width, height };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: ((bytes[27] & 0x3f) << 8) | bytes[26],
      height: ((bytes[29] & 0x3f) << 8) | bytes[28],
    };
  }
  return null;
}

export function inspectImageHeader(bytes: Uint8Array): ImageHeader | null {
  const png = readPngDimensions(bytes);
  if (png) return { contentType: "image/png", ...png };
  const jpeg = readJpegDimensions(bytes);
  if (jpeg) return { contentType: "image/jpeg", ...jpeg };
  const webp = readWebpDimensions(bytes);
  if (webp) return { contentType: "image/webp", ...webp };
  return null;
}

function assertImageDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error("사진 해상도가 너무 커요. 크기를 줄인 뒤 다시 선택해 주세요.");
  }
}

async function encodeCanvas(
  bitmap: ImageBitmap,
  contentType: SupportedImageType,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: contentType !== "image/jpeg" });
  if (!context) throw new Error("사진을 변환하지 못했어요. 다른 브라우저에서 다시 시도해 주세요.");
  context.drawImage(bitmap, 0, 0, width, height);

  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, contentType, quality);
  });
  if (!encoded || !["image/jpeg", "image/png", "image/webp"].includes(encoded.type)) {
    throw new Error("사진 압축을 지원하지 않는 브라우저예요.");
  }
  return encoded;
}

function fileWithBlob(original: File, blob: Blob, contentType: SupportedImageType): File {
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  const stem = original.name.replace(/\.[^.]*$/, "") || "menu-photo";
  return new File([blob], `${stem}.${extension}`, { type: contentType, lastModified: original.lastModified });
}

/** Validates the file header and browser decoder before any upload starts. */
export async function validateAndOptimizeImage(file: File): Promise<PreparedImage> {
  if (!file || file.size < 1) throw new Error("비어 있는 사진 파일이에요.");
  if (file.size >= MAX_IMAGE_BYTES) throw new Error("사진은 100MB 미만만 올릴 수 있어요.");

  const headerBytes = new Uint8Array(await file.slice(0, Math.min(file.size, 4_000_000)).arrayBuffer());
  const header = inspectImageHeader(headerBytes);
  if (!header) throw new Error("JPEG, PNG, WebP 사진만 올릴 수 있어요.");
  if (file.type && file.type !== header.contentType) {
    throw new Error("파일 형식과 실제 사진 형식이 달라요. 원본 사진을 다시 선택해 주세요.");
  }
  assertImageDimensions(header.width, header.height);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("사진이 손상되어 열 수 없어요. 다른 파일을 선택해 주세요.");
  }

  try {
    assertImageDimensions(bitmap.width, bitmap.height);
    if (file.size <= OPTIMIZE_IMAGE_BYTES) {
      return {
        file,
        contentType: header.contentType,
        originalBytes: file.size,
        storedBytes: file.size,
        width: bitmap.width,
        height: bitmap.height,
        optimized: false,
      };
    }

    let bestBlob: Blob | null = null;
    let bestContentType: SupportedImageType = "image/webp";
    let width = bitmap.width;
    let height = bitmap.height;
    const initialScale = Math.min(1, 2560 / Math.max(width, height));
    width = Math.max(1, Math.round(width * initialScale));
    height = Math.max(1, Math.round(height * initialScale));

    // Try quality reduction first, then smaller dimensions. Keep the smallest
    // viable result if browser encoders cannot reach the preferred 10 MB target.
    for (let pass = 0; pass < 7; pass += 1) {
      for (const quality of [0.88, 0.78, 0.68, 0.58]) {
        const encoded = await encodeCanvas(bitmap, "image/webp", width, height, quality);
        const encodedType = encoded.type as SupportedImageType;
        if (!bestBlob || encoded.size < bestBlob.size) {
          bestBlob = encoded;
          bestContentType = encodedType;
        }
        if (encoded.size <= OPTIMIZE_IMAGE_BYTES) {
          return {
            file: fileWithBlob(file, encoded, encodedType),
            contentType: encodedType,
            originalBytes: file.size,
            storedBytes: encoded.size,
            width,
            height,
            optimized: true,
          };
        }
      }
      width = Math.max(1, Math.floor(width * 0.82));
      height = Math.max(1, Math.floor(height * 0.82));
    }

    if (bestBlob && bestBlob.size < file.size) {
      return {
        file: fileWithBlob(file, bestBlob, bestContentType),
        contentType: bestContentType,
        originalBytes: file.size,
        storedBytes: bestBlob.size,
        width,
        height,
        optimized: true,
      };
    }

    // The original is still accepted when optimization cannot reduce it; the
    // hard limit is 100 MB, while 10 MB is the optimization target.
    return {
      file,
      contentType: header.contentType,
      originalBytes: file.size,
      storedBytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
      optimized: false,
    };
  } finally {
    bitmap.close();
  }
}
