// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null,
  loginComGoogle: vi.fn(),
  login: vi.fn(),
  isPasswordRecovery: false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://loja-falsa.supabase.co",
  lerChaveSupabase: () => "chave-publica-falsa",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag de testes do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetModules();
  auth.loginComGoogle.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ external: { google: true } }),
    }),
  );
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Chrome");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
async function montar() {
  const { AuthView } = await import("@/views/shared/AuthView");
  await act(async () => root.render(<AuthView onNavigate={vi.fn()} />));
}
it("oferece Google em entrar e cadastrar, mas não em recuperar", async () => {
  await montar();
  expect(button("Continuar com Google")).toBeDefined();
  await act(async () => button("CADASTRO")!.click());
  expect(button("Continuar com Google")).toBeDefined();
  await act(async () => button("Entrar")!.click());
  await act(async () => button("Esqueceu?")!.click());
  expect(button("Continuar com Google")).toBeUndefined();
});
it.each(["Instagram", "FBAN/FBIOS", "FBAV/123", "FB_IAB"])(
  "não oferece Google dentro de %s",
  async (ua) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    await montar();
    expect(button("Continuar com Google")).toBeUndefined();
  },
);
it("esconde Google se a sonda falhar e mantém o formulário", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("rede"));
  await montar();
  expect(button("Continuar com Google")).toBeUndefined();
  expect(button("ENTRAR AGORA")).toBeDefined();
});
it("trava dois cliques e, na falha, solta Google sem travar e-mail", async () => {
  let resolver!: (valor: boolean) => void;
  auth.loginComGoogle.mockReturnValue(
    new Promise<boolean>((r) => {
      resolver = r;
    }),
  );
  await montar();
  const google = button("Continuar com Google")!;
  await act(async () => {
    google.click();
    google.click();
  });
  expect(auth.loginComGoogle).toHaveBeenCalledTimes(1);
  expect(google.disabled).toBe(true);
  await act(async () => resolver(false));
  expect(button("Continuar com Google")?.disabled).toBe(false);
  expect(button("ENTRAR AGORA")?.disabled).toBe(false);
  expect(host.textContent).toContain("Não foi possível entrar com o Google");
});
it.each(["email-a@example.test", "email-b@example.test"])(
  "falha por senha tem a mesma dica, sem indicar se %s tem conta",
  async (email) => {
    auth.login.mockResolvedValue({
      success: false,
      error: { status: 400, message: "Invalid login credentials" },
    });
    await montar();
    await act(async () => {
      for (const [id, valor] of [
        ["email", email],
        ["password", "senha-falsa"],
      ]) {
        const campo = host.querySelector(`#${id}`)!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => host.querySelector("form")!.requestSubmit());
    const alerta = host.querySelector('[role="alert"]')!;
    expect(alerta.textContent).toBe(
      "E-mail ou senha incorretos. Verifique suas credenciais. Se você criou a conta com o Google, use o botão do Google.",
    );
    expect(alerta.textContent).not.toContain(email);
  },
);
it("a entrada da lojista nunca ganha o botão Google", async () => {
  const { AdminLoginView } = await import("@/views/admin/AdminLoginView");
  await act(async () =>
    root.render(<AdminLoginView onLogin={vi.fn()} onNavigate={vi.fn()} />),
  );
  expect(button("Continuar com Google")).toBeUndefined();
});
it("a dica Google é genérica para a cliente, nunca para a lojista", async () => {
  const mensagens = await import("@/lib/mensagens-auth");
  expect(mensagens.MENSAGEM_ERRO_LOGIN_GENERICA).toContain(
    "Se você criou a conta com o Google, use o botão do Google.",
  );
  expect(mensagens.MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA).not.toContain(
    "Google",
  );
});
