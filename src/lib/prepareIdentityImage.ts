import type { IdentityAsset } from "./storeIdentity";

export type IdentityImageErrorCode =
  | "IDENTITY_IMAGE_INVALID"
  | "IDENTITY_IMAGE_SIZE"
  | "IDENTITY_IMAGE_FORMAT"
  | "IDENTITY_IMAGE_DIMENSIONS"
  | "IDENTITY_IMAGE_DECODE"
  | "IDENTITY_IMAGE_CANCELED"
  | "IDENTITY_IMAGE_TIMEOUT";
export class IdentityImageError extends Error {
  readonly code: IdentityImageErrorCode;
  constructor(code: IdentityImageErrorCode) {
    super(code);
    this.name = "IdentityImageError";
    this.code = code;
  }
}
export interface PreparedIdentityImage {
  readonly blob: Blob;
  readonly asset: IdentityAsset;
}
export interface PrepareIdentityImageOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
}

type Format = "png" | "jpeg" | "webp" | "svg" | "ico";
const formats = new Map<Format, readonly [IdentityAsset["media_type"], string]>(
  [
    ["png", ["image/png", "png"]],
    ["jpeg", ["image/jpeg", "jpg"]],
    ["webp", ["image/webp", "webp"]],
    ["svg", ["image/svg+xml", "svg"]],
    ["ico", ["image/vnd.microsoft.icon", "ico"]],
  ],
);

function invalidFormat(): never {
  throw new IdentityImageError("IDENTITY_IMAGE_FORMAT");
}

function validateWebp(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end < 12 || end > bytes.length) invalidFormat();
  let offset = 12;
  let frames = 0;
  while (offset < end) {
    if (end - offset < 8) invalidFormat();
    const length = view.getUint32(offset + 4, true);
    const next = offset + 8 + length + (length % 2);
    if (next > end) invalidFormat();
    if (
      view.getUint8(offset) === 65 &&
      bytes[offset + 1] === 78 &&
      bytes[offset + 2] === 77 &&
      bytes[offset + 3] === 70
    )
      frames++;
    if (frames > 1) invalidFormat();
    offset = next;
  }
}

function validateIco(bytes: Uint8Array): void {
  if (bytes.length < 6) invalidFormat();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const end = 6 + count * 16;
  if (!count || end > bytes.length) invalidFormat();
  for (let offset = 6; offset < end; offset += 16) {
    const length = view.getUint32(offset + 8, true);
    const start = view.getUint32(offset + 12, true);
    if (!length || start < end || start + length > bytes.length)
      invalidFormat();
  }
  // Entry dimensions encode 0 as 256; none is the unique size of this container.
}

function identify(bytes: Uint8Array): Format {
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes.at(i) === byte)
  )
    return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (
    bytes[0] === 82 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 70 &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  ) {
    validateWebp(bytes);
    return "webp";
  }
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    validateIco(bytes);
    return "ico";
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (
      document.getElementsByTagNameNS("*", "parsererror").length ||
      document.documentElement.localName !== "svg" ||
      document.documentElement.namespaceURI !== "http://www.w3.org/2000/svg"
    )
      invalidFormat();
    return "svg";
  } catch {
    return invalidFormat();
  }
}

// One deadline covers every await. Promise.race also handles late rejections;
// checkpoints prevent a late resolution from starting the next operation.
function lifetime(signal: AbortSignal, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  let ended: IdentityImageError | undefined;
  let reject!: (error: IdentityImageError) => void;
  const stopped = new Promise<never>((_resolve, no) => {
    reject = no;
  });
  const stop = (code: IdentityImageErrorCode) => {
    if (!ended) {
      ended = new IdentityImageError(code);
      reject(ended);
    }
  };
  const abort = () => stop("IDENTITY_IMAGE_CANCELED");
  const timer = setTimeout(() => stop("IDENTITY_IMAGE_TIMEOUT"), timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  void stopped.catch(() => {});
  const check = () => {
    if (signal.aborted) abort();
    if (performance.now() >= deadline) stop("IDENTITY_IMAGE_TIMEOUT");
    if (ended) throw ended;
  };
  return {
    check,
    async wait<T>(
      operation: () => Promise<T>,
      code: IdentityImageErrorCode,
    ): Promise<T> {
      check();
      try {
        const result = await Promise.race([operation(), stopped]);
        check();
        return result;
      } catch (error) {
        check();
        throw error instanceof IdentityImageError
          ? error
          : new IdentityImageError(code);
      }
    },
    dispose() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    },
  };
}

// image-dimensions 2.5.1 misses marker fill bytes allowed by ITU T.81
// B.1.1.2/E.2.1. Adapt only its query copy; remove when upstream passes these
// regressions. Segment payloads and everything from the first SOF stay intact.
function jpegDimensionBytes(bytes: Uint8Array): Uint8Array {
  const query = new Uint8Array(bytes.length);
  query.set(bytes.subarray(0, 2));
  let offset = 2;
  let written = 2;
  while (offset < bytes.length) {
    if (bytes.at(offset) !== 255)
      throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
    while (bytes.at(offset) === 255) offset++;
    const marker = bytes.at(offset);
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 1 ||
      (marker >= 208 && marker <= 218) ||
      offset + 2 >= bytes.length
    )
      throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
    const length = bytes[offset + 1] * 256 + bytes[offset + 2];
    const end = offset + 1 + length;
    const sof = marker >= 192 && marker <= 195;
    if (length < (sof ? 8 : 2) || end > bytes.length)
      throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
    query[written++] = 255;
    if (sof) {
      query.set(bytes.subarray(offset), written);
      return query.slice(0, written + bytes.length - offset);
    }
    query.set(bytes.subarray(offset, end), written);
    written += end - offset;
    offset = end;
  }
  throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
}

export async function prepareIdentityImage(
  file: Blob,
  options: PrepareIdentityImageOptions,
): Promise<PreparedIdentityImage> {
  let scope: ReturnType<typeof lifetime> | undefined;
  let url: string | undefined;
  let image: HTMLImageElement | undefined;
  try {
    const signal = options?.signal;
    const suppliedTimeout = options?.timeoutMs;
    const timeoutMs = suppliedTimeout === undefined ? 30000 : suppliedTimeout;
    if (
      !(file instanceof Blob) ||
      !(signal instanceof AbortSignal) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 120000
    )
      throw new IdentityImageError("IDENTITY_IMAGE_INVALID");
    const size = file.size;
    if (!Number.isInteger(size) || size < 1 || size > 20 * 1024 * 1024)
      throw new IdentityImageError("IDENTITY_IMAGE_SIZE");
    scope = lifetime(signal, timeoutMs);
    const buffer = await scope.wait(
      () => file.arrayBuffer(),
      "IDENTITY_IMAGE_INVALID",
    );
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== size)
      throw new IdentityImageError("IDENTITY_IMAGE_SIZE");
    // Own the copy, including against a caller overriding Blob.arrayBuffer().
    const bytes = new Uint8Array(new Uint8Array(buffer));
    const format = identify(bytes);
    scope.check();
    let dimensions: { width: number; height: number } | undefined;
    if (format === "png" || format === "jpeg" || format === "webp") {
      const { imageDimensionsFromData } = await scope.wait(
        () => import("image-dimensions"),
        "IDENTITY_IMAGE_DIMENSIONS",
      );
      try {
        const result = imageDimensionsFromData(
          format === "jpeg" ? jpegDimensionBytes(bytes) : bytes,
        );
        if (
          !result ||
          result.type !== format ||
          !Number.isInteger(result.width) ||
          !Number.isInteger(result.height) ||
          result.width < 1 ||
          result.height < 1 ||
          result.width > 8192 ||
          result.height > 8192
        )
          throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
        dimensions = { width: result.width, height: result.height };
      } catch {
        throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
      }
    }
    scope.check();
    const [mediaType, extension] = formats.get(format)!;
    const blob = new Blob([bytes], { type: mediaType });
    await scope.wait(() => {
      url = URL.createObjectURL(blob);
      image = new Image();
      image.src = url;
      return image.decode();
    }, "IDENTITY_IMAGE_DECODE");
    if (
      format === "svg" &&
      image &&
      (image.naturalWidth > 8192 || image.naturalHeight > 8192)
    )
      throw new IdentityImageError("IDENTITY_IMAGE_DIMENSIONS");
    const digest = await scope.wait(
      () => crypto.subtle.digest("SHA-256", bytes),
      "IDENTITY_IMAGE_INVALID",
    );
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new IdentityImageError("IDENTITY_IMAGE_INVALID");
    scope.check();
    const asset: IdentityAsset = Object.freeze({
      path: `v1/${sha256}/image.${extension}`,
      sha256,
      media_type: mediaType,
      bytes: size,
      ...dimensions,
    });
    return Object.freeze({ blob, asset });
  } catch (error) {
    throw error instanceof IdentityImageError
      ? error
      : new IdentityImageError("IDENTITY_IMAGE_INVALID");
  } finally {
    scope?.dispose();
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
    }
    if (url !== undefined) URL.revokeObjectURL(url);
  }
}
