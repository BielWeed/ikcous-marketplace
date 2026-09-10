import { createHash } from "node:crypto";
import { verifyPublicIdentityAsset } from "@/lib/publicStoreIdentity";
import type { VerifyPublicIdentityAssetOptions } from "@/lib/publicStoreIdentity";
import { IdentityError } from "@/lib/storeIdentity";
import type { IdentityAsset } from "@/lib/storeIdentity";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://abcdefghijklmnopqrst.supabase.co";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
function descriptor(
  bytes = png,
  media_type: IdentityAsset["media_type"] = "image/png",
  name = "original.png",
): IdentityAsset {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    path: `v1/${sha256}/${name}`,
    sha256,
    media_type,
    bytes: bytes.length,
  };
}
function urlFor(asset: IdentityAsset): string {
  return `${origin}/storage/v1/object/public/branding/${asset.path}`;
}
function publicResponse(
  body: BodyInit | null = png,
  url = urlFor(descriptor()),
  init: ResponseInit = {},
): Response {
  const response = new Response(body, {
    headers: { "content-type": "image/png" },
    ...init,
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
function options(
  patch: Partial<VerifyPublicIdentityAssetOptions> = {},
): VerifyPublicIdentityAssetOptions {
  return {
    supabaseUrl: origin,
    signal: new AbortController().signal,
    isCurrent: () => true,
    fetchImpl: async () => publicResponse(),
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("conferencia de um original hospedado", () => {
  it.each([
    ["image/png", "a.png", png],
    ["image/jpeg", "a.jpg", new Uint8Array([255, 216, 255, 0])],
    [
      "image/webp",
      "a.webp",
      new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
    ],
    ["image/vnd.microsoft.icon", "a.ico", new Uint8Array([0, 0, 1, 0, 1, 0])],
    ["image/svg+xml", "a.svg", new TextEncoder().encode("<svg/>")],
  ] as const)(
    "confirma somente bytes e URL de %s, sem credenciais",
    async (mime, name, bytes) => {
      const asset = descriptor(bytes, mime, name);
      const fetchImpl = vi.fn(async () =>
        publicResponse(bytes, urlFor(asset), {
          headers: { "content-type": ` ${mime.toUpperCase()}; charset=utf-8 ` },
        }),
      );
      const result = await verifyPublicIdentityAsset(
        asset,
        options({ fetchImpl }),
      );
      expect(result).toEqual({ asset, url: urlFor(asset) });
      expect(Object.keys(result).sort()).toEqual(["asset", "url"]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.asset)).toBe(true);
      expect(result.asset).not.toBe(asset);
      expect(Object.isFrozen(asset)).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0]).toEqual([
        urlFor(asset),
        {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: expect.any(AbortSignal),
        },
      ]);
    },
  );
  it.each([401, 403, 404, 409, 500])(
    "status %i cancela corpo sem ler",
    async (status) => {
      const cancel = vi.fn();
      const pull = vi.fn();
      const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
      await expect(
        verifyPublicIdentityAsset(
          descriptor(),
          options({
            fetchImpl: async () =>
              publicResponse(body, urlFor(descriptor()), { status }),
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ASSET_STATUS" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(pull).not.toHaveBeenCalled();
    },
  );
  it.each([
    "",
    `${origin}/other.png`,
    "https://elsewhere.example/a.png",
    "redirect",
  ])("recusa URL de resposta %s", async (url) => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const response = publicResponse(
      new ReadableStream({ cancel, pull }, { highWaterMark: 0 }),
      url === "redirect" ? urlFor(descriptor()) : url,
    );
    if (url === "redirect")
      Object.defineProperty(response, "redirected", { value: true });
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl: async () => response }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ORIGIN" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });
  it.each(["text/html", "", "image/jpeg"])(
    "recusa MIME %s antes da leitura",
    async (mime) => {
      const cancel = vi.fn();
      const pull = vi.fn();
      await expect(
        verifyPublicIdentityAsset(
          descriptor(),
          options({
            fetchImpl: async () =>
              publicResponse(
                new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
                urlFor(descriptor()),
                { headers: { "content-type": mime } },
              ),
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ASSET_MIME" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(pull).not.toHaveBeenCalled();
    },
  );
  it.each([null, new Uint8Array(), png.slice(0, -1), new Uint8Array(11)])(
    "recusa corpo ausente, vazio, curto ou longo %#",
    async (body) => {
      await expect(
        verifyPublicIdentityAsset(
          descriptor(),
          options({ fetchImpl: async () => publicResponse(body) }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ASSET_SIZE" });
    },
  );
  it("stream excedente cancela imediatamente", async () => {
    const cancel = vi.fn();
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          fetchImpl: async () =>
            publicResponse(
              new ReadableStream({
                start(c) {
                  c.enqueue(new Uint8Array(11));
                },
                cancel,
              }),
            ),
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ASSET_SIZE" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("falha de leitura nao vaza erro do transporte", async () => {
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          fetchImpl: async () =>
            publicResponse(
              new ReadableStream({
                pull(c) {
                  c.error(new Error("fictional-sensitive-marker"));
                },
              }),
            ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "IDENTITY_FETCH",
      message: "IDENTITY_FETCH",
    });
  });
  it.each([
    ["read", "identity"],
    ["read", "code"],
    ["getReader", "identity"],
    ["getReader", "code"],
    ["getReader", "plain"],
    ["digest", "identity"],
    ["digest", "code"],
    ["digest", "plain"],
  ] as const)(
    "falha externa de %s com erro %s vira FETCH novo e fixo",
    async (phase, kind) => {
      const marker = "fictional-sensitive-stream-marker";
      const external =
        kind === "plain"
          ? new Error(marker)
          : new IdentityError("IDENTITY_ASSET_HASH");
      external.message = marker;
      if (kind === "code")
        (external as unknown as { code: string }).code = marker;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (phase === "read") controller.error(external);
            else {
              controller.enqueue(png);
              controller.close();
            }
          },
        },
        { highWaterMark: 0 },
      );
      if (phase === "getReader")
        vi.spyOn(body, "getReader").mockImplementation(() => {
          throw external;
        });
      if (phase === "digest")
        vi.spyOn(crypto.subtle, "digest").mockRejectedValue(external);
      const error: unknown = await verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl: async () => publicResponse(body) }),
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        code: "IDENTITY_FETCH",
        message: "IDENTITY_FETCH",
      });
      expect(error).not.toBe(external);
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain(marker);
      expect(String(error)).not.toContain(marker);
      expect(body.locked).toBe(false);
      if (phase === "getReader") {
        vi.mocked(body.getReader).mockRestore();
        const reader = body.getReader();
        expect(await reader.read()).toEqual({ done: true, value: undefined });
        reader.releaseLock();
      }
    },
  );
  it.each([
    ["read", "cancel"],
    ["read", "timeout"],
    ["read", "context"],
    ["digest", "cancel"],
    ["digest", "timeout"],
    ["digest", "context"],
  ] as const)(
    "erro externo de %s simultaneo a %s conserva estado terminal",
    async (phase, reason) => {
      let now = 0;
      let current = true;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      const controller = new AbortController();
      const external = new IdentityError("IDENTITY_ASSET_HASH");
      external.message = "fictional-sensitive-stream-marker";
      const fail = () => {
        if (reason === "cancel") controller.abort(external.message);
        else if (reason === "timeout") now = 10;
        else current = false;
        throw external;
      };
      const body = new ReadableStream<Uint8Array>(
        {
          pull(stream) {
            if (phase === "read") fail();
            else {
              stream.enqueue(png);
              stream.close();
            }
          },
        },
        { highWaterMark: 0 },
      );
      if (phase === "digest")
        vi.spyOn(crypto.subtle, "digest").mockImplementation(async () =>
          fail(),
        );
      const code =
        reason === "cancel"
          ? "IDENTITY_CANCELED"
          : reason === "timeout"
            ? "IDENTITY_TIMEOUT"
            : "IDENTITY_CONTEXT";
      const result = verifyPublicIdentityAsset(
        descriptor(),
        options({
          fetchImpl: async () => publicResponse(body),
          signal: controller.signal,
          isCurrent: () => current,
          timeoutMs: 10,
        }),
      );
      await expect(result).rejects.toMatchObject({ code, message: code });
      await Promise.resolve();
      expect(body.locked).toBe(false);
    },
  );
  it("recusa assinatura errada mesmo com hash e tamanho declarados corretos", async () => {
    const bytes = png.slice();
    bytes[0] = 0;
    const asset = descriptor(bytes);
    await expect(
      verifyPublicIdentityAsset(
        asset,
        options({
          fetchImpl: async () => publicResponse(bytes, urlFor(asset)),
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ASSET_MIME" });
  });
  it.each([undefined, "0", "999999999"])(
    "Content-Length %s nao substitui o streaming real",
    async (length) => {
      const headers = new Headers({ "content-type": "image/png" });
      if (length !== undefined) headers.set("content-length", length);
      await expect(
        verifyPublicIdentityAsset(
          descriptor(),
          options({
            fetchImpl: async () =>
              publicResponse(png, urlFor(descriptor()), { headers }),
          }),
        ),
      ).resolves.toHaveProperty("asset.bytes", png.length);
    },
  );
  it("20MiB exatos sao lidos em chunks, copiados e conferidos", async () => {
    const bytes = new Uint8Array(20 * 1024 * 1024);
    bytes.set(png);
    const asset = descriptor(bytes);
    let offset = 0;
    const body = new ReadableStream({
      pull(c) {
        if (offset === bytes.length) {
          c.close();
          return;
        }
        c.enqueue(bytes.subarray(offset, offset + 1024 * 1024));
        offset += 1024 * 1024;
      },
    });
    await expect(
      verifyPublicIdentityAsset(
        asset,
        options({ fetchImpl: async () => publicResponse(body, urlFor(asset)) }),
      ),
    ).resolves.toHaveProperty("asset.bytes", bytes.length);
  });
  it("chunk reutilizado pelo transporte nao altera bytes ja lidos", async () => {
    const part = png.slice(0, 5);
    let count = 0;
    const body = new ReadableStream(
      {
        pull(c) {
          if (count === 0) c.enqueue(part);
          else if (count === 1) {
            part.set(png.subarray(5));
            c.enqueue(part);
          } else c.close();
          count++;
        },
      },
      { highWaterMark: 0 },
    );
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl: async () => publicResponse(body) }),
      ),
    ).resolves.toHaveProperty("asset.sha256", descriptor().sha256);
  });
  it.each([
    null,
    undefined,
    {},
    { signal: null },
    { signal: {} },
    { isCurrent: null },
    { fetchImpl: null },
    { timeoutMs: null },
    { timeoutMs: 0 },
    { timeoutMs: 1.5 },
    { timeoutMs: 120001 },
  ])("opcoes invalidas %# falham antes da rede", async (patch) => {
    const fetchImpl = vi.fn();
    const value =
      patch == null || Object.keys(patch).length === 0
        ? patch
        : { ...options({ fetchImpl }), ...patch };
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        value as VerifyPublicIdentityAssetOptions,
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("origem invalida e descritor adulterado falham sem rede", async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl, supabaseUrl: "https://evil.example" }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ORIGIN" });
    await expect(
      verifyPublicIdentityAsset(
        { ...descriptor(), bytes: 0 },
        options({ fetchImpl }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("captura descritor e todas as opcoes antes da espera", async () => {
    const asset = { ...descriptor() };
    const headers = deferred<Response>();
    const opts = { ...options({ fetchImpl: async () => headers.promise }) };
    const result = verifyPublicIdentityAsset(asset, opts);
    asset.bytes = 999;
    asset.path = "changed";
    opts.supabaseUrl = "https://evil.example";
    opts.timeoutMs = 1;
    opts.signal = AbortSignal.abort();
    opts.isCurrent = () => false;
    opts.fetchImpl = vi.fn();
    headers.resolve(publicResponse());
    await expect(result).resolves.toEqual({
      asset: descriptor(),
      url: urlFor(descriptor()),
    });
  });
  it.each(["canceled", "context", "throw", "truthy"])(
    "estado %s antes do fetch impede envio",
    async (kind) => {
      const controller = new AbortController();
      if (kind === "canceled") controller.abort("fictional-sensitive-marker");
      const fetchImpl = vi.fn();
      const isCurrent = () => {
        if (kind === "throw") throw new Error("fictional-sensitive-marker");
        return kind === "truthy"
          ? (1 as unknown as boolean)
          : kind === "canceled";
      };
      await expect(
        verifyPublicIdentityAsset(
          descriptor(),
          options({ fetchImpl, signal: controller.signal, isCurrent }),
        ),
      ).rejects.toMatchObject({
        code: kind === "canceled" ? "IDENTITY_CANCELED" : "IDENTITY_CONTEXT",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("guard que aborta sincronicamente impede fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn();
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          fetchImpl,
          signal: controller.signal,
          isCurrent: () => {
            controller.abort();
            return true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_CANCELED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("200 com tamanho e assinatura corretos mas bytes diferentes recusa HASH", async () => {
    const wrong = png.slice();
    wrong[9] ^= 1;
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl: async () => publicResponse(wrong) }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ASSET_HASH" });
  });
  it.each(["headers", "read", "digest"] as const)(
    "contexto muda durante %s",
    async (phase) => {
      const entered = deferred<void>();
      const headers = deferred<Response>();
      const digest = deferred<ArrayBuffer>();
      let current = true;
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      const cancel = vi.fn();
      const response = publicResponse(
        new ReadableStream<Uint8Array>(
          {
            start(c) {
              streamController = c;
            },
            pull() {
              if (phase === "read") entered.resolve();
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      );
      if (phase === "digest")
        vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
          entered.resolve();
          return digest.promise;
        });
      const fetchImpl: typeof fetch = async () => {
        if (phase === "headers") {
          entered.resolve();
          return headers.promise;
        }
        return phase === "read" ? response : publicResponse();
      };
      const result = verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl, isCurrent: () => current }),
      );
      const rejected = expect(result).rejects.toMatchObject({
        code: "IDENTITY_CONTEXT",
      });
      await entered.promise;
      current = false;
      if (phase === "headers") headers.resolve(response);
      if (phase === "read") {
        streamController.enqueue(png);
        streamController.close();
      }
      if (phase === "digest")
        digest.resolve(
          new Uint8Array(createHash("sha256").update(png).digest()).buffer,
        );
      await rejected;
      if (phase === "headers") expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ["headers", "cancel"],
    ["read", "cancel"],
    ["digest", "cancel"],
    ["headers", "timeout"],
    ["read", "timeout"],
    ["digest", "timeout"],
  ] as const)(
    "%s interrompido por %s nao espera transporte nativo",
    async (phase, reason) => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "performance"],
      });
      const entered = deferred<void>();
      const headers = deferred<Response>();
      const digest = deferred<ArrayBuffer>();
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const response = publicResponse(
        new ReadableStream(
          {
            pull() {
              entered.resolve();
              return new Promise<void>(() => {});
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      );
      if (phase === "digest")
        vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
          entered.resolve();
          return digest.promise;
        });
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      let internal: AbortSignal | null | undefined;
      const fetchImpl: typeof fetch = async (_url, init) => {
        internal = init?.signal;
        if (phase === "headers") {
          entered.resolve();
          return headers.promise;
        }
        return phase === "read" ? response : publicResponse();
      };
      const result = verifyPublicIdentityAsset(
        descriptor(),
        options({ fetchImpl, signal: controller.signal, timeoutMs: 50 }),
      );
      const rejected = expect(result).rejects.toMatchObject({
        code: reason === "cancel" ? "IDENTITY_CANCELED" : "IDENTITY_TIMEOUT",
      });
      await entered.promise;
      if (reason === "cancel") controller.abort("fictional-sensitive-marker");
      else await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(internal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
      if (phase === "read") expect(cancel).toHaveBeenCalledOnce();
      if (phase === "headers") {
        headers.resolve(response);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(cancel).toHaveBeenCalledOnce();
      }
      if (phase === "digest")
        digest.reject(new Error("fictional-sensitive-marker"));
    },
  );
  it.each(["cancel", "timeout"] as const)(
    "rejeicao tardia de fetch depois de %s e observada",
    async (reason) => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "performance"],
      });
      const pending = deferred<Response>();
      const controller = new AbortController();
      const result = verifyPublicIdentityAsset(
        descriptor(),
        options({
          signal: controller.signal,
          timeoutMs: 10,
          fetchImpl: async () => pending.promise,
        }),
      );
      const rejected = expect(result).rejects.toMatchObject({
        code: reason === "cancel" ? "IDENTITY_CANCELED" : "IDENTITY_TIMEOUT",
      });
      if (reason === "cancel") controller.abort();
      else await vi.advanceTimersByTimeAsync(10);
      await rejected;
      pending.reject(new Error("fictional-sensitive-marker"));
      await Promise.resolve();
      await Promise.resolve();
    },
  );
  it("fetch rejeitado com contexto perdido prevalece sobre diagnostico nativo", async () => {
    let current = true;
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          isCurrent: () => current,
          fetchImpl: async () => {
            current = false;
            throw new Error("fictional-sensitive-marker");
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "IDENTITY_CONTEXT",
      message: "IDENTITY_CONTEXT",
    });
  });
  it("erro classificado pelo transporte tambem vira FETCH sem propagar mensagem", async () => {
    const transportError = new IdentityError("IDENTITY_PERMISSION");
    transportError.message = "fictional-sensitive-marker";
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          fetchImpl: async () => {
            throw transportError;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "IDENTITY_FETCH",
      message: "IDENTITY_FETCH",
    });
  });
  it("fetch rejeitado conserva erro fixo sem marker sensivel", async () => {
    const result = verifyPublicIdentityAsset(
      descriptor(),
      options({
        fetchImpl: async () => {
          throw new Error("fictional-sensitive-marker");
        },
      }),
    ).catch((error: unknown) => error);
    expect(await result).toMatchObject({
      code: "IDENTITY_FETCH",
      message: "IDENTITY_FETCH",
    });
    expect(JSON.stringify(await result)).not.toContain(
      "fictional-sensitive-marker",
    );
    expect(await result).not.toHaveProperty("cause");
  });
  it("prazo expirado pelo guard impede envio mesmo antes de timer rodar", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fetchImpl = vi.fn();
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          fetchImpl,
          timeoutMs: 10,
          isCurrent: () => {
            now = 10;
            return true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_TIMEOUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("ultimo guard pode abortar durante digest concluido", async () => {
    let digestFinished = false;
    let checksAfterDigest = 0;
    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      const result = await realDigest(...args);
      digestFinished = true;
      return result;
    });
    const controller = new AbortController();
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          signal: controller.signal,
          isCurrent: () => {
            if (digestFinished && ++checksAfterDigest === 2) controller.abort();
            return true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_CANCELED" });
  });
  it("cancelamento na microtask entre conclusao interna e retorno publico prevalece", async () => {
    let digestFinished = false;
    let checksAfterDigest = 0;
    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
      const result = await realDigest(...args);
      digestFinished = true;
      return result;
    });
    const controller = new AbortController();
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({
          signal: controller.signal,
          isCurrent: () => {
            if (digestFinished && ++checksAfterDigest === 2)
              queueMicrotask(() => controller.abort());
            return true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_CANCELED" });
  });
  it("limpa timer e listener tambem no sucesso", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(
      verifyPublicIdentityAsset(
        descriptor(),
        options({ signal: controller.signal }),
      ),
    ).resolves.toHaveProperty("url");
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
  });
  it("cancelamento durante digest tardio nunca confirma o arquivo", async () => {
    const digest = deferred<ArrayBuffer>();
    const entered = deferred<void>();
    vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
      entered.resolve();
      return digest.promise;
    });
    const controller = new AbortController();
    const result = verifyPublicIdentityAsset(
      descriptor(),
      options({ signal: controller.signal }),
    );
    const rejected = expect(result).rejects.toMatchObject({
      code: "IDENTITY_CANCELED",
      message: "IDENTITY_CANCELED",
    });
    await entered.promise;
    controller.abort("fictional-sensitive-marker");
    await rejected;
    digest.resolve(
      new Uint8Array(createHash("sha256").update(png).digest()).buffer,
    );
  });
});
