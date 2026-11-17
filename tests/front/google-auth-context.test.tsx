// @vitest-environment jsdom
import { act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gravar: vi.fn(), oauth: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOAuth: mocks.oauth,
      signInWithPassword: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));
vi.mock("@/lib/cpf-da-conta", () => ({
  gravarPerfilDaConta: mocks.gravar,
  gravarCpfDaConta: vi.fn(),
  mensagemFalhaCpf: () => "A conta mudou. Nada foi salvo.",
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// @ts-expect-error flag de testes do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let contexto: any;
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState({ view: "auth", from: "checkout" }, "", "/auth");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.oauth.mockReset();
  mocks.gravar.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function montar() {
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  function Sonda() {
    const valor = useContext(AuthContext);
    useEffect(() => {
      contexto = valor;
    }, [valor]);
    return null;
  }
  await act(async () =>
    root.render(
      <AuthProvider>
        <Sonda />
      </AuthProvider>,
    ),
  );
}
it("Google guarda o destino e usa somente origem + /auth no redirectTo", async () => {
  mocks.oauth.mockResolvedValue({ error: null });
  history.replaceState(
    { view: "auth", from: "checkout", next: "https://fora.invalid/roubar" },
    "",
    "/auth",
  );
  await montar();
  expect(typeof contexto.loginComGoogle).toBe("function");
  let ok;
  await act(async () => {
    ok = await contexto.loginComGoogle();
  });
  expect(ok).toBe(true);
  expect(mocks.oauth).toHaveBeenCalledWith({
    provider: "google",
    options: { redirectTo: `${location.origin}/auth` },
  });
  history.replaceState(null, "", "/auth");
  const { retomarDestinoGoogle } = await import("@/lib/google-login");
  expect(retomarDestinoGoogle().checkout).toBe(true);
  expect(history.state.from).toBe("checkout");
});
it("erro ou rejeição do OAuth devolve false sem mensagem bruta", async () => {
  mocks.oauth.mockRejectedValue(new Error("segredo não deve sair"));
  await montar();
  expect(typeof contexto.loginComGoogle).toBe("function");
  expect(await contexto.loginComGoogle()).toBe(false);
});
it("falha DEVOLVIDA pelo SDK (resolve com error) é false e esquece o destino", async () => {
  mocks.oauth.mockResolvedValue({
    data: null,
    error: { name: "AuthApiError", message: "segredo não deve sair" },
  });
  await montar();
  let ok: unknown;
  await act(async () => {
    ok = await contexto.loginComGoogle();
  });
  expect(ok).toBe(false);
  expect(mocks.oauth).toHaveBeenCalledOnce();
  const { retomarDestinoGoogle } = await import("@/lib/google-login");
  expect(retomarDestinoGoogle().checkout).toBe(false);
});
it("controle: resposta do SDK com url e sem error é true e guarda o destino", async () => {
  mocks.oauth.mockResolvedValue({
    data: { provider: "google", url: "https://accounts.example.test/auth" },
    error: null,
  });
  await montar();
  let ok: unknown;
  await act(async () => {
    ok = await contexto.loginComGoogle();
  });
  expect(ok).toBe(true);
  const { retomarDestinoGoogle } = await import("@/lib/google-login");
  expect(retomarDestinoGoogle().checkout).toBe(true);
});
it.each([true, false])(
  "updateProfile silencioso=%s mantém a guarda e não ecoa dado privado",
  async (silencioso) => {
    mocks.gravar.mockResolvedValue({
      ok: false,
      motivo: "conta_trocada",
      privado: "telefone-falso",
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { toast } = await import("sonner");
    await montar();
    vi.mocked(toast.error).mockClear();
    const ok = await contexto.updateProfile(
      { whatsapp: "11999999999" },
      { silencioso, contaEsperada: "conta-a" },
    );
    expect(ok).toBe(false);
    expect(mocks.gravar).toHaveBeenCalledWith(
      {
        p_whatsapp: "11999999999",
        p_full_name: null,
        p_avatar_url: null,
        p_cover_url: null,
      },
      "conta-a",
      expect.any(Function),
    );
    if (silencioso) {
      expect(toast.error).not.toHaveBeenCalled();
      expect(erro).toHaveBeenCalledWith(
        "[Auth] Não foi possível atualizar o perfil.",
      );
    } else expect(toast.error).toHaveBeenCalledOnce();
  },
);
it.each(
  ["false", "pendente", "true"].flatMap((estado) =>
    [400, 500].map((status) => ({ estado, status })),
  ),
)(
  "retorno do login: sonda $estado e erro $status usam a mesma frase da tela",
  async ({ estado, status }) => {
    await montar();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        estado === "pendente"
          ? new Promise(() => {})
          : Promise.resolve({
              ok: true,
              json: async () => ({ external: { google: estado === "true" } }),
            }),
      ),
    );
    const { googleLigadoNestaLoja } = await import("@/lib/google-login");
    const sonda = googleLigadoNestaLoja();
    if (estado !== "pendente") await sonda;
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: { status, message: "falha falsa" },
    } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base =
      status === 400
        ? "E-mail ou senha incorretos. Verifique suas credenciais."
        : "Não foi possível entrar agora. Tente novamente em instantes ou fale com a loja.";
    const resultado = await contexto.login(
      "qualquer@example.test",
      "senha",
      "customer",
    );
    expect(resultado.message).toBe(
      estado === "true"
        ? `${base} Se você criou a conta com o Google, use o botão do Google.`
        : base,
    );
    const lojista = await contexto.login(
      "qualquer@example.test",
      "senha",
      "admin",
    );
    expect(lojista.message).not.toContain("Google");
  },
);
it("restaurar o retorno não sobrescreve navegação já feita ou outro state válido", async () => {
  const { guardarDestinoGoogle } = await import("@/lib/google-login");
  guardarDestinoGoogle();
  await montar();
  history.replaceState({ view: "auth", from: "cart" }, "", "/auth");
  contexto.restaurarDestinoGoogle();
  expect(history.state.from).toBe("cart");
  history.replaceState(null, "", "/profile");
  contexto.restaurarDestinoGoogle();
  expect(history.state).toBeNull();
});
it("o segundo argumento antigo de conta esperada continua válido", async () => {
  mocks.gravar.mockResolvedValue({ ok: false, motivo: "conta_trocada" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  await montar();
  await contexto.updateProfile({ whatsapp: "11999999999" }, "conta-b");
  expect(mocks.gravar.mock.calls[0][1]).toBe("conta-b");
});
