import { createHash } from "node:crypto";
import { inspect } from "node:util";
import type { Upload } from "tus-js-client";
import { afterEach, expect, it, vi } from "vitest";
import { IdentityUploadHttpError } from "../../src/lib/identityUploadHttp";
import {
  IdentityImageUploadError,
  uploadIdentityImage,
} from "../../src/lib/uploadIdentityImage";
import type { UploadIdentityImageOptions } from "../../src/lib/uploadIdentityImage";
type TusOptions = ConstructorParameters<typeof Upload>[1];
type Fake = {
  file: Blob;
  options: TusOptions;
  abort: (terminate?: boolean) => Promise<void>;
};

const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const image = {
  blob: new Blob([bytes], { type: "image/png" }),
  asset: {
    path: `v1/${sha256}/image.png`,
    sha256,
    bytes: bytes.length,
    media_type: "image/png" as const,
  },
};
const control = vi.hoisted(() => ({
  options: undefined as TusOptions | undefined,
  instances: [] as Fake[],
  start: undefined as ((u: Fake) => void) | undefined,
  find: undefined as (() => Promise<never[]>) | undefined,
}));
vi.mock("tus-js-client", () => ({
  DetailedError: class extends Error {},
  Upload: class {
    url =
      "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/id";
    file: Blob;
    options: TusOptions;
    constructor(file: Blob, options: TusOptions) {
      this.file = file;
      this.options = options;
      control.options = options;
      control.instances.push(this);
    }
    async findPreviousUploads() {
      if (control.find) return control.find();
      return this.options.urlStorage!.findUploadsByFingerprint(
        await this.options.fingerprint!(this.file as File, this.options),
      );
    }
    resumeFromPreviousUpload() {}
    start() {
      if (control.start) control.start(this);
      else success(this);
    }
    async abort() {}
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  control.instances.length = 0;
  control.start = undefined;
  control.find = undefined;
});
it("onSuccess nao confirma objeto publico diferente de mesmo tamanho", async () => {
  const publicBytes = bytes.slice();
  publicBytes[9] = 3;
  const fetchImpl = vi.fn(async () => {
    const res = new Response(publicBytes, {
      headers: { "content-type": "image/png" },
    });
    Object.defineProperty(res, "url", {
      value: `${origin}/storage/v1/object/public/branding/${image.asset.path}`,
    });
    return res;
  });
  await expect(
    uploadIdentityImage(image, {
      supabaseUrl: origin,
      userId: "u1",
      authorize: async () => ({ userId: "u1", accessToken: "test-only" }),
      isCurrent: () => true,
      signal: new AbortController().signal,
      storage: null,
      fetchImpl,
    }),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_UNCONFIRMED" });
});
function success(u: Fake) {
  u.options.onSuccess!({
    lastResponse: {
      getStatus: () => 204,
      getHeader: () => undefined,
      getBody: () => "",
      getUnderlyingObject: () => undefined,
    },
  });
}
function response(body: Uint8Array<ArrayBuffer> = bytes) {
  const res = new Response(body, { headers: { "content-type": "image/png" } });
  Object.defineProperty(res, "url", {
    value: `${origin}/storage/v1/object/public/branding/${image.asset.path}`,
  });
  return res;
}
function options(
  patch: Partial<UploadIdentityImageOptions> = {},
): UploadIdentityImageOptions {
  return {
    supabaseUrl: origin,
    userId: "u1",
    authorize: async () => ({ userId: "u1", accessToken: "test-only" }),
    isCurrent: () => true,
    signal: new AbortController().signal,
    storage: null,
    fetchImpl: async () => response(),
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
it("sucesso duplicado e erro tardio preservam verificacao em andamento", async () => {
  const wait = deferred<Response>();
  const fetchImpl = vi.fn(() => wait.promise);
  control.start = (u) => {
    success(u);
    success(u);
    u.options.onError!(new Error("late"));
  };
  const pending = uploadIdentityImage(image, options({ fetchImpl }));
  void pending.catch(() => {});
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  wait.resolve(response());
  expect((await pending).asset.path).toBe(image.asset.path);
});
it("configura chunks confirmados sem overwrite e congela resultado", async () => {
  const sent: RequestInit[] = [];
  const result = await uploadIdentityImage(
    image,
    options({
      fetchImpl: async (_url, init) => {
        sent.push(init!);
        return response();
      },
    }),
  );
  expect(sent).toMatchObject([
    {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    },
  ]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(control.options).toMatchObject({
    uploadSize: 10,
    chunkSize: 6291456,
    parallelUploads: 1,
    uploadDataDuringCreation: false,
    uploadLengthDeferred: false,
    overridePatchMethod: false,
    removeFingerprintOnSuccess: false,
    retryDelays: [0, 1000, 3000],
    metadata: {
      bucketName: "branding",
      objectName: image.asset.path,
      contentType: "image/png",
      cacheControl: "31536000",
    },
  });
  expect(control.options?.headers).toBeUndefined();
  expect(control.options?.onProgress).toBeUndefined();
});
it.each(["size", "mime", "sha", "empty"])(
  "recusa prepared inconsistente %s antes do SDK",
  async (kind) => {
    const prepared = { blob: image.blob, asset: { ...image.asset } };
    if (kind === "size")
      prepared.blob = new Blob([bytes.slice(1)], { type: "image/png" });
    if (kind === "mime")
      prepared.blob = new Blob([bytes], { type: "image/jpeg" });
    if (kind === "sha") {
      prepared.asset.sha256 = "a".repeat(64);
      prepared.asset.path = `v1/${prepared.asset.sha256}/image.png`;
    }
    if (kind === "empty") prepared.blob = new Blob([], { type: "image/png" });
    await expect(
      uploadIdentityImage(prepared, options()),
    ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_INVALID" });
    expect(control.instances).toHaveLength(0);
  },
);
it.each([0, 1800001, Number.NaN, 1.5])("recusa prazo %s", async (timeoutMs) => {
  await expect(
    uploadIdentityImage(image, options({ timeoutMs })),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_INVALID" });
});
it.each(["", " ", "x".repeat(129)])(
  "recusa usuario invalido",
  async (userId) => {
    await expect(
      uploadIdentityImage(image, options({ userId })),
    ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_INVALID" });
  },
);
it("cancela antes do import", async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    uploadIdentityImage(image, options({ signal: c.signal })),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_CANCELED" });
  expect(control.instances).toHaveLength(0);
});
it("timeout cobre SDK parado", async () => {
  control.start = () => {};
  await expect(
    uploadIdentityImage(image, options({ timeoutMs: 30 })),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_TIMEOUT" });
});
it("cancelar digest observa continuacao tardia", async () => {
  const wait = deferred<ArrayBuffer>();
  const c = new AbortController();
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => {
    c.abort();
    return wait.promise;
  });
  await expect(
    uploadIdentityImage(image, options({ signal: c.signal })),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_CANCELED" });
  wait.resolve(new ArrayBuffer(32));
  expect(control.instances).toHaveLength(0);
});
it("captura descritor e contexto antes do primeiro await", async () => {
  const prepared = { blob: image.blob, asset: { ...image.asset } };
  const o = options();
  const pending = uploadIdentityImage(prepared, o);
  prepared.asset.path = `v1/${"a".repeat(64)}/wrong.png`;
  Object.assign(o, { supabaseUrl: "https://evil.invalid", userId: "other" });
  expect((await pending).asset.path).toBe(image.asset.path);
});
it("erro sensivel do SDK nao escapa", async () => {
  control.start = (u) =>
    u.options.onError!(new Error("Bearer secret customer/name"));
  await expect(uploadIdentityImage(image, options())).rejects.toMatchObject({
    code: "IDENTITY_UPLOAD_PROTOCOL",
    message: "IDENTITY_UPLOAD_PROTOCOL",
  });
});
it("progresso que lanca encerra fixo", async () => {
  await expect(
    uploadIdentityImage(
      image,
      options({
        onProgress: () => {
          throw Error("secret");
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_INVALID" });
});
it("cancelar chunk impede progresso e sucesso tardios", async () => {
  const c = new AbortController();
  const progress: number[] = [];
  const fetchImpl = vi.fn(async () => response());
  control.start = (u) => {
    u.options.onChunkComplete!(6, 6, 10);
    success(u);
    u.options.onChunkComplete!(4, 10, 10);
  };
  await expect(
    uploadIdentityImage(
      image,
      options({
        signal: c.signal,
        fetchImpl,
        onProgress: (p) => {
          progress.push(p.uploadedBytes);
          if (p.uploadedBytes) c.abort();
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_CANCELED" });
  expect(progress).toEqual([0, 6]);
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("sessao muda durante GET e prevalece sobre bytes corretos", async () => {
  let current = true;
  await expect(
    uploadIdentityImage(
      image,
      options({
        isCurrent: () => current,
        fetchImpl: async () => {
          current = false;
          return response();
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_SESSION" });
});
const metadataHeader = () =>
  Object.entries({
    bucketName: "branding",
    objectName: image.asset.path,
    contentType: "image/png",
    cacheControl: "max-age=31536000",
  })
    .map(([k, v]) => `${k} ${btoa(v)}`)
    .join(",");
async function protocolCase(headers: Record<string, string>, status = 200) {
  control.start = (u) => {
    const request = u.options.httpStack!.createRequest(
      "HEAD",
      "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/id",
    );
    const reply = {
      getStatus: () => status,
      getHeader: (name: string) => new Map(Object.entries(headers)).get(name),
      getBody: () => "",
      getUnderlyingObject: () => undefined,
    };
    Promise.resolve()
      .then(() => u.options.onAfterResponse!(request, reply))
      .then(
        () => success(u),
        (e) => u.options.onError!(e),
      );
  };
  return uploadIdentityImage(image, options());
}
it.each([
  "missing",
  "duplicate",
  "bad-base64",
  "wrong-object",
  "wrong-bucket",
  "wrong-mime",
  "wrong-cache",
  "oversize",
])("HEAD %s impede retomada", async (kind) => {
  let metadata = metadataHeader();
  if (kind === "missing") metadata = "";
  if (kind === "duplicate") metadata += ",bucketName YnJhbmRpbmc=";
  if (kind === "bad-base64") metadata += ",x A===";
  if (kind === "wrong-object")
    metadata = metadata.replace(btoa(image.asset.path), btoa("another"));
  if (kind === "wrong-bucket")
    metadata = metadata.replace(btoa("branding"), btoa("other"));
  if (kind === "wrong-mime")
    metadata = metadata.replace(btoa("image/png"), btoa("image/jpeg"));
  if (kind === "wrong-cache")
    metadata = metadata.replace(btoa("max-age=31536000"), btoa("no-cache"));
  if (kind === "oversize") metadata += "x".repeat(8192);
  await expect(
    protocolCase({
      "Tus-Resumable": "1.0.0",
      "Upload-Length": "10",
      "Upload-Offset": "0",
      "Upload-Metadata": metadata,
    }),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_PROTOCOL" });
});
it.each(["10x", "010", "-1", "1.5", "11", "9007199254740992"])(
  "HEAD offset %s estrito",
  async (offset) => {
    await expect(
      protocolCase({
        "Tus-Resumable": "1.0.0",
        "Upload-Length": "10",
        "Upload-Offset": offset,
        "Upload-Metadata": metadataHeader(),
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_PROTOCOL" });
  },
);
it.each(["10x", "010", "9", ""])("HEAD length %s estrito", async (length) => {
  await expect(
    protocolCase({
      "Tus-Resumable": "1.0.0",
      "Upload-Length": length,
      "Upload-Offset": "0",
      "Upload-Metadata": metadataHeader(),
    }),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_PROTOCOL" });
});
it.each([400, 409, 422])("HEAD %s nao recria", async (status) => {
  await expect(protocolCase({}, status)).rejects.toMatchObject({
    code: "IDENTITY_UPLOAD_PROTOCOL",
  });
});
it("cancelar findPrevious pendente bloqueia start tardio", async () => {
  const wait = deferred<never[]>();
  control.find = () => wait.promise;
  const controller = new AbortController();
  const fetchImpl = vi.fn(async () => response());
  const pending = uploadIdentityImage(
    image,
    options({ signal: controller.signal, fetchImpl }),
  );
  await vi.waitFor(() => expect(control.instances).toHaveLength(1));
  controller.abort();
  await expect(pending).rejects.toMatchObject({
    code: "IDENTITY_UPLOAD_CANCELED",
  });
  wait.resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("prazo inclui busca de referencia que nunca termina", async () => {
  control.find = () => new Promise(() => {});
  await expect(
    uploadIdentityImage(image, options({ timeoutMs: 30 })),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_TIMEOUT" });
});
it.each(["cancel", "timeout"])(
  "GET publico pendente respeita %s e ignora bytes tardios",
  async (mode) => {
    const wait = deferred<Response>();
    const fetchImpl = vi.fn(() => wait.promise);
    const c = new AbortController();
    const pending = uploadIdentityImage(
      image,
      options({
        fetchImpl,
        signal: c.signal,
        timeoutMs: mode === "timeout" ? 100 : 1000,
      }),
    );
    void pending.catch(() => {});
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    if (mode === "cancel") c.abort();
    await expect(pending).rejects.toMatchObject({
      code:
        mode === "cancel"
          ? "IDENTITY_UPLOAD_CANCELED"
          : "IDENTITY_UPLOAD_TIMEOUT",
    });
    wait.resolve(response());
  },
);
it.each(["cancel", "changed-user"])(
  "autorizacao pendente %s nao envia request tardio",
  async (mode) => {
    const wait = deferred<{ userId: string; accessToken: string }>();
    const c = new AbortController();
    const fetchImpl = vi.fn(async () => response());
    const authorize = vi.fn(() => wait.promise);
    control.start = (u) => {
      const req = u.options.httpStack!.createRequest(
        "POST",
        u.options.endpoint!,
      );
      void req.send(null).catch((error) => u.options.onError!(error));
    };
    const pending = uploadIdentityImage(
      image,
      options({ authorize, signal: c.signal, fetchImpl }),
    );
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    if (mode === "cancel") c.abort();
    wait.resolve({
      userId: mode === "changed-user" ? "other" : "u1",
      accessToken: "only-synthetic",
    });
    await expect(pending).rejects.toMatchObject({
      code:
        mode === "cancel"
          ? "IDENTITY_UPLOAD_CANCELED"
          : "IDENTITY_UPLOAD_SESSION",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);
it("cancelamento sincronico da guarda prevalece ate retorno", async () => {
  const c = new AbortController();
  let checks = 0;
  await expect(
    uploadIdentityImage(
      image,
      options({
        signal: c.signal,
        isCurrent: () => {
          checks++;
          c.abort();
          return true;
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_CANCELED" });
  expect(checks).toBe(1);
});
it("callback de chunk que lanca para SDK e nao publica sucesso", async () => {
  const fetchImpl = vi.fn(async () => response());
  control.start = (u) => {
    u.options.onChunkComplete!(5, 5, 10);
    success(u);
  };
  await expect(
    uploadIdentityImage(
      image,
      options({
        fetchImpl,
        onProgress: (p) => {
          if (p.uploadedBytes > 0) throw Error("sensitive");
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_INVALID" });
  expect(fetchImpl).not.toHaveBeenCalled();
});
it.each([
  ["progress", "IDENTITY_UPLOAD_INVALID"],
  ["context", "IDENTITY_UPLOAD_SESSION"],
  ["authorize", "IDENTITY_UPLOAD_SESSION"],
  ["fetch", "IDENTITY_UPLOAD_UNCONFIRMED"],
  ["stream", "IDENTITY_UPLOAD_UNCONFIRMED"],
] as const)(
  "callback externo %s nao devolve diagnostico forjado",
  async (boundary, code) => {
    const forged = new IdentityImageUploadError("IDENTITY_UPLOAD_SESSION");
    Object.assign(forged, {
      code: "SYNTHETIC_SECRET_CODE",
      message: "SYNTHETIC_SECRET",
      extra: "SYNTHETIC_SECRET",
    });
    const fail = () => {
      throw forged;
    };
    if (boundary === "authorize" || boundary === "fetch") {
      control.start = (u) => {
        const request = u.options.httpStack!.createRequest(
          "POST",
          u.options.endpoint!,
        );
        void request.send(null).catch((error) => u.options.onError!(error));
      };
    }
    const error = await uploadIdentityImage(
      image,
      options({
        ...(boundary === "progress" ? { onProgress: fail } : {}),
        ...(boundary === "context" ? { isCurrent: fail } : {}),
        ...(boundary === "authorize" ? { authorize: fail } : {}),
        ...(boundary === "fetch" ? { fetchImpl: fail } : {}),
        ...(boundary === "stream"
          ? {
              fetchImpl: async () => {
                const res = new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.error(forged);
                    },
                  }),
                  {
                    headers: { "content-type": "image/png" },
                  },
                );
                Object.defineProperty(res, "url", {
                  value: `${origin}/storage/v1/object/public/branding/${image.asset.path}`,
                });
                return res;
              },
            }
          : {}),
      }),
    ).catch((value) => value);
    expect(error).not.toBe(forged);
    expect(error).toMatchObject({ code, message: code });
    expect(Object.hasOwn(error, "extra")).toBe(false);
  },
);
it.each(["cancel", "timeout"] as const)(
  "ultima guarda consome %s dentro do callback",
  async (mode) => {
    let totalGuards = 0;
    await uploadIdentityImage(
      image,
      options({
        isCurrent: () => {
          totalGuards++;
          return true;
        },
      }),
    );
    let guards = 0;
    let expired = false;
    const c = new AbortController();
    const now = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() =>
      expired ? now() + 2000000 : now(),
    );
    const pending = uploadIdentityImage(
      image,
      options({
        signal: c.signal,
        isCurrent: () => {
          if (++guards === totalGuards) {
            if (mode === "cancel") c.abort();
            else expired = true;
          }
          return true;
        },
      }),
    );
    await expect(pending).rejects.toMatchObject({
      code:
        mode === "cancel"
          ? "IDENTITY_UPLOAD_CANCELED"
          : "IDENTITY_UPLOAD_TIMEOUT",
    });
    expect(guards).toBe(totalGuards);
  },
);
it("cancelamento na ultima guarda nao perde referencia ja existente", async () => {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([origin, "u1", image.asset.path, sha256, 10, "image/png"]),
    )
    .digest("hex");
  const key = `ikcous.identityUpload.v1.aaaaaaaaaaaaaaaaaaaa.${createHash("sha256").update("u1").digest("hex")}.${fingerprint}`;
  const record = JSON.stringify({
    version: 1,
    origin,
    userId: "u1",
    path: image.asset.path,
    sha256,
    bytes: 10,
    mediaType: "image/png",
    createdAt: Date.now(),
    uploadUrl:
      "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/id",
  });
  const saved = new Map([[key, record]]);
  const storage = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, value: string) => {
      saved.set(k, value);
    },
    removeItem: (k: string) => {
      saved.delete(k);
    },
    key: (i: number) => [...saved.keys()].at(i) ?? null,
    get length() {
      return saved.size;
    },
  };
  let guards = 0;
  await uploadIdentityImage(
    image,
    options({
      storage,
      isCurrent: () => {
        guards++;
        return true;
      },
    }),
  );
  const lastGuard = guards;
  expect(saved.has(key)).toBe(false);
  saved.set(key, record);
  guards = 0;
  const c = new AbortController();
  await expect(
    uploadIdentityImage(
      image,
      options({
        storage,
        signal: c.signal,
        isCurrent: () => {
          if (++guards === lastGuard) c.abort();
          return true;
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_CANCELED" });
  expect(saved.get(key)).toBe(record);

  // Conversely, Storage cleanup runs only after fulfillment. Reentrant cancel,
  // late SDK callbacks and an optional-storage error cannot revoke that result.
  const cleanupController = new AbortController();
  const stages: string[] = [];
  let cleanupState = "";
  storage.removeItem = (k) => {
    cleanupState = inspect(successPending);
    cleanupController.abort();
    saved.delete(k);
    control.options!.onChunkComplete!(10, 10, 10);
    success(control.instances.at(-1)!);
    throw new Error("SYNTHETIC_STORAGE_SECRET");
  };
  const successPending = uploadIdentityImage(
    image,
    options({
      storage,
      signal: cleanupController.signal,
      onProgress: (value) => {
        stages.push(value.stage);
      },
    }),
  );
  const delivered = await successPending;
  expect(cleanupState).not.toBe("");
  expect(cleanupState).not.toContain("<pending>");
  expect(delivered.asset.path).toBe(image.asset.path);
  expect(saved.has(key)).toBe(false);
  expect(stages).toEqual(["uploading", "verifying"]);
  expect(await successPending).toBe(delivered);
});
it.each(["public-class", "http-class", "arbitrary-code"] as const)(
  "erro forjado do SDK %s nao recebe proveniencia interna",
  async (kind) => {
    const forged =
      kind === "http-class"
        ? new IdentityUploadHttpError("IDENTITY_UPLOAD_SESSION")
        : new IdentityImageUploadError("IDENTITY_UPLOAD_SESSION");
    Object.assign(forged, {
      message: "SYNTHETIC_SECRET_IN_MESSAGE",
      extra: "SYNTHETIC_SECRET_EXTRA",
      ...(kind === "arbitrary-code" ? { code: "SYNTHETIC_SECRET_CODE" } : {}),
    });
    control.start = (u) => u.options.onError!(forged);
    const error = await uploadIdentityImage(image, options()).catch(
      (value) => value,
    );
    expect(error).not.toBe(forged);
    expect(error).toMatchObject({
      code: "IDENTITY_UPLOAD_PROTOCOL",
      message: "IDENTITY_UPLOAD_PROTOCOL",
    });
    expect(Object.hasOwn(error, "extra")).toBe(false);
  },
);
it("getter de resposta HTTP forja sessao mas falha na fronteira externa", async () => {
  const forged = new IdentityUploadHttpError("IDENTITY_UPLOAD_SESSION");
  Object.assign(forged, {
    code: "SYNTHETIC_SECRET_CODE",
    message: "SYNTHETIC_SECRET",
    extra: "SYNTHETIC_SECRET",
  });
  control.start = (u) => {
    const request = u.options.httpStack!.createRequest(
      "POST",
      u.options.endpoint!,
    );
    void request.send(null).catch((error) => u.options.onError!(error));
  };
  const error = await uploadIdentityImage(
    image,
    options({
      fetchImpl: async () => {
        const res = response();
        Object.defineProperty(res, "status", {
          get() {
            throw forged;
          },
        });
        return res;
      },
    }),
  ).catch((value) => value);
  expect(error).toMatchObject({
    code: "IDENTITY_UPLOAD_UNCONFIRMED",
    message: "IDENTITY_UPLOAD_UNCONFIRMED",
  });
  expect(Object.hasOwn(error, "extra")).toBe(false);
});
// The second digest of the original bytes is public verification, after upload
// and resume fingerprints. Walk its microtask continuations rather than pinning
// an implementation-specific number of isCurrent calls.
it.each(["cancel", "session", "timeout"] as const)(
  "fronteira publica pendente preserva referencia em %s",
  async (mode) => {
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    const now = performance.now.bind(performance);
    let pendingChanges = 0;
    let fulfilledChanges = 0;
    for (let hops = 0; hops < 9; hops++) {
      const changed = deferred<void>();
      let originalDigests = 0;
      let verified = false;
      let scheduled = false;
      let stateAtChange = "";
      let current = true;
      let expired = false;
      const c = new AbortController();
      const key = `ikcous.identityUpload.v1.aaaaaaaaaaaaaaaaaaaa.${createHash("sha256").update("u1").digest("hex")}.${createHash(
        "sha256",
      )
        .update(
          JSON.stringify([
            origin,
            "u1",
            image.asset.path,
            sha256,
            10,
            "image/png",
          ]),
        )
        .digest("hex")}`;
      const record = JSON.stringify({
        version: 1,
        origin,
        userId: "u1",
        path: image.asset.path,
        sha256,
        bytes: 10,
        mediaType: "image/png",
        uploadUrl:
          "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable/id",
        createdAt: Date.now(),
      });
      const saved = new Map([[key, record]]);
      const storage = {
        getItem: (k: string) => saved.get(k) ?? null,
        setItem: (k: string, value: string) => {
          saved.set(k, value);
        },
        removeItem: (k: string) => {
          saved.delete(k);
        },
        key: (i: number) => [...saved.keys()].at(i) ?? null,
        get length() {
          return saved.size;
        },
      };
      vi.spyOn(performance, "now").mockImplementation(() =>
        expired ? now() + 2000000 : now(),
      );
      vi.spyOn(crypto.subtle, "digest").mockImplementation(
        async (algorithm, data) => {
          const result = await nativeDigest(algorithm, data);
          if (data.byteLength === bytes.length && ++originalDigests === 2)
            verified = true;
          return result;
        },
      );
      const advance = (remaining: number) => {
        if (remaining > 0) {
          queueMicrotask(() => advance(remaining - 1));
          return;
        }
        stateAtChange = inspect(pending);
        if (mode === "cancel") c.abort();
        if (mode === "session") current = false;
        if (mode === "timeout") expired = true;
        changed.resolve();
      };
      const pending: ReturnType<typeof uploadIdentityImage> =
        uploadIdentityImage(
          image,
          options({
            signal: c.signal,
            storage,
            isCurrent: () => {
              if (verified && !scheduled) {
                scheduled = true;
                queueMicrotask(() => advance(hops));
              }
              return current;
            },
          }),
        );
      const outcome = await pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await changed.promise;
      // The mutation may run after fulfillment but before this observer. That is
      // a control case: settled success must stay success, not be retroactively undone.
      expect(scheduled).toBe(true);
      if (stateAtChange.includes("<pending>")) {
        pendingChanges++;
        expect(outcome, `microtask ${hops}: ${stateAtChange}`).toMatchObject({
          error: {
            code:
              mode === "cancel"
                ? "IDENTITY_UPLOAD_CANCELED"
                : mode === "session"
                  ? "IDENTITY_UPLOAD_SESSION"
                  : "IDENTITY_UPLOAD_TIMEOUT",
          },
        });
        expect(saved.get(key)).toBe(record);
      } else {
        fulfilledChanges++;
        expect(outcome).toHaveProperty("value.asset.path", image.asset.path);
        expect(saved.has(key)).toBe(false);
        expect(await pending).toBe(
          "value" in outcome ? outcome.value : undefined,
        );
      }
      vi.restoreAllMocks();
    }
    expect(pendingChanges).toBeGreaterThan(0);
    expect(fulfilledChanges).toBeGreaterThan(0);
  },
);
it.each([
  "options",
  "image",
  "blob-size",
  "http-class",
  "arbitrary-code",
] as const)(
  "getter externo %s nunca autentica classe publica",
  async (kind) => {
    const forged =
      kind === "http-class"
        ? new IdentityUploadHttpError("IDENTITY_UPLOAD_SESSION")
        : new IdentityImageUploadError("IDENTITY_UPLOAD_INVALID");
    Object.assign(forged, {
      message: "SYNTHETIC_SECRET_IN_MESSAGE",
      extra: "SYNTHETIC_SECRET_EXTRA",
      ...(kind === "arbitrary-code" ? { code: "SYNTHETIC_SECRET_CODE" } : {}),
    });
    const fetchImpl = vi.fn(async () => response());
    const o = options({ fetchImpl });
    const prepared = {
      ...image,
      blob: image.blob.slice(0, image.blob.size, image.blob.type),
    };
    const target =
      kind === "image" ? prepared : kind === "blob-size" ? prepared.blob : o;
    const property =
      kind === "image"
        ? "asset"
        : kind === "blob-size"
          ? "size"
          : "supabaseUrl";
    Object.defineProperty(target, property, {
      configurable: true,
      get() {
        throw forged;
      },
    });
    const error = await uploadIdentityImage(prepared, o).catch(
      (value) => value,
    );
    expect(error).not.toBe(forged);
    expect(error).toMatchObject({
      code: "IDENTITY_UPLOAD_INVALID",
      message: "IDENTITY_UPLOAD_INVALID",
    });
    expect(Object.hasOwn(error, "extra")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(control.instances).toHaveLength(0);
  },
);
it.each(["cancel", "timeout"])(
  "import pendente respeita %s sem construir cliente depois",
  async (mode) => {
    vi.resetModules();
    const gate = deferred<void>();
    const entered = vi.fn();
    const constructed = vi.fn();
    vi.doMock("tus-js-client", async () => {
      entered();
      await gate.promise;
      return {
        DetailedError: class extends Error {},
        Upload: class {
          constructor() {
            constructed();
          }
        },
      };
    });
    try {
      const { uploadIdentityImage: isolatedUpload } = await import(
        "../../src/lib/uploadIdentityImage"
      );
      const c = new AbortController();
      const pending = isolatedUpload(
        image,
        options({
          signal: c.signal,
          timeoutMs: mode === "timeout" ? 150 : 1000,
        }),
      );
      void pending.catch(() => {});
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      if (mode === "cancel") c.abort();
      await expect(pending).rejects.toMatchObject({
        code:
          mode === "cancel"
            ? "IDENTITY_UPLOAD_CANCELED"
            : "IDENTITY_UPLOAD_TIMEOUT",
      });
      gate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(constructed).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("tus-js-client");
      vi.resetModules();
    }
  },
);
