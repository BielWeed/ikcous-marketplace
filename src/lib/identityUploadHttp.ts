import { normalizeSupabaseOrigin } from "./storeIdentity";

export type IdentityUploadHttpCode =
  | "IDENTITY_UPLOAD_INVALID"
  | "IDENTITY_UPLOAD_ORIGIN"
  | "IDENTITY_UPLOAD_SESSION"
  | "IDENTITY_UPLOAD_CANCELED"
  | "IDENTITY_UPLOAD_TIMEOUT"
  | "IDENTITY_UPLOAD_NETWORK";

export class IdentityUploadHttpError extends Error {
  readonly code: IdentityUploadHttpCode;

  constructor(code: IdentityUploadHttpCode) {
    super(code);
    this.name = "IdentityUploadHttpError";
    this.code = code;
  }
}

export interface IdentityUploadAuthorization {
  readonly userId: string;
  readonly accessToken: string;
}

export interface IdentityUploadHttpOptions {
  supabaseUrl: string;
  userId: string;
  isCurrent: () => boolean;
  authorize: () => Promise<IdentityUploadAuthorization>;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface IdentityUploadHttpResponse {
  getStatus(): number;
  getHeader(name: string): string | undefined;
  getBody(): string;
  getUnderlyingObject(): undefined;
}

export interface IdentityUploadHttpRequest {
  getMethod(): string;
  getURL(): string;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  setProgressHandler(handler: (bytesSent: number) => void): void;
  send(body?: Blob | null): Promise<IdentityUploadHttpResponse>;
  abort(): Promise<void>;
  getUnderlyingObject(): undefined;
}

export interface IdentityUploadHttpStack {
  createRequest(method: string, url: string): IdentityUploadHttpRequest;
  getName(): string;
}

const requestHeaders = new Set([
  "tus-resumable",
  "upload-length",
  "upload-offset",
  "upload-metadata",
  "content-type",
]);
const responseHeaders = [
  "location",
  "upload-offset",
  "upload-length",
  "tus-resumable",
  "tus-version",
  "tus-extension",
  "tus-max-size",
  "retry-after",
  "upload-expires",
];

function discardBody(response: Response): void {
  // Never wait for, read, or expose a server body, even after a late fetch.
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Cancellation failure must not replace the request's fixed error code.
  }
}

export function createIdentityUploadHttpStack(
  options: IdentityUploadHttpOptions,
): IdentityUploadHttpStack {
  const {
    supabaseUrl,
    userId,
    isCurrent,
    authorize,
    signal,
    fetchImpl = fetch,
    timeoutMs = 30000,
  } = options;
  let origin: string;
  try {
    origin = normalizeSupabaseOrigin(supabaseUrl);
  } catch {
    throw new IdentityUploadHttpError("IDENTITY_UPLOAD_ORIGIN");
  }
  if (
    typeof userId !== "string" ||
    userId.trim().length === 0 ||
    userId.length > 128 ||
    typeof isCurrent !== "function" ||
    typeof authorize !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000
  ) {
    throw new IdentityUploadHttpError("IDENTITY_UPLOAD_INVALID");
  }
  const projectRef = new URL(origin).hostname.split(".")[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;

  function checkUploadUrl(url: string): void {
    if (
      typeof url !== "string" ||
      !url.startsWith(`${endpoint}/`) ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(url.slice(endpoint.length + 1))
    ) {
      throw new IdentityUploadHttpError("IDENTITY_UPLOAD_ORIGIN");
    }
  }

  function checkSession(): void {
    try {
      if (isCurrent() !== true) throw new Error();
    } catch {
      throw new IdentityUploadHttpError("IDENTITY_UPLOAD_SESSION");
    }
  }

  return {
    getName: () => "IdentityUploadFetch",
    createRequest(method, url) {
      if (!["POST", "HEAD", "PATCH"].includes(method)) {
        throw new IdentityUploadHttpError("IDENTITY_UPLOAD_INVALID");
      }
      if (method === "POST") {
        if (url !== endpoint) {
          throw new IdentityUploadHttpError("IDENTITY_UPLOAD_ORIGIN");
        }
      } else {
        checkUploadUrl(url);
      }

      const headers = new Map<string, string>();
      let sent = false;
      let canceled = false;
      let cancelPending: (() => void) | undefined;

      return {
        getMethod: () => method,
        getURL: () => url,
        getUnderlyingObject: () => undefined,
        getHeader: (name) => headers.get(name.toLowerCase()),
        setHeader(name, value) {
          if (
            sent ||
            typeof name !== "string" ||
            !requestHeaders.has(name.toLowerCase()) ||
            typeof value !== "string" ||
            /[\r\n]/.test(value)
          ) {
            throw new IdentityUploadHttpError("IDENTITY_UPLOAD_INVALID");
          }
          headers.set(name.toLowerCase(), value);
        },
        setProgressHandler() {
          // Fetch has no confirmed upload progress. TUS owns chunk confirmation.
        },
        async abort() {
          // This stops future work; it cannot recall bytes already received.
          canceled = true;
          cancelPending?.();
        },
        async send(body) {
          if (canceled || signal.aborted) {
            throw new IdentityUploadHttpError("IDENTITY_UPLOAD_CANCELED");
          }
          if (sent) {
            throw new IdentityUploadHttpError("IDENTITY_UPLOAD_INVALID");
          }
          sent = true;
          if (
            method === "PATCH"
              ? !(body instanceof Blob) || body.size > 6 * 1024 * 1024
              : body !== undefined && body !== null
          ) {
            throw new IdentityUploadHttpError("IDENTITY_UPLOAD_INVALID");
          }

          const controller = new AbortController();
          const deadline = performance.now() + timeoutMs;
          let terminalError: IdentityUploadHttpError | undefined;
          let rejectStopped!: (error: IdentityUploadHttpError) => void;
          const stopped = new Promise<never>((_resolve, reject) => {
            rejectStopped = reject;
          });
          const stop = (
            code: "IDENTITY_UPLOAD_CANCELED" | "IDENTITY_UPLOAD_TIMEOUT",
          ) => {
            if (terminalError) return;
            terminalError = new IdentityUploadHttpError(code);
            rejectStopped(terminalError);
            controller.abort();
          };
          const onAbort = () => stop("IDENTITY_UPLOAD_CANCELED");
          cancelPending = onAbort;
          signal.addEventListener("abort", onAbort, { once: true });
          const timer = setTimeout(
            () => stop("IDENTITY_UPLOAD_TIMEOUT"),
            timeoutMs,
          );
          const checkActive = () => {
            if (canceled || signal.aborted) stop("IDENTITY_UPLOAD_CANCELED");
            if (performance.now() >= deadline) stop("IDENTITY_UPLOAD_TIMEOUT");
            if (terminalError) throw terminalError;
            checkSession();
            // isCurrent is caller code and may synchronously abort.
            if (canceled || signal.aborted) stop("IDENTITY_UPLOAD_CANCELED");
            if (performance.now() >= deadline) stop("IDENTITY_UPLOAD_TIMEOUT");
            if (terminalError) throw terminalError;
          };

          const run = async (): Promise<IdentityUploadHttpResponse> => {
            checkActive();
            let accessToken: string;
            try {
              const authorization = await authorize();
              const authorizedUserId = authorization.userId;
              accessToken = authorization.accessToken;
              if (
                authorizedUserId !== userId ||
                typeof accessToken !== "string" ||
                accessToken.trim().length === 0 ||
                /[\r\n]/.test(accessToken)
              ) {
                throw new Error();
              }
            } catch {
              throw new IdentityUploadHttpError("IDENTITY_UPLOAD_SESSION");
            }

            let privateHeaders: Headers;
            try {
              privateHeaders = new Headers(Array.from(headers));
              privateHeaders.set("Authorization", `Bearer ${accessToken}`);
            } catch {
              throw new IdentityUploadHttpError("IDENTITY_UPLOAD_INVALID");
            }
            accessToken = "";
            checkActive();
            // No await between the final context guard and the actual send.
            let response: Response;
            try {
              response = await fetchImpl(url, {
                method,
                headers: privateHeaders,
                body,
                signal: controller.signal,
                redirect: "error",
                credentials: "omit",
              });
            } catch {
              throw (
                terminalError ??
                new IdentityUploadHttpError("IDENTITY_UPLOAD_NETWORK")
              );
            }
            discardBody(response);
            checkActive();
            if (response.status === 401 || response.status === 403) {
              throw new IdentityUploadHttpError("IDENTITY_UPLOAD_SESSION");
            }
            if (
              response.redirected ||
              (response.url !== "" && response.url !== url)
            ) {
              throw new IdentityUploadHttpError("IDENTITY_UPLOAD_ORIGIN");
            }
            const publicHeaders = new Map<string, string>();
            for (const name of responseHeaders) {
              const value = response.headers.get(name);
              if (value === null) continue;
              if (name === "location") checkUploadUrl(value);
              publicHeaders.set(name, value);
            }
            const status = response.status;
            return {
              getStatus: () => status,
              getHeader: (name) => publicHeaders.get(name.toLowerCase()),
              getBody: () => "",
              getUnderlyingObject: () => undefined,
            };
          };

          try {
            // Race observes late rejections even if auth/fetch ignore abort.
            return await Promise.race([stopped, run()]);
          } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            cancelPending = undefined;
          }
        },
      };
    },
  };
}
