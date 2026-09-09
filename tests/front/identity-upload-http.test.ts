import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type IdentityUploadAuthorization,
  type IdentityUploadHttpOptions,
  createIdentityUploadHttpStack,
} from "../../src/lib/identityUploadHttp";

const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const endpoint =
  "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable";
const uploadUrl = `${endpoint}/opaque_ID-123`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(overrides: Partial<IdentityUploadHttpOptions> = {}) {
  const controller = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
  const authorize = vi.fn(async () => ({
    userId: "u1",
    accessToken: "test-only-token",
  }));
  const options: IdentityUploadHttpOptions = {
    supabaseUrl: origin,
    userId: "u1",
    isCurrent: () => true,
    authorize,
    signal: controller.signal,
    fetchImpl,
    ...overrides,
  };
  return {
    controller,
    fetchImpl,
    authorize,
    options,
    stack: createIdentityUploadHttpStack(options),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("transporte de identidade restrito a origem e sessao", () => {
  it("cancelar durante credencial encerra sem esperar nem enviar depois", async () => {
    const auth = deferred<IdentityUploadAuthorization>();
    const f = fixture({ authorize: () => auth.promise });
    const pending = f.stack.createRequest("POST", endpoint).send();
    const rejected = expect(pending).rejects.toMatchObject({
      code: "IDENTITY_UPLOAD_CANCELED",
    });
    f.controller.abort();
    auth.resolve({ userId: "u1", accessToken: "test-only-token" });
    await rejected;
    await Promise.resolve();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("POST, PATCH e HEAD preservam Blob e renovam somente a credencial privada", async () => {
    const f = fixture();
    const raw = new Response("private-response", {
      status: 201,
      headers: {
        Location: uploadUrl,
        "Upload-Offset": "0",
        "Upload-Length": "3",
        "Tus-Resumable": "1.0.0",
        "Tus-Version": "1.0.0",
        "Tus-Extension": "creation",
        "Tus-Max-Size": "20971520",
        "Retry-After": "2",
        "Upload-Expires": "Wed, 09 Sep 2026 13:00:00 GMT",
        "Set-Cookie": "private-cookie",
        Authorization: "private-response-auth",
        "X-Private": "private-header",
      },
    });
    const cancel = vi.spyOn(raw.body!, "cancel");
    const read = vi.spyOn(raw, "text");
    f.fetchImpl.mockResolvedValueOnce(raw);
    const req = f.stack.createRequest("POST", endpoint);
    req.setHeader("tUs-ReSuMaBlE", "1.0.0");
    req.setHeader("Upload-Length", "3");
    req.setHeader("Upload-Metadata", "filename dGVzdA==");
    const progress = vi.fn();
    req.setProgressHandler(progress);
    const res = await req.send(null);
    expect(res.getStatus()).toBe(201);
    expect(res.getHeader("lOcAtIoN")).toBe(uploadUrl);
    for (const name of [
      "upload-offset",
      "upload-length",
      "tus-resumable",
      "tus-version",
      "tus-extension",
      "tus-max-size",
      "retry-after",
      "upload-expires",
    ])
      expect(res.getHeader(name)).toBe(raw.headers.get(name));
    for (const name of ["set-cookie", "authorization", "x-private"]) {
      expect(res.getHeader(name)).toBeUndefined();
      expect(req.getHeader(name)).toBeUndefined();
    }
    expect(res.getBody()).toBe("");
    expect(res.getUnderlyingObject()).toBeUndefined();
    expect(req.getUnderlyingObject()).toBeUndefined();
    expect(req.getHeader("TUS-RESUMABLE")).toBe("1.0.0");
    expect(cancel).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();

    const blob = new Blob([new Uint8Array([0, 127, 255])]);
    f.authorize.mockResolvedValueOnce({
      userId: "u1",
      accessToken: "test-only-refreshed",
    });
    const patch = f.stack.createRequest("PATCH", res.getHeader("Location")!);
    patch.setHeader("Content-Type", "application/offset+octet-stream");
    patch.setHeader("Upload-Offset", "0");
    patch.setProgressHandler(progress);
    await patch.send(blob);
    await f.stack.createRequest("HEAD", uploadUrl).send();
    expect(f.authorize).toHaveBeenCalledTimes(3);
    expect(
      f.fetchImpl.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      [endpoint, "POST"],
      [uploadUrl, "PATCH"],
      [uploadUrl, "HEAD"],
    ]);
    for (const [, init] of f.fetchImpl.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal).not.toBe(f.controller.signal);
    }
    const init = f.fetchImpl.mock.calls[1][1]!;
    expect(init.body).toBe(blob);
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer test-only-refreshed",
    );
    expect(progress).not.toHaveBeenCalled();
    expect(JSON.stringify([f.stack, req, res])).not.toContain("test-only");
  });

  it.each(["GET", "DELETE", "PUT", "OPTIONS", "post", " PATCH", ""])(
    "metodo %s nao chega a credencial ou rede",
    (method) => {
      const f = fixture();
      expect(() => f.stack.createRequest(method, endpoint)).toThrow(
        "IDENTITY_UPLOAD_INVALID",
      );
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );

  const badUrls = [
    `${endpoint}/`,
    `${endpoint}?x=1`,
    `${endpoint}#x`,
    endpoint.replace("https:", "http:"),
    endpoint.replace("https:", "HTTPS:"),
    endpoint.replace("storage.supabase.co", "supabase.co"),
    endpoint.replace("storage.supabase.co", "storage.supabase.co.evil.example"),
    endpoint.replace("https://", "https://u:p@"),
    endpoint.replace(".co/", ".co:443/"),
    endpoint.replace(".co/", ".co:8443/"),
    endpoint.replace("aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb"),
    endpoint.replace("aaaaaaaaaaaaaaaaaaaa", "AAAAAAAAAAAAAAAAAAAA"),
    endpoint.replace("/storage/", "/x/../storage/"),
    endpoint.replace("/storage/", "/%73torage/"),
    endpoint.replace("/storage/", "/storage\\"),
    ` ${endpoint}`,
    `${endpoint}\n`,
  ];
  it.each(badUrls)("recusa grafia alternativa no POST: %s", (url) => {
    const f = fixture();
    expect(() => f.stack.createRequest("POST", url)).toThrow(
      "IDENTITY_UPLOAD_ORIGIN",
    );
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "/",
    "a/b",
    ".",
    "..",
    "%41",
    "a.b",
    "a+b",
    "a=b",
    "a?x",
    "a#x",
    "é",
    "a\n",
    "a".repeat(2049),
  ])("recusa identificador opaco indevido: %s", (id) => {
    const f = fixture();
    for (const method of ["HEAD", "PATCH"]) {
      expect(() => f.stack.createRequest(method, `${endpoint}/${id}`)).toThrow(
        "IDENTITY_UPLOAD_ORIGIN",
      );
      expect(() => f.stack.createRequest(method, endpoint)).toThrow(
        "IDENTITY_UPLOAD_ORIGIN",
      );
    }
  });

  it("aceita identificador de 2048 caracteres e PATCH de 6 MiB, sem body em HEAD", async () => {
    const f = fixture();
    const blob = new Blob([new Uint8Array(6 * 1024 * 1024)]);
    await f.stack
      .createRequest("PATCH", `${endpoint}/${"A".repeat(2048)}`)
      .send(blob);
    expect(f.fetchImpl.mock.calls[0][1]?.body).toBe(blob);
    await expect(
      f.stack.createRequest("HEAD", uploadUrl).send(blob),
    ).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    "Authorization",
    "Cookie",
    "apikey",
    "x-upsert",
    "Upload-Concat",
    "Upload-Defer-Length",
    "X-HTTP-Method-Override",
    "X-Request-ID",
    "X-Other",
    "",
  ])("nao permite header %s", (header) => {
    const req = fixture().stack.createRequest("POST", endpoint);
    expect(() => req.setHeader(header, "test")).toThrow(
      "IDENTITY_UPLOAD_INVALID",
    );
    expect(req.getHeader(header)).toBeUndefined();
  });

  it.each(["ok\rInjected: true", "ok\nInjected: true"])(
    "recusa CR/LF em header: %s",
    (value) => {
      const req = fixture().stack.createRequest("POST", endpoint);
      expect(() => req.setHeader("Upload-Metadata", value)).toThrow(
        "IDENTITY_UPLOAD_INVALID",
      );
    },
  );

  it("sobrescrever header publico ignora caixa sem duplicar", async () => {
    const f = fixture();
    const req = f.stack.createRequest("POST", endpoint);
    req.setHeader("Upload-Length", "1");
    req.setHeader("UPLOAD-LENGTH", "2");
    await req.send();
    expect(
      new Headers(f.fetchImpl.mock.calls[0][1]?.headers).get("upload-length"),
    ).toBe("2");
  });

  it.each([
    undefined,
    null,
    "secret-body",
    new FormData(),
    new URLSearchParams("x=y"),
    new ArrayBuffer(1),
    new Blob([new Uint8Array(6 * 1024 * 1024 + 1)]),
  ])("PATCH recusa body que nao e parte Blob permitida (%#)", async (body) => {
    const f = fixture();
    await expect(
      f.stack.createRequest("PATCH", uploadUrl).send(body as Blob),
    ).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("POST recusa dados mesmo quando Blob e vazio", async () => {
    const f = fixture();
    await expect(
      f.stack.createRequest("POST", endpoint).send(new Blob()),
    ).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "/relative",
    "https://evil.example/id",
    endpoint,
    `${uploadUrl}?x=1`,
    `${uploadUrl}/`,
    "",
  ])("Location adulterado nunca e entregue: %s", async (location) => {
    const f = fixture();
    f.fetchImpl.mockResolvedValue(
      new Response(null, { status: 201, headers: { Location: location } }),
    );
    await expect(
      f.stack.createRequest("POST", endpoint).send(),
    ).rejects.toThrow("IDENTITY_UPLOAD_ORIGIN");
  });

  it.each([401, 403])(
    "HEAD %s rejeita sessao antes de fallback TUS",
    async (status) => {
      const f = fixture();
      f.fetchImpl.mockResolvedValue(new Response("private-error", { status }));
      await expect(
        f.stack.createRequest("HEAD", uploadUrl).send(),
      ).rejects.toMatchObject({
        code: "IDENTITY_UPLOAD_SESSION",
        message: "IDENTITY_UPLOAD_SESSION",
      });
    },
  );

  it.each([404, 409, 423, 500])(
    "status %s permanece disponivel sem corpo",
    async (status) => {
      const f = fixture();
      const raw = new Response("private-error", { status });
      const cancel = vi.spyOn(raw.body!, "cancel");
      f.fetchImpl.mockResolvedValue(raw);
      const res = await f.stack.createRequest("HEAD", uploadUrl).send();
      expect(res.getStatus()).toBe(status);
      expect(res.getBody()).toBe("");
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each(["redirect", "url"])(
    "resposta %s adulterada nao e aceita",
    async (kind) => {
      const f = fixture();
      const raw = new Response(null);
      Object.defineProperty(raw, kind === "redirect" ? "redirected" : "url", {
        value: kind === "redirect" ? true : "https://evil.example/",
      });
      f.fetchImpl.mockResolvedValue(raw);
      await expect(
        f.stack.createRequest("POST", endpoint).send(),
      ).rejects.toThrow("IDENTITY_UPLOAD_ORIGIN");
    },
  );

  it("URL de resposta exata e aceita", async () => {
    const f = fixture();
    const raw = new Response(null);
    Object.defineProperty(raw, "url", { value: endpoint });
    f.fetchImpl.mockResolvedValue(raw);
    await expect(
      f.stack.createRequest("POST", endpoint).send(),
    ).resolves.toBeDefined();
  });

  it.each(["request", "signal"])(
    "cancelar por %s antes de send impede rede",
    async (kind) => {
      const f = fixture();
      const req = f.stack.createRequest("POST", endpoint);
      if (kind === "request") await req.abort();
      else f.controller.abort();
      await expect(req.send()).rejects.toThrow("IDENTITY_UPLOAD_CANCELED");
      await req.abort();
      await req.abort();
      expect(f.authorize).not.toHaveBeenCalled();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("um pedido so admite send uma vez, mesmo com o primeiro pendente", async () => {
    const auth = deferred<IdentityUploadAuthorization>();
    const f = fixture({ authorize: () => auth.promise });
    const req = f.stack.createRequest("POST", endpoint);
    const pending = req.send();
    const second = req.send().catch((error: Error) => error.message);
    auth.resolve({ userId: "u1", accessToken: "test-only-token" });
    await pending;
    expect(await second).toBe("IDENTITY_UPLOAD_INVALID");
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    await expect(req.send()).rejects.toThrow("IDENTITY_UPLOAD_INVALID");
  });

  it.each(["authorize", "fetch"])(
    "prazo inclui espera de %s que ignora sinal",
    async (phase) => {
      vi.useFakeTimers();
      const auth = deferred<IdentityUploadAuthorization>();
      const network = deferred<Response>();
      const f = fixture({
        timeoutMs: 10,
        ...(phase === "authorize" ? { authorize: () => auth.promise } : {}),
      });
      f.fetchImpl.mockReturnValue(network.promise);
      let result = "pending";
      const pending = f.stack
        .createRequest("POST", endpoint)
        .send()
        .then(
          () => {
            result = "resolved";
          },
          (error) => {
            result = error.code;
          },
        );
      await vi.advanceTimersByTimeAsync(10);
      expect(result).toBe("IDENTITY_UPLOAD_TIMEOUT");
      if (phase === "fetch")
        expect(f.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
      auth.resolve({ userId: "u1", accessToken: "test-only-token" });
      if (phase === "fetch") network.reject(new Error("private-late-network"));
      await pending;
      await vi.advanceTimersByTimeAsync(0);
      expect(f.fetchImpl).toHaveBeenCalledTimes(phase === "authorize" ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["authorize", "fetch"])(
    "cancelar encerra %s pendente sem cooperacao",
    async (phase) => {
      vi.useFakeTimers();
      const auth = deferred<IdentityUploadAuthorization>();
      const network = deferred<Response>();
      const f = fixture({
        ...(phase === "authorize" ? { authorize: () => auth.promise } : {}),
      });
      f.fetchImpl.mockReturnValue(network.promise);
      let result = "pending";
      const req = f.stack.createRequest("POST", endpoint);
      const pending = req.send().then(
        () => {
          result = "resolved";
        },
        (error) => {
          result = error.code;
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      await req.abort();
      await req.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toBe("IDENTITY_UPLOAD_CANCELED");
      if (phase === "authorize") auth.reject(new Error("private-late-auth"));
      else network.reject(new Error("private-late-network"));
      await pending;
      await vi.advanceTimersByTimeAsync(0);
      expect(f.fetchImpl).toHaveBeenCalledTimes(phase === "authorize" ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cancelamento externo em voo aborta sinal e descarta corpo tardio", async () => {
    vi.useFakeTimers();
    const network = deferred<Response>();
    const f = fixture();
    f.fetchImpl.mockReturnValue(network.promise);
    const pending = f.stack.createRequest("POST", endpoint).send();
    const rejected = expect(pending).rejects.toThrow(
      "IDENTITY_UPLOAD_CANCELED",
    );
    await vi.advanceTimersByTimeAsync(0);
    f.controller.abort();
    await rejected;
    expect(f.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const raw = new Response("private-late-body");
    const cancel = vi.spyOn(raw.body!, "cancel");
    network.resolve(raw);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      f.stack.createRequest("HEAD", uploadUrl).send(),
    ).rejects.toThrow("IDENTITY_UPLOAD_CANCELED");
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(["before", "authorize", "response"])(
    "troca de sessao em %s impede resultado",
    async (phase) => {
      let current = phase !== "before";
      const f = fixture({ isCurrent: () => current });
      f.authorize.mockImplementation(async () => {
        if (phase === "authorize") current = false;
        return { userId: "u1", accessToken: "test-only-token" };
      });
      f.fetchImpl.mockImplementation(async () => {
        current = false;
        return new Response(null);
      });
      await expect(
        f.stack.createRequest("POST", endpoint).send(),
      ).rejects.toThrow("IDENTITY_UPLOAD_SESSION");
      expect(f.fetchImpl).toHaveBeenCalledTimes(phase === "response" ? 1 : 0);
      expect(f.authorize).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
    },
  );

  it.each(["isCurrent", "authorize"])(
    "excecao privada em %s vira SESSION fixo",
    async (callback) => {
      const f = fixture({
        [callback]: () => {
          throw new Error("private-callback-data");
        },
      });
      const error = await f.stack
        .createRequest("POST", endpoint)
        .send()
        .catch((error: Error) => error);
      expect(error).toMatchObject({ message: "IDENTITY_UPLOAD_SESSION" });
      expect((error as Error).cause).toBeUndefined();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    { userId: "u2", accessToken: "test-only-token" },
    { userId: "u1", accessToken: "" },
    { userId: "u1", accessToken: "bad\rvalue" },
    { userId: "u1", accessToken: "bad\nvalue" },
    null,
  ])("credencial inconsistente nao sai para rede (%#)", async (auth) => {
    const f = fixture({
      authorize: async () => auth as IdentityUploadAuthorization,
    });
    await expect(
      f.stack.createRequest("POST", endpoint).send(),
    ).rejects.toThrow("IDENTITY_UPLOAD_SESSION");
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejeicao privada do fetch vira NETWORK sem cause", async () => {
    const f = fixture();
    f.fetchImpl.mockRejectedValue(new Error("private-network-data"));
    const error = await f.stack
      .createRequest("POST", endpoint)
      .send()
      .catch((error: Error) => error);
    expect(error).toMatchObject({
      code: "IDENTITY_UPLOAD_NETWORK",
      message: "IDENTITY_UPLOAD_NETWORK",
    });
    expect((error as Error).cause).toBeUndefined();
  });

  it("mutar options depois da fabrica nao troca origem, usuario ou callbacks", async () => {
    const f = fixture();
    const replacement = vi.fn<typeof fetch>();
    Object.assign(f.options, {
      supabaseUrl: "https://bbbbbbbbbbbbbbbbbbbb.supabase.co",
      userId: "u2",
      isCurrent: () => false,
      authorize: async () => ({ userId: "u2", accessToken: "other-test-only" }),
      fetchImpl: replacement,
      signal: AbortSignal.abort(),
      timeoutMs: 0,
    });
    await f.stack.createRequest("POST", endpoint).send();
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, 120001])(
    "prazo invalido %s e recusado na fabrica",
    (timeoutMs) => {
      expect(() => fixture({ timeoutMs })).toThrow("IDENTITY_UPLOAD_INVALID");
    },
  );

  it.each(["", "u".repeat(129)])(
    "usuario vazio ou longo e recusado (%#)",
    (userId) => {
      expect(() => fixture({ userId })).toThrow("IDENTITY_UPLOAD_INVALID");
    },
  );

  it("origem da configuracao passa pelo contrato Supabase existente", () => {
    expect(() => fixture({ supabaseUrl: "https://evil.example" })).toThrow(
      "IDENTITY_UPLOAD_ORIGIN",
    );
  });

  it.each(["success", "network", "session"])(
    "encerra listener e timer em %s",
    async (outcome) => {
      vi.useFakeTimers();
      const f = fixture();
      const add = vi.spyOn(f.controller.signal, "addEventListener");
      const remove = vi.spyOn(f.controller.signal, "removeEventListener");
      if (outcome === "network")
        f.fetchImpl.mockRejectedValue(new Error("test-only"));
      if (outcome === "session")
        f.fetchImpl.mockResolvedValue(new Response(null, { status: 401 }));
      await f.stack
        .createRequest("POST", endpoint)
        .send()
        .catch(() => undefined);
      expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
        once: true,
      });
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
