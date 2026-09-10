import {
  IdentityAdminError,
  readAdminStoreIdentity,
  saveAdminStoreIdentity,
} from "@/lib/adminStoreIdentity";
import type { IdentityAdminOptions } from "@/lib/adminStoreIdentity";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://abcdefghijklmnopqrst.supabase.co";
const publicKey = "sb_publishable_fixture";
const userId = "fixture-admin";
const token = "fixture-access-token";
const raw = () => ({
  store_name: " Antiga ",
  store_city: null,
  store_state: "MG",
  primary_color: "#000000",
  secondary_color: null,
  accent_color: null,
  logo_url: null,
  branding_assets: { legacy: [null, "original"] },
});
const intent = () => ({
  expected: { revision: "9007199254740993", identity: raw() },
  desired: { ...raw(), store_name: "Nova", primary_color: "#112233" },
});
const snapshot = () => ({
  revision: "9223372036854775807",
  identity: intent().desired,
});
function responseAt(url: string, data: unknown, status = 200) {
  const response = new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}
function options(
  patch: Partial<IdentityAdminOptions> = {},
): IdentityAdminOptions {
  return {
    supabaseUrl: origin,
    publicKey,
    userId,
    authorize: async () => ({ userId, accessToken: token }),
    isCurrent: () => true,
    signal: new AbortController().signal,
    fetchImpl: async (input) => responseAt(String(input), snapshot()),
    ...patch,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("identidade administrativa com SDK real", () => {
  it.each(["before", "after"])(
    "tempo consumido pela guarda %s do envio prevalece",
    async (mode) => {
      let clock = 0;
      let authorized = false;
      let sent = false;
      vi.spyOn(performance, "now").mockImplementation(() => clock);
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        sent = true;
        return responseAt(String(input), snapshot());
      });
      const result = saveAdminStoreIdentity(
        intent(),
        options({
          timeoutMs: 30,
          fetchImpl,
          authorize: async () => {
            authorized = true;
            return { userId, accessToken: token };
          },
          isCurrent: () => {
            if (mode === "before" ? authorized : sent) clock = 31;
            return true;
          },
        }),
      );
      if (mode === "before") {
        await expect(result).rejects.toMatchObject({
          code: "IDENTITY_ADMIN_TIMEOUT",
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      } else {
        expect(await result).toEqual({ status: "pending", reason: "timeout" });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    },
  );
  it("mutacao durante streaming nao muda a intencao nem o resultado", async () => {
    const f = intent();
    const original = structuredClone(f);
    const started = deferred<void>();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot()));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            controller.enqueue(bytes.slice(0, 10));
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
      Object.defineProperty(response, "url", { value: String(input) });
      started.resolve();
      return response;
    });
    const result = saveAdminStoreIdentity(f, options({ fetchImpl }));
    await started.promise;
    f.desired.store_name = "Mutada durante leitura";
    f.expected.revision = "1";
    stream.enqueue(bytes.slice(10));
    stream.close();
    expect(await result).toEqual({
      status: "confirmed",
      source: "response",
      snapshot: { ...snapshot(), identity: original.desired },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("erro externo adulterado nunca assume origem de erro privado", async () => {
    const external = new IdentityAdminError("IDENTITY_ADMIN_ORIGIN");
    external.message = "fictional-sensitive-marker";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("save_store_identity")) throw external;
      return responseAt(String(input), snapshot());
    });
    expect(
      await saveAdminStoreIdentity(intent(), options({ fetchImpl })),
    ).toMatchObject({ status: "confirmed", source: "readback" });
    const error = await readAdminStoreIdentity(
      options({
        fetchImpl: async () => {
          throw external;
        },
      }),
    ).catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "IDENTITY_ADMIN_NETWORK",
      message: "IDENTITY_ADMIN_NETWORK",
    });
    expect(error).not.toBe(external);
  });
  it.each(["read", "save"])(
    "cancelamento na entrega publica de %s ainda prevalece",
    async (mode) => {
      // Single-chunk SDK fixture: check 13 follows the inner race. Cancellation
      // queues before the public async continuation, the regression reproduced in RED.
      const run = (opts: IdentityAdminOptions) =>
        mode === "read"
          ? readAdminStoreIdentity(opts)
          : saveAdminStoreIdentity(intent(), opts);
      const controller = new AbortController();
      let calls = 0;
      const result = run(
        options({
          signal: controller.signal,
          isCurrent: () => {
            if (++calls === 13) queueMicrotask(() => controller.abort());
            return true;
          },
        }),
      );
      if (mode === "read")
        await expect(result).rejects.toMatchObject({
          code: "IDENTITY_ADMIN_CANCELED",
        });
      else
        expect(await result).toEqual({ status: "pending", reason: "canceled" });
    },
  );
  it("le fotografia bruta, revisao textual e transporte restrito", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseAt(String(input), snapshot()),
    );
    const result = await readAdminStoreIdentity(options({ fetchImpl }));
    expect(result).toEqual(snapshot());
    expect(Object.isFrozen(result.identity.branding_assets?.legacy)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${origin}/rest/v1/rpc/read_store_identity`);
    expect(init).toMatchObject({
      method: "POST",
      body: "{}",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({
      apikey: publicKey,
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
      "content-profile": "public",
    });
  });
  it("salva uma vez os oito campos e a revisao exata", async () => {
    const f = intent();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseAt(String(input), snapshot()),
    );
    const result = await saveAdminStoreIdentity(f, options({ fetchImpl }));
    expect(result).toEqual({
      status: "confirmed",
      source: "response",
      snapshot: snapshot(),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        String(
          (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body,
        ),
      ),
    ).toEqual({
      expected_revision: f.expected.revision,
      expected_identity: f.expected.identity,
      desired_identity: f.desired,
    });
    expect(Object.isFrozen(f.expected.identity)).toBe(false);
  });
  it("resposta perdida confirma estado por uma releitura sem reautorizar ou reescrever", async () => {
    const authorize = vi.fn(async () => ({ userId, accessToken: token }));
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${token}`,
        );
        if (String(input).endsWith("save_store_identity"))
          throw new Error("fictional-sensitive-marker");
        return responseAt(String(input), { ...snapshot(), revision: "1" });
      },
    );
    expect(
      await saveAdminStoreIdentity(intent(), options({ authorize, fetchImpl })),
    ).toEqual({
      status: "confirmed",
      source: "readback",
      snapshot: { ...snapshot(), revision: "1" },
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(
      fetchImpl.mock.calls.map(([url]) => String(url).split("/").at(-1)),
    ).toEqual(["save_store_identity", "read_store_identity"]);
  });
  it.each(["different", "unavailable"])(
    "resposta perdida e releitura %s preservam conflito ou pendencia",
    async (mode) => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        if (
          String(input).endsWith("save_store_identity") ||
          mode === "unavailable"
        )
          throw new Error("fictional-marker");
        return responseAt(String(input), intent().expected);
      });
      expect(
        await saveAdminStoreIdentity(intent(), options({ fetchImpl })),
      ).toEqual(
        mode === "different"
          ? {
              status: "conflict",
              source: "readback",
              current: intent().expected,
            }
          : { status: "pending", reason: "unconfirmed" },
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    [
      400,
      "P0001",
      "IDENTITY_CONFLICT",
      { status: "conflict", source: "server" },
    ],
    [400, "22023", "IDENTITY_INVALID", { status: "rejected", code: "invalid" }],
    [400, "23514", "IDENTITY_INVALID", { status: "rejected", code: "invalid" }],
    [
      401,
      "42501",
      "IDENTITY_PERMISSION",
      { status: "rejected", code: "permission" },
    ],
    [
      403,
      "42501",
      "IDENTITY_PERMISSION",
      { status: "rejected", code: "permission" },
    ],
    [500, "P0002", "IDENTITY_MISSING", { status: "rejected", code: "missing" }],
    [
      400,
      "P0001",
      "IDENTITY_WRITE_UNCONFIRMED",
      { status: "rejected", code: "write-rejected" },
    ],
    [
      404,
      "PGRST202",
      "variable-marker",
      { status: "rejected", code: "unavailable" },
    ],
    [
      401,
      "PGRST301",
      "variable-marker",
      { status: "rejected", code: "session" },
    ],
    [
      401,
      "PGRST302",
      "variable-marker",
      { status: "rejected", code: "session" },
    ],
    [
      401,
      "PGRST303",
      "variable-marker",
      { status: "rejected", code: "session" },
    ],
  ])(
    "classifica somente resposta SQL recebida %s %s",
    async (status, code, message, expected) => {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        responseAt(
          String(input),
          { code, message, details: "secret-marker", hint: "secret-marker" },
          Number(status),
        ),
      );
      expect(
        await saveAdminStoreIdentity(intent(), options({ fetchImpl })),
      ).toEqual(expected);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [500, "P0001", "IDENTITY_CONFLICT"],
    [400, "P0002", "IDENTITY_MISSING"],
    [400, "P0001", "IDENTITY_PERMISSION"],
    [403, "42501", "other"],
    [200, "P0001", "IDENTITY_CONFLICT"],
    [404, "PGRST301", "other"],
  ])("pares falsos %s %s pedem releitura", async (status, code, message) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("save_store_identity")
        ? responseAt(String(input), { code, message }, status)
        : responseAt(String(input), snapshot()),
    );
    expect(
      await saveAdminStoreIdentity(intent(), options({ fetchImpl })),
    ).toMatchObject({ status: "confirmed", source: "readback" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    null,
    [],
    {},
    { ...snapshot(), extra: true },
    { revision: 9007199254740992, identity: raw() },
  ])("recusa envelope malformado %# sem nova leitura", async (data) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseAt(String(input), data),
    );
    await expect(
      readAdminStoreIdentity(options({ fetchImpl })),
    ).rejects.toMatchObject({
      code: "IDENTITY_ADMIN_PROTOCOL",
      message: "IDENTITY_ADMIN_PROTOCOL",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["", " secret ", "sb_secret_fixture", "x".repeat(8193)])(
    "recusa chave invalida %# antes de autorizar",
    async (key) => {
      const authorize = vi.fn();
      const fetchImpl = vi.fn();
      await expect(
        readAdminStoreIdentity(
          options({ publicKey: key, authorize, fetchImpl }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_KEY" });
      expect(authorize).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it.each(["", " user", "user ", "u".repeat(129)])(
    "recusa usuario invalido %#",
    async (value) => {
      await expect(
        readAdminStoreIdentity(options({ userId: value })),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_INVALID" });
    },
  );
  it.each([0, 1.5, 120001, Number.NaN])(
    "recusa prazo invalido %s",
    async (timeoutMs) => {
      await expect(
        readAdminStoreIdentity(options({ timeoutMs })),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_INVALID" });
    },
  );
  it.each(["https://evil.example", `${origin}/rest/v1`, `${origin}?x=1`])(
    "recusa origem %s",
    async (supabaseUrl) => {
      await expect(
        readAdminStoreIdentity(options({ supabaseUrl })),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_ORIGIN" });
    },
  );
  it.each(["", " token", "token\n", "t".repeat(16385)])(
    "recusa token invalido %#",
    async (accessToken) => {
      const fetchImpl = vi.fn();
      await expect(
        saveAdminStoreIdentity(
          intent(),
          options({
            authorize: async () => ({ userId, accessToken }),
            fetchImpl,
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_SESSION" });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("captura rascunho e opcoes antes de aguardar autorizacao", async () => {
    const auth = deferred<{ userId: string; accessToken: string }>();
    const f = intent();
    const before = structuredClone(f);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      responseAt(String(input), snapshot()),
    );
    const mutable = {
      ...options({ authorize: () => auth.promise, fetchImpl }),
    };
    const pending = saveAdminStoreIdentity(f, mutable);
    f.expected.identity.store_name = "Mutada";
    f.desired.branding_assets.legacy.push("Mutada");
    mutable.supabaseUrl = "https://evil.example";
    mutable.publicKey = "secret";
    auth.resolve({ userId, accessToken: token });
    expect(await pending).toMatchObject({ status: "confirmed" });
    expect(
      JSON.parse(
        String(
          (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body,
        ),
      ),
    ).toEqual({
      expected_revision: before.expected.revision,
      expected_identity: before.expected.identity,
      desired_identity: before.desired,
    });
  });
  it.each(["false", "throw", "cancel"])(
    "guarda %s impede envio apos autorizacao",
    async (mode) => {
      const controller = new AbortController();
      let authorized = false;
      const fetchImpl = vi.fn();
      const isCurrent = () => {
        if (!authorized) return true;
        if (mode === "throw") throw new Error("secret-marker");
        if (mode === "cancel") controller.abort();
        return mode === "cancel";
      };
      await expect(
        saveAdminStoreIdentity(
          intent(),
          options({
            signal: controller.signal,
            isCurrent,
            fetchImpl,
            authorize: async () => {
              authorized = true;
              return { userId, accessToken: token };
            },
          }),
        ),
      ).rejects.toMatchObject({
        code:
          mode === "cancel"
            ? "IDENTITY_ADMIN_CANCELED"
            : "IDENTITY_ADMIN_CONTEXT",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it.each(["cancel", "context", "timeout"])(
    "depois do envio %s e pendencia, mesmo com fetch pendurado",
    async (mode) => {
      const controller = new AbortController();
      let current = true;
      const fetchImpl = vi.fn(async () => {
        if (mode === "cancel") controller.abort();
        if (mode === "context") {
          current = false;
          throw new Error("marker");
        }
        return new Promise<Response>(() => {});
      });
      expect(
        await saveAdminStoreIdentity(
          intent(),
          options({
            signal: controller.signal,
            isCurrent: () => current,
            fetchImpl,
            timeoutMs: 15,
          }),
        ),
      ).toEqual({
        status: "pending",
        reason: mode === "cancel" ? "canceled" : mode,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["authorize", "fetch", "read"])(
    "prazo total termina %s que ignora sinal",
    async (mode) => {
      const never = new Promise<never>(() => {});
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
        mode === "read"
          ? Object.assign(
              new Response(new ReadableStream({ pull: () => never })),
              {},
            )
          : never,
      );
      if (mode === "read")
        fetchImpl.mockImplementation(async (input) => {
          const response = new Response(
            new ReadableStream({ pull: () => never }),
            { headers: { "content-type": "application/json" } },
          );
          Object.defineProperty(response, "url", { value: String(input) });
          return response;
        });
      await expect(
        readAdminStoreIdentity(
          options({
            timeoutMs: 15,
            fetchImpl,
            ...(mode === "authorize" ? { authorize: () => never } : {}),
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_TIMEOUT" });
    },
  );
  it("SDK nao persiste sessao, abre WebSocket, usa fetch global ou imprime erro externo", async () => {
    const storage = ["getItem", "setItem", "removeItem", "clear", "key"].map(
      (method) => vi.spyOn(Storage.prototype, method as "getItem"),
    );
    const socket = vi.fn(() => {
      throw new Error("SOCKET_TRAP");
    });
    const trap = vi.fn(() => {
      throw new Error("NETWORK_TRAP");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("WebSocket", socket);
    vi.stubGlobal("fetch", trap);
    await readAdminStoreIdentity(options());
    await saveAdminStoreIdentity(intent(), options());
    await expect(
      readAdminStoreIdentity(
        options({
          authorize: async () => {
            throw new Error("fictional-sensitive-marker");
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_SESSION" });
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it.each([
    ["noop", "9007199254740993", "response"],
    ["noop", "9007199254740994", "readback"],
    ["change", "9007199254740993", "readback"],
    ["change", "1", "response"],
  ])(
    "%s com revisao %s exige a confirmacao correta",
    async (mode, revision, source) => {
      const f = intent();
      if (mode === "noop") f.desired = f.expected.identity;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        responseAt(String(input), { revision, identity: f.desired }),
      );
      expect(
        await saveAdminStoreIdentity(f, options({ fetchImpl })),
      ).toMatchObject({ status: "confirmed", source });
      expect(fetchImpl).toHaveBeenCalledTimes(source === "response" ? 1 : 2);
    },
  );
  it("duas invocacoes nao atualizam expected para promover intencao antiga", async () => {
    const bodies: unknown[] = [];
    const f = intent();
    let attempt = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return ++attempt === 1
        ? responseAt(String(input), snapshot())
        : responseAt(
            String(input),
            { code: "P0001", message: "IDENTITY_CONFLICT" },
            400,
          );
    };
    expect(
      await saveAdminStoreIdentity(f, options({ fetchImpl })),
    ).toMatchObject({ status: "confirmed" });
    expect(await saveAdminStoreIdentity(f, options({ fetchImpl }))).toEqual({
      status: "conflict",
      source: "server",
    });
    expect(bodies[0]).toEqual(bodies[1]);
    expect(f.expected.revision).toBe("9007199254740993");
  });
  it.each([
    [400, "22023", "IDENTITY_INVALID", "IDENTITY_ADMIN_INVALID"],
    [403, "42501", "IDENTITY_PERMISSION", "IDENTITY_ADMIN_PERMISSION"],
    [500, "P0002", "IDENTITY_MISSING", "IDENTITY_ADMIN_MISSING"],
    [404, "PGRST202", "variable", "IDENTITY_ADMIN_UNAVAILABLE"],
    [401, "PGRST301", "variable", "IDENTITY_ADMIN_SESSION"],
    [500, "unknown", "secret", "IDENTITY_ADMIN_PROTOCOL"],
  ])(
    "leitura mapeia somente %s %s para %s",
    async (status, code, message, expectedCode) => {
      await expect(
        readAdminStoreIdentity(
          options({
            fetchImpl: async (input) =>
              responseAt(String(input), { code, message }, status),
          }),
        ),
      ).rejects.toMatchObject({ code: expectedCode, message: expectedCode });
    },
  );
  it.each([
    "",
    "https://evil.example/rpc",
    `${origin}/rest/v1/rpc/save_store_identity?x=1`,
  ])("origem recebida %s nao inicia recuperacao", async (url) => {
    const fetchImpl = vi.fn(async () => responseAt(url, snapshot()));
    expect(
      await saveAdminStoreIdentity(intent(), options({ fetchImpl })),
    ).toEqual({ status: "pending", reason: "origin" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("redirected mesmo com URL igual e recusado", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const response = responseAt(String(input), snapshot());
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    await expect(
      readAdminStoreIdentity(options({ fetchImpl })),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_ORIGIN" });
  });
  it.each(["text/plain", "application/problem+json", ""])(
    "MIME %s nao e JSON da RPC",
    async (mime) => {
      await expect(
        readAdminStoreIdentity(
          options({
            fetchImpl: async (input) => {
              const response = responseAt(String(input), snapshot());
              response.headers.set("content-type", mime);
              return response;
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_PROTOCOL" });
    },
  );
  it.each([
    new Uint8Array([0xc3, 0x28]),
    new TextEncoder().encode('{"revision":'),
  ])("UTF8 ou JSON truncado %# nao confirma", async (body) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const response = new Response(body, {
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    });
    expect(
      await saveAdminStoreIdentity(intent(), options({ fetchImpl })),
    ).toEqual({ status: "pending", reason: "unconfirmed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([1048576, 1048577])(
    "conta bytes reais %i mesmo com Content-Length falso",
    async (length) => {
      const body = JSON.stringify(snapshot()).padEnd(length, " ");
      const fetchImpl: typeof fetch = async (input) => {
        const response = new Response(body, {
          headers: {
            "content-type": "application/json",
            "content-length": "1",
          },
        });
        Object.defineProperty(response, "url", { value: String(input) });
        return response;
      };
      if (length === 1048576)
        expect(await readAdminStoreIdentity(options({ fetchImpl }))).toEqual(
          snapshot(),
        );
      else
        await expect(
          readAdminStoreIdentity(options({ fetchImpl })),
        ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_PROTOCOL" });
    },
  );
  it.each([262144, 262145])(
    "limita cada identidade compacta a %i bytes antes de enviar",
    async (length) => {
      const f = intent();
      f.desired.store_name = "";
      f.desired.store_name = "x".repeat(
        length - new TextEncoder().encode(JSON.stringify(f.desired)).length,
      );
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        responseAt(String(input), { ...snapshot(), identity: f.desired }),
      );
      if (length === 262144)
        expect(
          await saveAdminStoreIdentity(f, options({ fetchImpl })),
        ).toMatchObject({ status: "confirmed" });
      else {
        await expect(
          saveAdminStoreIdentity(f, options({ fetchImpl })),
        ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_INVALID" });
        expect(fetchImpl).not.toHaveBeenCalled();
      }
    },
  );
  it("limite de identidade mede UTF8 e tambem expected", async () => {
    const f = intent();
    f.expected.identity.store_name = "😀".repeat(66000);
    const fetchImpl = vi.fn();
    await expect(
      saveAdminStoreIdentity(f, options({ fetchImpl })),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("preserva chaves JSON __proto__ e constructor sem poluir objetos", async () => {
    const f = intent();
    f.desired.branding_assets = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"a":1},"legacy":[null]}',
    );
    let body: unknown;
    const result = await saveAdminStoreIdentity(
      f,
      options({
        fetchImpl: async (input, init) => {
          body = JSON.parse(String(init?.body));
          return responseAt(String(input), {
            ...snapshot(),
            identity: f.desired,
          });
        },
      }),
    );
    expect(result).toMatchObject({ status: "confirmed" });
    expect(JSON.stringify(body)).toContain('"__proto__":{"polluted":true}');
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
  it.each(["getReader", "read"])(
    "erro externo de %s com classe publica e normalizado",
    async (mode) => {
      const external = new IdentityAdminError("IDENTITY_ADMIN_ORIGIN");
      external.message = "fictional-sensitive-marker";
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (mode === "read") controller.error(external);
          },
        });
        const response = new Response(stream, {
          headers: { "content-type": "application/json" },
        });
        Object.defineProperty(response, "url", { value: String(input) });
        if (mode === "getReader")
          Object.defineProperty(stream, "getReader", {
            value: () => {
              throw external;
            },
          });
        return response;
      });
      const error = await readAdminStoreIdentity(options({ fetchImpl })).catch(
        (value: unknown) => value,
      );
      expect(error).not.toBe(external);
      expect(error).toMatchObject({
        code: "IDENTITY_ADMIN_NETWORK",
        message: "IDENTITY_ADMIN_NETWORK",
      });
    },
  );
  it("corpo tardio e descartado sem aguardar cancelamento pendurado", async () => {
    const later = deferred<Response>();
    const started = deferred<void>();
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      started.resolve();
      return later.promise;
    });
    const result = saveAdminStoreIdentity(
      intent(),
      options({ fetchImpl, signal: controller.signal }),
    );
    await started.promise;
    controller.abort();
    expect(await result).toEqual({ status: "pending", reason: "canceled" });
    const cancel = vi.fn(() => new Promise<never>(() => {}));
    const response = new Response(
      new ReadableStream({ cancel }, { highWaterMark: 0 }),
    );
    later.resolve(response);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("resposta que conclui depois do cancelamento nao inicia releitura", async () => {
    const started = deferred<void>();
    const later = deferred<Response>();
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      started.resolve();
      return later.promise;
    });
    const result = saveAdminStoreIdentity(
      intent(),
      options({ fetchImpl, signal: controller.signal }),
    );
    await started.promise;
    controller.abort();
    expect(await result).toEqual({ status: "pending", reason: "canceled" });
    later.resolve(
      responseAt(`${origin}/rest/v1/rpc/save_store_identity`, snapshot()),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("autorizacao tardia depois do cancelamento nunca chega ao SDK", async () => {
    const later = deferred<{ userId: string; accessToken: string }>();
    const controller = new AbortController();
    const fetchImpl = vi.fn();
    const result = saveAdminStoreIdentity(
      intent(),
      options({
        authorize: () => later.promise,
        signal: controller.signal,
        fetchImpl,
      }),
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({
      code: "IDENTITY_ADMIN_CANCELED",
    });
    later.resolve({ userId, accessToken: token });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["user", "getter", "throw"])(
    "autorizacao %s falha sem envio e sem diagnostico",
    async (mode) => {
      const fetchImpl = vi.fn();
      const authorize = async () => {
        if (mode === "throw")
          throw new IdentityAdminError("IDENTITY_ADMIN_ORIGIN");
        if (mode === "getter")
          return Object.defineProperty(
            { userId, accessToken: token },
            "accessToken",
            {
              get() {
                throw new Error("marker");
              },
            },
          );
        return { userId: "other", accessToken: token };
      };
      await expect(
        readAdminStoreIdentity(options({ authorize, fetchImpl })),
      ).rejects.toMatchObject({
        code: "IDENTITY_ADMIN_SESSION",
        message: "IDENTITY_ADMIN_SESSION",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("cancelamento anterior nao chama authorize", async () => {
    const controller = new AbortController();
    controller.abort();
    const authorize = vi.fn();
    await expect(
      readAdminStoreIdentity(options({ signal: controller.signal, authorize })),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_CANCELED" });
    expect(authorize).not.toHaveBeenCalled();
  });
  it("SDK com URL alterada nao envia nem redireciona", async () => {
    const original = URL.prototype.toString;
    vi.spyOn(URL.prototype, "toString").mockImplementation(function (
      this: URL,
    ) {
      const value = original.call(this);
      return value.includes("/rest/v1/rpc/") ? `${value}?injected=true` : value;
    });
    const fetchImpl = vi.fn();
    await expect(
      saveAdminStoreIdentity(intent(), options({ fetchImpl })),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_ORIGIN" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("SDK com serializacao alterada nao envia um corpo diferente", async () => {
    const original = JSON.stringify;
    let serializations = 0;
    vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
      const text = original(value, replacer, space);
      if (
        value &&
        typeof value === "object" &&
        "expected_revision" in value &&
        ++serializations === 2
      )
        return `${text} `;
      return text;
    });
    const fetchImpl = vi.fn();
    await expect(
      saveAdminStoreIdentity(intent(), options({ fetchImpl })),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_PROTOCOL" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("contexto ou cancelamento na ultima guarda sincrona impedem o transporte", async () => {
    const controller = new AbortController();
    let armed = false;
    const original = Headers.prototype.set;
    vi.spyOn(Headers.prototype, "set").mockImplementation(function (
      this: Headers,
      name,
      value,
    ) {
      if (name.toLowerCase() === "authorization") armed = true;
      original.call(this, name, value);
    });
    const fetchImpl = vi.fn();
    await expect(
      saveAdminStoreIdentity(
        intent(),
        options({
          signal: controller.signal,
          fetchImpl,
          isCurrent: () => {
            if (armed) controller.abort();
            return true;
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_ADMIN_CANCELED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
