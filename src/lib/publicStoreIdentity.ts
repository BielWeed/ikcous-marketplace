import { createClient } from "@supabase/supabase-js";
import { assertPublicSupabaseKey } from "./publicSupabaseKey";
import {
  IdentityError,
  MAX_IDENTITY_ASSET_BYTES,
  cloneStoreIdentity,
  identityAssetDescriptors,
  identityRevision,
  normalizeSupabaseOrigin,
  parseIdentityAsset,
  parseStoreIdentity,
} from "./storeIdentity";
import type { IdentityAsset, PublicStoreIdentity } from "./storeIdentity";

interface TransportOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
interface ReadIdentityOptions extends TransportOptions {
  supabaseUrl: string;
  publicKey: string;
}
export interface DownloadedIdentityAsset {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly sha256: string;
}
export interface DownloadedStoreIdentity {
  readonly identity: PublicStoreIdentity;
  readonly revision: string;
  readonly files: readonly DownloadedIdentityAsset[];
}

const selection =
  "store_name,store_city,store_state,logo_url,primary_color,secondary_color,accent_color,branding_assets";

async function withDeadline<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new IdentityError("IDENTITY_INVALID");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new IdentityError("IDENTITY_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task(controller.signal), expired]);
  } catch (error) {
    if (controller.signal.aborted) throw new IdentityError("IDENTITY_TIMEOUT");
    if (error instanceof IdentityError) throw error;
    throw new IdentityError("IDENTITY_FETCH");
  } finally {
    clearTimeout(timer);
  }
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}
function assertResponseOrigin(response: Response, expectedUrl: string): void {
  if (response.redirected || (response.url && response.url !== expectedUrl))
    throw new IdentityError("IDENTITY_ORIGIN");
}

// Bounded streaming, including transports that ignore AbortSignal after headers.
async function readBytes(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  exactBytes?: number,
  normalizeReadErrors = false,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new IdentityError("IDENTITY_ASSET_SIZE");
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    if (normalizeReadErrors) throw new IdentityError("IDENTITY_FETCH");
    throw error;
  }
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch (error) {
        if (normalizeReadErrors) throw new IdentityError("IDENTITY_FETCH");
        throw error;
      }
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      if (
        length > maxBytes ||
        (exactBytes !== undefined && length > exactBytes)
      ) {
        cancel();
        throw new IdentityError("IDENTITY_ASSET_SIZE");
      }
      chunks.push(part.value.slice());
    }
    if (exactBytes !== undefined && length !== exactBytes)
      throw new IdentityError("IDENTITY_ASSET_SIZE");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function readPublicStoreIdentity(
  options: ReadIdentityOptions,
): Promise<PublicStoreIdentity> {
  const origin = normalizeSupabaseOrigin(options.supabaseUrl);
  assertPublicSupabaseKey(options.publicKey);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return withDeadline(options.timeoutMs ?? 10000, async (signal) => {
    let transportError: IdentityError | undefined;
    const controlledFetch: typeof fetch = async (input, init) => {
      try {
        signal.throwIfAborted();
        const url = requestUrl(input);
        if (
          url.origin !== origin ||
          url.pathname !== "/rest/v1/v_store_config" ||
          url.username ||
          url.password ||
          url.hash ||
          (init?.method ?? "GET") !== "GET" ||
          url.searchParams.get("select") !== selection ||
          url.searchParams.get("id") !== "eq.1" ||
          url.searchParams.get("limit") !== "2" ||
          [...url.searchParams.keys()].length !== 3
        )
          throw new IdentityError("IDENTITY_ORIGIN");
        const response = await fetchImpl(input, {
          ...init,
          signal,
          redirect: "error",
          credentials: "omit",
        });
        assertResponseOrigin(response, url.href);
        if (response.status === 401 || response.status === 403) {
          void response.body?.cancel().catch(() => undefined);
          throw new IdentityError("IDENTITY_PERMISSION");
        }
        const bytes = await readBytes(response, signal, 256 * 1024);
        return new Response(bytes, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        transportError =
          error instanceof IdentityError
            ? error
            : new IdentityError(
                signal.aborted ? "IDENTITY_TIMEOUT" : "IDENTITY_FETCH",
              );
        throw transportError;
      }
    };
    // Let the installed SDK manage apikey/Authorization, including publishable keys.
    const client = createClient(origin, options.publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: controlledFetch },
    });
    const { data, error, status } = await client
      .from("v_store_config")
      .select(selection)
      .eq("id", 1)
      .limit(2)
      .abortSignal(signal)
      .retry(false);
    if (transportError) throw transportError;
    if (status === 401 || status === 403)
      throw new IdentityError("IDENTITY_PERMISSION");
    if (error?.code === "42703" || error?.code === "PGRST204")
      throw new IdentityError("IDENTITY_SCHEMA");
    if (error) throw new IdentityError("IDENTITY_FETCH");
    if (!Array.isArray(data) || data.length !== 1)
      throw new IdentityError("IDENTITY_ROWS");
    return parseStoreIdentity(data[0], origin);
  });
}

function matchesSignature(bytes: Uint8Array, mime: string): boolean {
  const prefix = (length: number) =>
    Array.from(bytes.subarray(0, length)).join(",");
  switch (mime) {
    case "image/png":
      return prefix(8) === "137,80,78,71,13,10,26,10";
    case "image/jpeg":
      return prefix(3) === "255,216,255";
    case "image/webp":
      return (
        bytes.length >= 12 &&
        prefix(4) === "82,73,70,70" &&
        new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
      );
    case "image/vnd.microsoft.icon":
      return (
        bytes.length >= 6 &&
        prefix(4) === "0,0,1,0" &&
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).getUint16(4, true) > 0
      );
    // SVG has no fixed magic bytes. MIME + approved SHA are checked; no custom XML parser.
    case "image/svg+xml":
      return true;
    default:
      return false;
  }
}

export async function downloadIdentityAssets(
  value: PublicStoreIdentity,
  options: TransportOptions = {},
): Promise<DownloadedStoreIdentity> {
  // Clone and validate synchronously before the first await, including every derived URL.
  const identity = cloneStoreIdentity(value);
  const unique = new Map<string, IdentityAsset>();
  for (const asset of identityAssetDescriptors(identity.assets))
    unique.set(asset.path, asset);
  if (
    unique.size > 16 ||
    [...unique.values()].reduce((sum, asset) => sum + asset.bytes, 0) >
      320 * 1024 * 1024
  )
    throw new IdentityError("IDENTITY_INVALID");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return withDeadline(options.timeoutMs ?? 30000, async (signal) => {
    const files: DownloadedIdentityAsset[] = [];
    for (const asset of unique.values()) {
      signal.throwIfAborted();
      const url = `https://${identity.projectRef}.supabase.co/storage/v1/object/public/branding/${asset.path}`;
      const response = await fetchImpl(url, {
        signal,
        redirect: "error",
        credentials: "omit",
      });
      assertResponseOrigin(response, url);
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        throw new IdentityError("IDENTITY_ASSET_STATUS");
      }
      const mime = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (mime !== asset.media_type) {
        void response.body?.cancel().catch(() => undefined);
        throw new IdentityError("IDENTITY_ASSET_MIME");
      }
      const bytes = await readBytes(
        response,
        signal,
        MAX_IDENTITY_ASSET_BYTES,
        asset.bytes,
      );
      if (!matchesSignature(bytes, mime))
        throw new IdentityError("IDENTITY_ASSET_MIME");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (sha256 !== asset.sha256)
        throw new IdentityError("IDENTITY_ASSET_HASH");
      files.push(
        Object.freeze({ path: asset.path, bytes, mediaType: mime, sha256 }),
      );
    }
    return Object.freeze({
      identity,
      revision: await identityRevision(identity),
      files: Object.freeze(files),
    });
  });
}

export interface VerifyPublicIdentityAssetOptions {
  readonly supabaseUrl: string;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}
export interface VerifiedPublicIdentityAsset {
  readonly asset: IdentityAsset;
  readonly url: string;
}
export async function verifyPublicIdentityAsset(
  value: IdentityAsset,
  options: VerifyPublicIdentityAssetOptions,
): Promise<VerifiedPublicIdentityAsset> {
  // Capture the request before yielding; callers retain ownership of their objects.
  const asset = parseIdentityAsset(value);
  if (options === null || typeof options !== "object")
    throw new IdentityError("IDENTITY_INVALID");
  const {
    supabaseUrl,
    signal,
    isCurrent,
    fetchImpl: suppliedFetch,
    timeoutMs: suppliedTimeout,
  } = options;
  const fetchImpl =
    suppliedFetch === undefined ? globalThis.fetch : suppliedFetch;
  const timeoutMs = suppliedTimeout === undefined ? 30000 : suppliedTimeout;
  if (
    !(signal instanceof AbortSignal) ||
    typeof isCurrent !== "function" ||
    typeof fetchImpl !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000
  )
    throw new IdentityError("IDENTITY_INVALID");
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  const url = `${origin}/storage/v1/object/public/branding/${asset.path}`;
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  let terminalError: IdentityError | undefined;
  let rejectTerminal!: (error: IdentityError) => void;
  const terminal = new Promise<never>((_resolve, reject) => {
    rejectTerminal = reject;
  });
  const stop = (
    code: "IDENTITY_CANCELED" | "IDENTITY_TIMEOUT" | "IDENTITY_CONTEXT",
  ) => {
    if (!terminalError) {
      terminalError = new IdentityError(code);
      rejectTerminal(terminalError);
      controller.abort();
    }
    return terminalError;
  };
  const checkSignalAndTime = () => {
    if (terminalError) throw terminalError;
    if (signal.aborted) throw stop("IDENTITY_CANCELED");
    if (performance.now() >= deadline) throw stop("IDENTITY_TIMEOUT");
  };
  const checkActive = () => {
    checkSignalAndTime();
    let current = false;
    try {
      current = isCurrent() === true;
    } catch {
      /* Context callbacks never expose diagnostics. */
    }
    // The callback may synchronously cancel, including on the last check.
    checkSignalAndTime();
    if (!current) throw stop("IDENTITY_CONTEXT");
  };
  const onAbort = () => {
    stop("IDENTITY_CANCELED");
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    stop("IDENTITY_TIMEOUT");
  }, timeoutMs);
  const discard = (response: Response) => {
    if (!response.body?.locked)
      void response.body?.cancel().catch(() => undefined);
  };
  const run = async (): Promise<VerifiedPublicIdentityAsset> => {
    let response: Response | undefined;
    try {
      checkActive();
      try {
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        checkActive();
        throw new IdentityError("IDENTITY_FETCH");
      }
      // This continuation also disposes of a late response when fetch ignores abort.
      checkActive();
      if (response.redirected || response.url !== url)
        throw new IdentityError("IDENTITY_ORIGIN");
      if (response.status !== 200)
        throw new IdentityError("IDENTITY_ASSET_STATUS");
      const mime = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (mime !== asset.media_type)
        throw new IdentityError("IDENTITY_ASSET_MIME");
      const bytes = await readBytes(
        response,
        controller.signal,
        MAX_IDENTITY_ASSET_BYTES,
        asset.bytes,
        true,
      );
      checkActive();
      if (!matchesSignature(bytes, mime))
        throw new IdentityError("IDENTITY_ASSET_MIME");
      let digest: ArrayBuffer;
      try {
        digest = await crypto.subtle.digest("SHA-256", bytes);
      } catch {
        checkActive();
        throw new IdentityError("IDENTITY_FETCH");
      }
      checkActive();
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (sha256 !== asset.sha256)
        throw new IdentityError("IDENTITY_ASSET_HASH");
      checkActive();
      return Object.freeze({ asset, url });
    } catch (error) {
      if (response) discard(response);
      checkActive();
      // External operations normalize at their boundary; only local codes survive.
      if (error instanceof IdentityError) {
        switch (error.code) {
          case "IDENTITY_ORIGIN":
          case "IDENTITY_ASSET_STATUS":
          case "IDENTITY_ASSET_SIZE":
          case "IDENTITY_ASSET_MIME":
          case "IDENTITY_ASSET_HASH":
            throw new IdentityError(error.code);
        }
      }
      throw new IdentityError("IDENTITY_FETCH");
    }
  };
  try {
    // Race observes late fulfillment/rejection without waiting on native cancellation.
    const result = await Promise.race([run(), terminal]);
    checkActive();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
