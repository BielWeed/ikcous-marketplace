import type { HttpRequest, Upload } from "tus-js-client";
import {
  IdentityUploadHttpError,
  createIdentityUploadHttpStack,
} from "./identityUploadHttp";
import type {
  IdentityUploadAuthorization,
  IdentityUploadHttpStack,
} from "./identityUploadHttp";
import { createIdentityUploadResume } from "./identityUploadResume";
import type { IdentityUploadResume } from "./identityUploadResume";
import type { PreparedIdentityImage } from "./prepareIdentityImage";
import { verifyPublicIdentityAsset } from "./publicStoreIdentity";
import type { VerifiedPublicIdentityAsset } from "./publicStoreIdentity";
import { normalizeSupabaseOrigin, parseIdentityAsset } from "./storeIdentity";

export type IdentityImageUploadCode =
  | "IDENTITY_UPLOAD_INVALID"
  | "IDENTITY_UPLOAD_ORIGIN"
  | "IDENTITY_UPLOAD_SESSION"
  | "IDENTITY_UPLOAD_CANCELED"
  | "IDENTITY_UPLOAD_TIMEOUT"
  | "IDENTITY_UPLOAD_NETWORK"
  | "IDENTITY_UPLOAD_PROTOCOL"
  | "IDENTITY_UPLOAD_UNCONFIRMED";
export class IdentityImageUploadError extends Error {
  readonly code: IdentityImageUploadCode;
  constructor(code: IdentityImageUploadCode) {
    super(code);
    this.name = "IdentityImageUploadError";
    this.code = code;
  }
}
export interface IdentityImageUploadProgress {
  readonly stage: "uploading" | "verifying";
  readonly uploadedBytes: number;
  readonly totalBytes: number;
}
export interface UploadIdentityImageOptions {
  readonly supabaseUrl: string;
  readonly userId: string;
  readonly authorize: () => Promise<IdentityUploadAuthorization>;
  readonly isCurrent: () => boolean;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly storage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem" | "key" | "length"
  > | null;
  readonly onProgress?: (value: IdentityImageUploadProgress) => void;
  readonly timeoutMs?: number;
  readonly requestTimeoutMs?: number;
}
class StatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("IDENTITY_UPLOAD_STATUS");
    this.status = status;
  }
}
// Public construction is not provenance: only this private factory registers codes.
const internalErrors = new WeakMap<object, IdentityImageUploadCode>();
function uploadError(code: IdentityImageUploadCode): IdentityImageUploadError {
  const error = new IdentityImageUploadError(code);
  internalErrors.set(error, code);
  return error;
}
function internalCode(error: unknown): IdentityImageUploadCode | undefined {
  return typeof error === "object" && error !== null
    ? internalErrors.get(error)
    : undefined;
}
function protocol(): never {
  throw uploadError("IDENTITY_UPLOAD_PROTOCOL");
}
function integer(value: string | undefined): number {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value))
    return protocol();
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return protocol();
  return number;
}
function metadata(value: string | undefined): Map<string, string> {
  if (!value || value.length > 8192) return protocol();
  const result = new Map<string, string>();
  for (const pair of value.split(",")) {
    const parts = pair.split(" ");
    const key = parts[0];
    const encoded = parts[1] ?? "";
    if (
      parts.length > 2 ||
      !/^[A-Za-z0-9_-]+$/.test(key) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      result.has(key)
    )
      return protocol();
    try {
      const raw = atob(encoded);
      if (btoa(raw) !== encoded) return protocol();
      result.set(
        key,
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(raw, (char) => char.charCodeAt(0)),
        ),
      );
    } catch {
      return protocol();
    }
  }
  return result;
}

export function uploadIdentityImage(
  image: PreparedIdentityImage,
  options: UploadIdentityImageOptions,
): Promise<VerifiedPublicIdentityAsset> {
  let operation: ReturnType<typeof runUpload> | undefined;
  const pending = (async () => {
    try {
      operation = runUpload(image, options);
      const result = await operation.completed;
      // This continuation settles the exact promise returned below: no adoption
      // or caller/Storage callback can follow the last guard while still pending.
      return operation.finish(result);
    } catch (error) {
      throw new IdentityImageUploadError(
        internalCode(error) ?? "IDENTITY_UPLOAD_INVALID",
      );
    } finally {
      operation?.dispose();
    }
  })();
  // Register before returning so cleanup precedes caller observers, but only
  // after fulfillment. Optional persistence cannot change the settled result.
  void pending
    .then(
      () => operation?.clearConfirmed(),
      () => {},
    )
    .catch(() => {});
  return pending;
}

function runUpload(
  image: PreparedIdentityImage,
  options: UploadIdentityImageOptions,
) {
  // Snapshot before the first await; Blob's native slice captures immutable bytes,
  // including when the caller overrides an instance's arrayBuffer/slice methods.
  const {
    supabaseUrl,
    userId,
    authorize,
    isCurrent,
    signal,
    storage,
    onProgress,
    fetchImpl = globalThis.fetch,
    timeoutMs = 600000,
    requestTimeoutMs = 30000,
  } = options;
  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(supabaseUrl);
  } catch {
    throw uploadError("IDENTITY_UPLOAD_ORIGIN");
  }
  const asset = parseIdentityAsset(image.asset);
  const suppliedBlob = image.blob;
  if (
    !(suppliedBlob instanceof Blob) ||
    !(signal instanceof AbortSignal) ||
    typeof authorize !== "function" ||
    typeof isCurrent !== "function" ||
    typeof fetchImpl !== "function" ||
    (onProgress !== undefined && typeof onProgress !== "function") ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 1800000
  )
    throw uploadError("IDENTITY_UPLOAD_INVALID");
  const blob = Blob.prototype.slice.call(
    suppliedBlob,
    0,
    suppliedBlob.size,
    suppliedBlob.type,
  ) as Blob;
  if (blob.size !== asset.bytes || blob.type !== asset.media_type)
    throw uploadError("IDENTITY_UPLOAD_INVALID");
  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  let phase: "preparing" | "uploading" | "verifying" | "terminal" = "preparing";
  let terminalError: IdentityImageUploadError | undefined;
  let upload: Upload | undefined;
  let resume: IdentityUploadResume | undefined;
  let clearingConfirmed = false;
  let uploadedBytes = 0;
  let resolve!: (value: VerifiedPublicIdentityAsset) => void;
  let reject!: (error: IdentityImageUploadError) => void;
  const completed = new Promise<VerifiedPublicIdentityAsset>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Observe immediately, including cancellation during synchronous setup callbacks.
  void completed.catch(() => {});
  const abortUpload = () => {
    try {
      void upload?.abort(false).catch(() => {});
    } catch {
      /* Never leak SDK diagnostics. */
    }
  };
  const stop = (code: IdentityImageUploadCode) => {
    if (phase === "terminal") return;
    terminalError = uploadError(code);
    phase = "terminal";
    reject(terminalError);
    controller.abort();
    abortUpload();
  };
  const checkTime = () => {
    if (signal.aborted) stop("IDENTITY_UPLOAD_CANCELED");
    if (performance.now() >= deadline) stop("IDENTITY_UPLOAD_TIMEOUT");
    if (terminalError) throw terminalError;
    if (phase === "terminal") throw uploadError("IDENTITY_UPLOAD_CANCELED");
  };
  const check = () => {
    checkTime();
    let current = false;
    try {
      current = isCurrent() === true;
    } catch {
      /* Fixed SESSION error below. */
    }
    checkTime();
    if (!current) {
      stop("IDENTITY_UPLOAD_SESSION");
      throw terminalError;
    }
  };
  const active = () => {
    try {
      check();
      return true;
    } catch {
      return false;
    }
  };
  const emit = (stage: "uploading" | "verifying") => {
    if (!active()) return;
    try {
      onProgress?.(
        Object.freeze({ stage, uploadedBytes, totalBytes: asset.bytes }),
      );
    } catch {
      stop("IDENTITY_UPLOAD_INVALID");
    }
    active(); // The caller may cancel in the progress callback.
  };
  const aborted = () => stop("IDENTITY_UPLOAD_CANCELED");
  EventTarget.prototype.addEventListener.call(signal, "abort", aborted, {
    once: true,
  });
  const timer = setTimeout(() => stop("IDENTITY_UPLOAD_TIMEOUT"), timeoutMs);
  const httpFailures = new WeakSet<IdentityImageUploadError>();
  // Only errors caught immediately at our HTTP adapter enter this registry.
  // The SDK and public constructors cannot confer this provenance.
  const fromHttp = (error: unknown): IdentityImageUploadError => {
    let code: IdentityImageUploadCode = "IDENTITY_UPLOAD_INVALID";
    if (error instanceof IdentityUploadHttpError) {
      switch (error.code) {
        case "IDENTITY_UPLOAD_INVALID":
        case "IDENTITY_UPLOAD_ORIGIN":
        case "IDENTITY_UPLOAD_SESSION":
        case "IDENTITY_UPLOAD_CANCELED":
        case "IDENTITY_UPLOAD_TIMEOUT":
        case "IDENTITY_UPLOAD_NETWORK":
          code = error.code;
      }
    }
    const normalized = uploadError(code);
    httpFailures.add(normalized);
    return normalized;
  };
  const httpCall = <T>(call: () => T): T => {
    try {
      return call();
    } catch (error) {
      throw fromHttp(error);
    }
  };
  let DetailedErrorClass:
    | typeof import("tus-js-client").DetailedError
    | undefined;
  function classify(
    input: unknown,
  ): IdentityImageUploadError | StatusError | undefined {
    let error = input;
    for (let i = 0; i < 5; i++) {
      if (
        (error instanceof IdentityImageUploadError && internalCode(error)) ||
        error instanceof StatusError
      )
        return error;
      if (DetailedErrorClass && error instanceof DetailedErrorClass) {
        error = error.causingError;
        continue;
      }
      return undefined;
    }
    return undefined;
  }
  const verify = () => {
    if (phase !== "uploading" || !active()) return;
    phase = "verifying";
    abortUpload();
    emit("verifying");
    if (!active()) return;
    const confirm = async () => {
      try {
        check();
        const result = await verifyPublicIdentityAsset(asset, {
          supabaseUrl: origin,
          signal: controller.signal,
          isCurrent: active,
          fetchImpl,
          timeoutMs: Math.max(
            1,
            Math.min(120000, Math.floor(deadline - performance.now())),
          ),
        });
        check();
        resolve(result);
      } catch {
        if (active()) stop("IDENTITY_UPLOAD_UNCONFIRMED");
      }
    };
    void confirm().catch(() => stop("IDENTITY_UPLOAD_UNCONFIRMED"));
  };
  const failed = (error: unknown) => {
    if (phase === "terminal" || phase === "verifying" || !active()) return;
    const known = classify(error);
    if (
      phase === "uploading" &&
      ((known instanceof StatusError &&
        (known.status === 400 ||
          known.status === 409 ||
          known.status >= 500)) ||
        (known instanceof IdentityImageUploadError &&
          httpFailures.has(known) &&
          (known.code === "IDENTITY_UPLOAD_NETWORK" ||
            known.code === "IDENTITY_UPLOAD_TIMEOUT")))
    ) {
      verify();
      return;
    }
    stop(internalCode(known) ?? "IDENTITY_UPLOAD_PROTOCOL");
  };
  const start = async () => {
    check();
    // Constructor validates user and request timeout before any import/network.
    const rawStack = httpCall(() =>
      createIdentityUploadHttpStack({
        supabaseUrl: origin,
        userId,
        authorize,
        signal: controller.signal,
        isCurrent: () => phase === "uploading" && active(),
        // Capture caller-controlled response getters inside the fetch boundary.
        // A fresh Response retains the same stream (no read/buffering) and native
        // Headers, so later adapter reads cannot throw a forged public error.
        fetchImpl: async (input, init) => {
          const response = await fetchImpl(input, init);
          const captured = new Response(response.body, {
            headers: response.headers,
          });
          Object.defineProperties(captured, {
            status: { value: response.status },
            redirected: { value: response.redirected },
            url: { value: response.url },
          });
          return captured;
        },
        timeoutMs: requestTimeoutMs,
      }),
    );
    const stack: IdentityUploadHttpStack = {
      getName: () => rawStack.getName(),
      createRequest(method, url) {
        const request = httpCall(() => rawStack.createRequest(method, url));
        return {
          ...request,
          setHeader: (name, value) =>
            httpCall(() => request.setHeader(name, value)),
          async send(body) {
            try {
              return await request.send(body);
            } catch (error) {
              throw fromHttp(error);
            }
          },
        };
      },
    };
    let buffer: ArrayBuffer;
    try {
      buffer = await blob.arrayBuffer();
    } catch {
      throw uploadError("IDENTITY_UPLOAD_INVALID");
    }
    check();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    check();
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (sha256 !== asset.sha256) throw uploadError("IDENTITY_UPLOAD_INVALID");
    const tus = await import("tus-js-client");
    check();
    DetailedErrorClass = tus.DetailedError;
    resume = await createIdentityUploadResume({
      origin,
      userId,
      asset,
      storage,
      isActive: () => clearingConfirmed || active(),
      validateUploadUrl: (url) => {
        stack.createRequest("HEAD", url);
      },
      nowMs: Date.now,
    });
    check();
    const chunkEnds = new WeakMap<HttpRequest, number>();
    const guardedStack: IdentityUploadHttpStack = {
      getName: () => stack.getName(),
      createRequest(method, url) {
        const request = stack.createRequest(method, url);
        const wrapped = {
          ...request,
          async send(body?: Blob | null) {
            check();
            if (phase !== "uploading")
              throw uploadError("IDENTITY_UPLOAD_CANCELED");
            if (method === "PATCH") {
              const offset = integer(request.getHeader("Upload-Offset"));
              if (
                !(body instanceof Blob) ||
                body.size < 1 ||
                offset + body.size > asset.bytes
              )
                return protocol();
              chunkEnds.set(wrapped, offset + body.size);
            }
            return request.send(body);
          },
        };
        return wrapped;
      },
    };
    const projectRef = new URL(origin).hostname.split(".")[0];
    upload = new tus.Upload(blob, {
      endpoint: `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
      httpStack: guardedStack,
      urlStorage: resume.urlStorage,
      fingerprint: async () => resume!.fingerprint,
      uploadSize: asset.bytes,
      chunkSize: 6 * 1024 * 1024,
      parallelUploads: 1,
      uploadDataDuringCreation: false,
      uploadLengthDeferred: false,
      overridePatchMethod: false,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: false,
      retryDelays: [0, 1000, 3000],
      metadata: {
        bucketName: "branding",
        objectName: asset.path,
        contentType: asset.media_type,
        cacheControl: "31536000",
      },
      onAfterResponse(request, response) {
        check();
        if (phase !== "uploading")
          throw uploadError("IDENTITY_UPLOAD_CANCELED");
        const method = request.getMethod();
        const status = response.getStatus();
        if (method === "HEAD" && (status === 404 || status === 410)) return;
        const success =
          method === "POST"
            ? status === 201
            : method === "HEAD"
              ? status === 200 || status === 204
              : status === 204;
        if (!success) {
          if (
            method === "HEAD" &&
            !(status === 423 || status === 429 || status >= 500)
          )
            return protocol();
          if (status >= 400 && status <= 599) throw new StatusError(status);
          return protocol();
        }
        if (response.getHeader("Tus-Resumable") !== "1.0.0") return protocol();
        if (method === "POST") {
          const location = response.getHeader("Location");
          if (!location) return protocol();
          stack.createRequest("HEAD", location);
        } else if (method === "HEAD") {
          const offset = integer(response.getHeader("Upload-Offset"));
          if (
            integer(response.getHeader("Upload-Length")) !== asset.bytes ||
            offset > asset.bytes
          )
            return protocol();
          const tags = metadata(response.getHeader("Upload-Metadata"));
          if (
            tags.get("bucketName") !== "branding" ||
            tags.get("objectName") !== asset.path ||
            tags.get("contentType") !== asset.media_type ||
            !["31536000", "max-age=31536000"].includes(
              tags.get("cacheControl") ?? "",
            )
          )
            return protocol();
        } else if (
          integer(response.getHeader("Upload-Offset")) !==
          chunkEnds.get(request)
        )
          return protocol();
      },
      onShouldRetry(error) {
        if (phase !== "uploading" || !active()) return false;
        const known = classify(error);
        return known instanceof StatusError
          ? known.status === 423 || known.status === 429 || known.status >= 500
          : known instanceof IdentityImageUploadError &&
              httpFailures.has(known) &&
              (known.code === "IDENTITY_UPLOAD_NETWORK" ||
                known.code === "IDENTITY_UPLOAD_TIMEOUT");
      },
      onChunkComplete(_chunk, accepted, total) {
        if (phase !== "uploading" || !active()) return;
        if (
          !Number.isInteger(accepted) ||
          accepted < uploadedBytes ||
          accepted > asset.bytes ||
          total !== asset.bytes
        ) {
          stop("IDENTITY_UPLOAD_PROTOCOL");
          return;
        }
        uploadedBytes = accepted;
        emit("uploading");
      },
      onSuccess: verify,
      onError: failed,
    });
    const previous = await upload.findPreviousUploads();
    check();
    if (previous.length === 1) upload.resumeFromPreviousUpload(previous[0]);
    phase = "uploading";
    emit("uploading");
    check();
    upload.start();
  };
  void start().catch(failed);
  return {
    completed,
    finish(result: VerifiedPublicIdentityAsset): VerifiedPublicIdentityAsset {
      check();
      phase = "terminal";
      return Object.freeze(result);
    },
    clearConfirmed() {
      if (phase !== "terminal" || terminalError || !upload?.url) return;
      // This synchronous window exists only in the fulfilled-promise observer.
      // Ordinary late SDK callbacks still see terminal and cannot persist/progress.
      clearingConfirmed = true;
      try {
        resume?.clearConfirmed(upload.url);
      } finally {
        clearingConfirmed = false;
      }
    },
    dispose() {
      clearTimeout(timer);
      // Cleanup must neither await external work nor replace the fixed result.
      try {
        EventTarget.prototype.removeEventListener.call(
          signal,
          "abort",
          aborted,
        );
      } catch {
        /* A caller override is not an upload diagnostic. */
      }
    },
  };
}
