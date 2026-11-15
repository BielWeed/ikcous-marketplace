// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://falso.supabase.co/",
  lerChaveSupabase: () => "chave-publica-falsa",
}));
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  history.replaceState({ view: "auth", from: "checkout" }, "", "/auth");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});
it("settings usa a mesma URL e chave pública da loja e exige true booleano", async () => {
  const fetchFalso = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ external: { google: true } }),
  });
  vi.stubGlobal("fetch", fetchFalso);
  const { googleLigadoNestaLoja } = await import("@/lib/google-login");
  expect(await googleLigadoNestaLoja()).toBe(true);
  expect(await googleLigadoNestaLoja()).toBe(true);
  expect(fetchFalso).toHaveBeenCalledTimes(1);
  expect(fetchFalso).toHaveBeenCalledWith(
    "https://falso.supabase.co/auth/v1/settings",
    {
      headers: { apikey: "chave-publica-falsa" },
      signal: expect.any(AbortSignal),
    },
  );
});
it.each([
  { ok: false, json: async () => ({ external: { google: true } }) },
  { ok: true, json: async () => ({ external: { google: "true" } }) },
  { ok: true, json: async () => ({ external: {} }) },
  { ok: true, json: async () => null },
  {
    ok: true,
    json: async () => {
      throw new Error("json inválido");
    },
  },
])("não liga Google com resposta inválida (%j)", async (resposta) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta));
  const { googleLigadoNestaLoja } = await import("@/lib/google-login");
  expect(await googleLigadoNestaLoja()).toBe(false);
});
it.each(["fetch", "corpo"])(
  "prazo cobre %s pendurado, aborta e cacheia false",
  async (onde) => {
    vi.useFakeTimers();
    const pendente = new Promise(() => {});
    const fetchFalso = vi
      .fn()
      .mockReturnValue(
        onde === "fetch"
          ? pendente
          : Promise.resolve({ ok: true, json: () => pendente }),
      );
    vi.stubGlobal("fetch", fetchFalso);
    const { googleLigadoNestaLoja } = await import("@/lib/google-login");
    const resultado = googleLigadoNestaLoja();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await resultado).toBe(false);
    expect(fetchFalso.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await googleLigadoNestaLoja()).toBe(false);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "?error=access_denied&error_description=privado",
  "#error=access_denied&error_description=privado&error_code=provider_error",
])(
  "cancelar tem mensagem tranquila e limpa só os parâmetros de erro (%s)",
  async (erro) => {
    const { guardarDestinoGoogle, retomarDestinoGoogle } = await import(
      "@/lib/google-login"
    );
    expect(guardarDestinoGoogle()).toBe(`${location.origin}/auth`);
    history.replaceState(null, "", `/auth${erro}`);
    const retorno = retomarDestinoGoogle();
    expect(retorno.mensagem).toContain("cancelada");
    expect(retorno.checkout).toBe(true);
    expect(history.state.from).toBe("checkout");
    expect(location.href).not.toContain("error");
    expect(location.href).not.toContain("privado");
  },
);
it("sucesso preserva o hash que o SDK precisa para obter sessão", async () => {
  const { guardarDestinoGoogle, retomarDestinoGoogle } = await import(
    "@/lib/google-login"
  );
  guardarDestinoGoogle();
  history.replaceState(
    null,
    "",
    "/auth#access_token=falso&refresh_token=falso",
  );
  expect(retomarDestinoGoogle()).toMatchObject({
    iniciado: true,
    checkout: true,
    mensagem: null,
  });
  expect(location.hash).toContain("access_token=falso");
});
it("pedido com id sobrevive sem expor id no redirectTo", async () => {
  history.replaceState(
    { view: "auth", from: "order-details", id: "pedido-falso" },
    "",
    "/auth",
  );
  const { guardarDestinoGoogle, retomarDestinoGoogle } = await import(
    "@/lib/google-login"
  );
  expect(guardarDestinoGoogle()).not.toContain("pedido-falso");
  history.replaceState(null, "", "/auth");
  retomarDestinoGoogle();
  expect(history.state).toMatchObject({
    from: "order-details",
    id: "pedido-falso",
  });
});
it("destino adulterado não abre painel nem endereço externo", async () => {
  history.replaceState({ view: "auth", requested: "admin" }, "", "/auth");
  const { guardarDestinoGoogle, retomarDestinoGoogle } = await import(
    "@/lib/google-login"
  );
  guardarDestinoGoogle();
  history.replaceState(null, "", "/auth");
  retomarDestinoGoogle();
  expect(history.state.from).toBe("profile");
});
it("estado vencido ou armazenamento bloqueado não quebra a entrada", async () => {
  const { guardarDestinoGoogle, retomarDestinoGoogle } = await import(
    "@/lib/google-login"
  );
  guardarDestinoGoogle();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60 * 1000);
  expect(retomarDestinoGoogle().iniciado).toBe(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("bloqueado");
  });
  expect(() => retomarDestinoGoogle()).not.toThrow();
});
