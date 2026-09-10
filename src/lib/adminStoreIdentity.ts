import type { Database, Json } from "@/types/database.types";
import { createClient } from "@supabase/supabase-js";
import { assertPublicSupabaseKey } from "./publicSupabaseKey";
import { normalizeSupabaseOrigin } from "./storeIdentity";
import {
  parseRawStoreIdentity,
  parseStoreIdentitySnapshot,
  sameRawStoreIdentity,
} from "./storeIdentitySnapshot";
import type {
  RawStoreIdentity,
  StoreIdentitySnapshot,
} from "./storeIdentitySnapshot";

export interface IdentityAdminOptions {
  readonly supabaseUrl: string;
  readonly publicKey: string;
  readonly userId: string;
  readonly authorize: () => Promise<{ userId: string; accessToken: string }>;
  readonly isCurrent: () => boolean;
  readonly signal: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}
export type IdentityAdminErrorCode =
  | "IDENTITY_ADMIN_INVALID"
  | "IDENTITY_ADMIN_ORIGIN"
  | "IDENTITY_ADMIN_KEY"
  | "IDENTITY_ADMIN_SESSION"
  | "IDENTITY_ADMIN_CONTEXT"
  | "IDENTITY_ADMIN_CANCELED"
  | "IDENTITY_ADMIN_TIMEOUT"
  | "IDENTITY_ADMIN_NETWORK"
  | "IDENTITY_ADMIN_PROTOCOL"
  | "IDENTITY_ADMIN_PERMISSION"
  | "IDENTITY_ADMIN_MISSING"
  | "IDENTITY_ADMIN_UNAVAILABLE";
export class IdentityAdminError extends Error {
  readonly code: IdentityAdminErrorCode;
  constructor(code: IdentityAdminErrorCode) {
    super(code);
    this.name = "IdentityAdminError";
    this.code = code;
  }
}
export type IdentityAdminRejectionCode =
  | "invalid"
  | "permission"
  | "missing"
  | "write-rejected"
  | "session"
  | "unavailable";
export type IdentityAdminPendingReason =
  | "canceled"
  | "context"
  | "timeout"
  | "origin"
  | "unconfirmed";
export interface StoreIdentityIntent {
  readonly expected: StoreIdentitySnapshot;
  readonly desired: RawStoreIdentity;
}
export type SaveAdminStoreIdentityResult =
  | {
      readonly status: "confirmed";
      readonly snapshot: StoreIdentitySnapshot;
      readonly source: "response" | "readback";
    }
  | { readonly status: "conflict"; readonly source: "server" }
  | {
      readonly status: "conflict";
      readonly source: "readback";
      readonly current: StoreIdentitySnapshot;
    }
  | { readonly status: "rejected"; readonly code: IdentityAdminRejectionCode }
  | { readonly status: "pending"; readonly reason: IdentityAdminPendingReason };

// Public errors and external exceptions cannot impersonate private provenance.
const failures = new WeakMap<object, IdentityAdminErrorCode>();
function fault(code: IdentityAdminErrorCode): Error {
  const error = new Error(code);
  failures.set(error, code);
  return error;
}
function failureCode(error: unknown): IdentityAdminErrorCode {
  return typeof error === "object" && error !== null
    ? (failures.get(error) ?? "IDENTITY_ADMIN_NETWORK")
    : "IDENTITY_ADMIN_NETWORK";
}
function pending(code: IdentityAdminErrorCode): SaveAdminStoreIdentityResult {
  let reason: IdentityAdminPendingReason = "unconfirmed";
  if (code === "IDENTITY_ADMIN_CANCELED") reason = "canceled";
  if (code === "IDENTITY_ADMIN_CONTEXT") reason = "context";
  if (code === "IDENTITY_ADMIN_TIMEOUT") reason = "timeout";
  if (code === "IDENTITY_ADMIN_ORIGIN") reason = "origin";
  return Object.freeze({ status: "pending", reason });
}
function capture(options: IdentityAdminOptions) {
  let captured: IdentityAdminOptions;
  try {
    const {
      supabaseUrl,
      publicKey,
      userId,
      authorize,
      isCurrent,
      signal,
      fetchImpl = globalThis.fetch,
      timeoutMs = 30000,
    } = options;
    captured = {
      supabaseUrl,
      publicKey,
      userId,
      authorize,
      isCurrent,
      signal,
      fetchImpl,
      timeoutMs,
    };
  } catch {
    throw fault("IDENTITY_ADMIN_INVALID");
  }
  const {
    userId,
    authorize,
    isCurrent,
    signal,
    fetchImpl,
    timeoutMs,
    publicKey,
  } = captured;
  if (
    typeof userId !== "string" ||
    !userId ||
    userId.trim() !== userId ||
    userId.length > 128 ||
    typeof authorize !== "function" ||
    typeof isCurrent !== "function" ||
    !(signal instanceof AbortSignal) ||
    typeof fetchImpl !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs === undefined ||
    timeoutMs < 1 ||
    timeoutMs > 120000
  )
    throw fault("IDENTITY_ADMIN_INVALID");
  try {
    if (typeof publicKey !== "string" || publicKey.length > 8192)
      throw new Error();
    assertPublicSupabaseKey(publicKey);
  } catch {
    throw fault("IDENTITY_ADMIN_KEY");
  }
  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(captured.supabaseUrl);
  } catch {
    throw fault("IDENTITY_ADMIN_ORIGIN");
  }
  return { ...captured, origin, fetchImpl, timeoutMs };
}
// The codecs already exclude getters, cycles and non-JSON values. This copy only
// removes readonly from the SDK argument type; it does not normalize old values.
function mutableJson(
  value:
    | RawStoreIdentity
    | RawStoreIdentity["branding_assets"]
    | Json
    | readonly unknown[],
): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item: Json) => mutableJson(item));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mutableJson(item)]),
  );
}
type RpcName = "read_store_identity" | "save_store_identity";
type SaveArgs = Database["public"]["Functions"]["save_store_identity"]["Args"];
interface Received {
  readonly status: number;
  readonly data: unknown;
}
function knownRejection(
  received: Received,
): IdentityAdminRejectionCode | "conflict" | undefined {
  const { status, data } = received;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return;
  const { code, message } = data as { code?: unknown; message?: unknown };
  if (status === 400 && code === "P0001" && message === "IDENTITY_CONFLICT")
    return "conflict";
  if (
    status === 400 &&
    (code === "22023" || code === "23514") &&
    message === "IDENTITY_INVALID"
  )
    return "invalid";
  if (
    (status === 401 || status === 403) &&
    code === "42501" &&
    message === "IDENTITY_PERMISSION"
  )
    return "permission";
  if (status === 500 && code === "P0002" && message === "IDENTITY_MISSING")
    return "missing";
  if (
    status === 400 &&
    code === "P0001" &&
    message === "IDENTITY_WRITE_UNCONFIRMED"
  )
    return "write-rejected";
  if (status === 404 && code === "PGRST202") return "unavailable";
  if (
    status === 401 &&
    (code === "PGRST301" || code === "PGRST302" || code === "PGRST303")
  )
    return "session";
}
function snapshotFrom(received: Received): StoreIdentitySnapshot {
  if (received.status === 200) {
    try {
      return parseStoreIdentitySnapshot(received.data);
    } catch {
      throw fault("IDENTITY_ADMIN_PROTOCOL");
    }
  }
  switch (knownRejection(received)) {
    case "invalid":
      throw fault("IDENTITY_ADMIN_INVALID");
    case "permission":
      throw fault("IDENTITY_ADMIN_PERMISSION");
    case "missing":
      throw fault("IDENTITY_ADMIN_MISSING");
    case "session":
      throw fault("IDENTITY_ADMIN_SESSION");
    case "unavailable":
      throw fault("IDENTITY_ADMIN_UNAVAILABLE");
    default:
      throw fault("IDENTITY_ADMIN_PROTOCOL");
  }
}

function operation(options: IdentityAdminOptions, started: number) {
  const {
    origin,
    publicKey,
    userId,
    authorize,
    isCurrent,
    signal,
    fetchImpl,
    timeoutMs,
  } = capture(options);
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  let closed = false;
  let writeSent = false;
  let terminalCode: IdentityAdminErrorCode | undefined;
  let rejectTerminal!: (error: Error) => void;
  const terminal = new Promise<never>((_resolve, reject) => {
    rejectTerminal = reject;
  });
  const stop = (code: IdentityAdminErrorCode) => {
    if (!terminalCode) {
      terminalCode = code;
      rejectTerminal(fault(code));
      controller.abort();
    }
    return fault(terminalCode);
  };
  const checkSignalTime = () => {
    if (terminalCode) throw fault(terminalCode);
    if (closed || signal.aborted) throw stop("IDENTITY_ADMIN_CANCELED");
    if (performance.now() >= deadline) throw stop("IDENTITY_ADMIN_TIMEOUT");
  };
  const check = () => {
    checkSignalTime();
    let current = false;
    try {
      current = isCurrent() === true;
    } catch {
      /* Caller diagnostics stay private. */
    }
    checkSignalTime();
    if (!current) throw stop("IDENTITY_ADMIN_CONTEXT");
  };
  const onAbort = () => {
    stop("IDENTITY_ADMIN_CANCELED");
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => {
      stop("IDENTITY_ADMIN_TIMEOUT");
    },
    Math.max(0, deadline - performance.now()),
  );
  const discard = (response: Response) => {
    try {
      if (!response.body?.locked)
        void response.body?.cancel().catch(() => undefined);
    } catch {
      /* A hostile or late body must not change the public outcome. */
    }
  };
  const readResponse = async (response: Response): Promise<string> => {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      if (!response.body) throw new Error();
      reader = response.body.getReader();
    } catch {
      throw fault("IDENTITY_ADMIN_NETWORK");
    }
    const cancel = () => {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        /* No blocking cleanup. */
      }
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        check();
        let part: ReadableStreamReadResult<Uint8Array>;
        try {
          part = await reader.read();
        } catch {
          throw fault("IDENTITY_ADMIN_NETWORK");
        }
        check();
        if (part.done) break;
        if (
          !ArrayBuffer.isView(part.value) ||
          Object.prototype.toString.call(part.value) !== "[object Uint8Array]"
        )
          throw fault("IDENTITY_ADMIN_PROTOCOL");
        length += part.value.byteLength;
        if (length > 1048576) throw fault("IDENTITY_ADMIN_PROTOCOL");
        chunks.push(part.value.slice());
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw fault("IDENTITY_ADMIN_PROTOCOL");
      }
    } catch (error) {
      cancel();
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      try {
        reader.releaseLock();
      } catch {
        /* Pending native read can own its lock. */
      }
    }
  };
  let token = "";
  let active:
    | {
        name: RpcName;
        body: string;
        received?: Received;
        error?: IdentityAdminErrorCode;
        used: boolean;
      }
    | undefined;
  const controlledFetch: typeof fetch = async (input, init) => {
    const call = active;
    let response: Response | undefined;
    try {
      check();
      if (
        !call ||
        call.used ||
        typeof input !== "string" ||
        input !== `${origin}/rest/v1/rpc/${call.name}`
      )
        throw fault("IDENTITY_ADMIN_ORIGIN");
      if (init?.method !== "POST" || init.body !== call.body)
        throw fault("IDENTITY_ADMIN_PROTOCOL");
      call.used = true;
      const headers = new Headers({
        apikey: publicKey,
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        "content-profile": "public",
      });
      check();
      if (call.name === "save_store_identity") writeSent = true;
      try {
        response = await fetchImpl(input, {
          method: "POST",
          body: call.body,
          headers,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        check();
        throw fault("IDENTITY_ADMIN_NETWORK");
      }
      check();
      if (response.redirected || response.url !== input)
        throw fault("IDENTITY_ADMIN_ORIGIN");
      const status = response.status;
      const mime = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (mime !== "application/json") throw fault("IDENTITY_ADMIN_PROTOCOL");
      const text = await readResponse(response);
      check();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw fault("IDENTITY_ADMIN_PROTOCOL");
      }
      call.received = { status, data };
      return new Response(text, {
        status,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      if (response) discard(response);
      const code = terminalCode ?? failureCode(error);
      if (call) call.error = code;
      throw fault(code);
    }
  };
  const initialize = async () => {
    check();
    let authorizedUser: unknown;
    let accessToken: unknown;
    try {
      const authorization = await authorize();
      authorizedUser = authorization.userId;
      accessToken = authorization.accessToken;
    } catch {
      check();
      throw fault("IDENTITY_ADMIN_SESSION");
    }
    check();
    if (
      authorizedUser !== userId ||
      typeof accessToken !== "string" ||
      !accessToken ||
      accessToken.trim() !== accessToken ||
      accessToken.length > 16384 ||
      /[\r\n]/.test(accessToken)
    )
      throw fault("IDENTITY_ADMIN_SESSION");
    token = accessToken;
    return createClient<Database>(origin, publicKey, {
      accessToken: async () => token,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: controlledFetch },
    });
  };
  type Client = Awaited<ReturnType<typeof initialize>>;
  const rpc = async (
    client: Client,
    name: RpcName,
    args?: SaveArgs,
  ): Promise<Received> => {
    check();
    const call = {
      name,
      body: JSON.stringify(args ?? {}),
      used: false,
    } as NonNullable<typeof active>;
    active = call;
    try {
      if (name === "save_store_identity" && args)
        await client
          .rpc(name, args)
          .retry(false)
          .abortSignal(controller.signal);
      else
        await client
          .rpc("read_store_identity", {})
          .retry(false)
          .abortSignal(controller.signal);
    } catch {
      /* SDK errors contain transport diagnostics; use only our receipt. */
    }
    check();
    if (call.error) throw fault(call.error);
    if (!call.received) throw fault("IDENTITY_ADMIN_NETWORK");
    return call.received;
  };
  return {
    check,
    initialize,
    rpc,
    sent: () => writeSent,
    async race<T>(run: () => Promise<T>): Promise<T> {
      const result = await Promise.race([run(), terminal]);
      check();
      return result;
    },
    finish() {
      closed = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      controller.abort();
    },
  };
}

export async function readAdminStoreIdentity(
  options: IdentityAdminOptions,
): Promise<StoreIdentitySnapshot> {
  const started = performance.now();
  let op: ReturnType<typeof operation> | undefined;
  try {
    op = operation(options, started);
    const currentOp = op;
    const result = await currentOp.race(async () =>
      snapshotFrom(
        await currentOp.rpc(
          await currentOp.initialize(),
          "read_store_identity",
        ),
      ),
    );
    currentOp.check();
    return result;
  } catch (error) {
    throw new IdentityAdminError(failureCode(error));
  } finally {
    op?.finish();
  }
}

export async function saveAdminStoreIdentity(
  intent: StoreIdentityIntent,
  options: IdentityAdminOptions,
): Promise<SaveAdminStoreIdentityResult> {
  const started = performance.now();
  let op: ReturnType<typeof operation> | undefined;
  try {
    let expected: StoreIdentitySnapshot;
    let desired: RawStoreIdentity;
    try {
      expected = parseStoreIdentitySnapshot(intent.expected);
      desired = parseRawStoreIdentity(intent.desired);
      if (
        [expected.identity, desired].some(
          (value) =>
            new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144,
        )
      )
        throw new Error();
    } catch {
      throw fault("IDENTITY_ADMIN_INVALID");
    }
    const args: SaveArgs = {
      expected_revision: expected.revision,
      expected_identity: mutableJson(expected.identity),
      desired_identity: mutableJson(desired),
    };
    const currentOp = operation(options, started);
    op = currentOp;
    const result = await currentOp.race(
      async (): Promise<SaveAdminStoreIdentityResult> => {
        const client = await currentOp.initialize();
        try {
          const received = await currentOp.rpc(
            client,
            "save_store_identity",
            args,
          );
          const rejection = knownRejection(received);
          if (rejection === "conflict")
            return Object.freeze({ status: "conflict", source: "server" });
          if (rejection)
            return Object.freeze({ status: "rejected", code: rejection });
          const snapshot = snapshotFrom(received);
          const changed = !sameRawStoreIdentity(expected.identity, desired);
          if (
            sameRawStoreIdentity(snapshot.identity, desired) &&
            (changed
              ? snapshot.revision !== expected.revision
              : snapshot.revision === expected.revision)
          )
            return Object.freeze({
              status: "confirmed",
              source: "response",
              snapshot,
            });
        } catch (error) {
          if (!currentOp.sent()) throw error;
          currentOp.check();
          if (failureCode(error) === "IDENTITY_ADMIN_ORIGIN")
            return pending("IDENTITY_ADMIN_ORIGIN");
        }
        currentOp.check();
        try {
          const current = snapshotFrom(
            await currentOp.rpc(client, "read_store_identity"),
          );
          return sameRawStoreIdentity(current.identity, desired)
            ? Object.freeze({
                status: "confirmed",
                source: "readback",
                snapshot: current,
              })
            : Object.freeze({
                status: "conflict",
                source: "readback",
                current,
              });
        } catch (error) {
          currentOp.check();
          return pending(failureCode(error));
        }
      },
    );
    currentOp.check();
    return result;
  } catch (error) {
    const code = failureCode(error);
    if (op?.sent()) return pending(code);
    throw new IdentityAdminError(code);
  } finally {
    op?.finish();
  }
}
