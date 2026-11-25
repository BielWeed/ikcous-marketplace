import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type IdentityUploadHttpOptions,
  createIdentityUploadHttpStack,
} from "../../src/lib/identityUploadHttp";

// Bordas do transporte de envio da identidade (caça por mutação): limites
// exatos de conta e de prazo, prazo padrão de 30 s e credencial só com
// espaços. Fixtures inventadas.
const origin = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
const endpoint =
  "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/upload/resumable";

function montar(overrides: Partial<IdentityUploadHttpOptions> = {}) {
  const controller = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
  const authorize = vi.fn(async () => ({
    userId: "u1",
    accessToken: "token-de-teste",
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
  return { fetchImpl, authorize, options };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("transporte de envio: limites exatos da configuração", () => {
  it("aceita conta de 128 caracteres e recusa 129", () => {
    expect(() =>
      createIdentityUploadHttpStack(
        montar({ userId: "u".repeat(128) }).options,
      ),
    ).not.toThrow();
    expect(() =>
      createIdentityUploadHttpStack(
        montar({ userId: "u".repeat(129) }).options,
      ),
    ).toThrow("IDENTITY_UPLOAD_INVALID");
  });

  it.each(["   ", "\t", " \n "])(
    "recusa conta só com espaço em branco (%#)",
    (userId) => {
      expect(() =>
        createIdentityUploadHttpStack(montar({ userId }).options),
      ).toThrow("IDENTITY_UPLOAD_INVALID");
    },
  );

  it("aceita prazo de 1 ms e de 120000 ms, recusa 0 e 120001", () => {
    expect(() =>
      createIdentityUploadHttpStack(montar({ timeoutMs: 1 }).options),
    ).not.toThrow();
    expect(() =>
      createIdentityUploadHttpStack(montar({ timeoutMs: 120000 }).options),
    ).not.toThrow();
    expect(() =>
      createIdentityUploadHttpStack(montar({ timeoutMs: 0 }).options),
    ).toThrow("IDENTITY_UPLOAD_INVALID");
    expect(() =>
      createIdentityUploadHttpStack(montar({ timeoutMs: 120001 }).options),
    ).toThrow("IDENTITY_UPLOAD_INVALID");
  });
});

describe("transporte de envio: prazo padrão", () => {
  it("sem prazo informado, espera 30 s e só então dá TIMEOUT", async () => {
    vi.useFakeTimers();
    const m = montar();
    // A rede nunca responde.
    m.fetchImpl.mockReturnValue(new Promise<Response>(() => {}));
    const stack = createIdentityUploadHttpStack(m.options);
    let resultado = "pendente";
    const envio = stack
      .createRequest("POST", endpoint)
      .send()
      .then(
        () => {
          resultado = "respondeu";
        },
        (erro: { code: string }) => {
          resultado = erro.code;
        },
      );
    await vi.advanceTimersByTimeAsync(29999);
    expect(resultado).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    expect(resultado).toBe("IDENTITY_UPLOAD_TIMEOUT");
    await envio;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("transporte de envio: credencial só com espaços", () => {
  it.each([" ", "   ", "\t"])(
    "token em branco (%#) vira SESSION e nada sai para a rede",
    async (accessToken) => {
      const m = montar({
        authorize: async () => ({ userId: "u1", accessToken }),
      });
      const stack = createIdentityUploadHttpStack(m.options);
      await expect(
        stack.createRequest("POST", endpoint).send(),
      ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_SESSION" });
      expect(m.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("token vazio também é recusado e um token normal passa (controle)", async () => {
    const vazio = montar({
      authorize: async () => ({ userId: "u1", accessToken: "" }),
    });
    await expect(
      createIdentityUploadHttpStack(vazio.options)
        .createRequest("POST", endpoint)
        .send(),
    ).rejects.toMatchObject({ code: "IDENTITY_UPLOAD_SESSION" });
    expect(vazio.fetchImpl).not.toHaveBeenCalled();

    const bom = montar();
    await createIdentityUploadHttpStack(bom.options)
      .createRequest("POST", endpoint)
      .send();
    expect(bom.fetchImpl).toHaveBeenCalledOnce();
    expect(
      new Headers(bom.fetchImpl.mock.calls[0]?.[1]?.headers).get(
        "authorization",
      ),
    ).toBe("Bearer token-de-teste");
  });
});
