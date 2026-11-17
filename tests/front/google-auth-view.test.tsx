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
  vi.useRealTimers();
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
it.each([
  "Instagram",
  "FBAN/FBIOS",
  "FBAV/123",
  "FB_IAB",
  "BytedanceWebview",
  "musical_ly",
  "Line/13.1",
  "Snapchat/12",
  "Mozilla/5.0 (Linux; Android 13; Pixel; wv)",
])("não oferece Google dentro de %s", async (ua) => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  await montar();
  expect(button("Continuar com Google")).toBeUndefined();
  expect(host.textContent).toContain("Criou sua conta com o Google?");
  expect(host.textContent).toContain(
    "Este navegador não permite entrar com o Google.",
  );
  expect(host.textContent).toContain("Abrir no navegador");
  expect(host.textContent).toContain("Chrome ou Safari");
  expect(host.textContent).toContain("Ou entre com e-mail e senha.");
});
it.each([
  "Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 PWA",
])("Chrome, Safari e PWA comuns continuam com Google (%s)", async (ua) => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  await montar();
  expect(button("Continuar com Google")).toBeDefined();
  expect(host.textContent).not.toContain("Criou sua conta com o Google?");
});
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
const pageshow = (persisted: boolean) =>
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
it("voltar do Google (página restaurada do histórico) solta o botão preso", async () => {
  // true = a janela inteira foi para o Google: o clique fica travado de propósito.
  auth.loginComGoogle.mockResolvedValue(true);
  await montar();
  await act(async () => button("Continuar com Google")!.click());
  expect(button("Abrindo Google")?.disabled).toBe(true);
  await act(async () => pageshow(true));
  const google = button("Continuar com Google");
  expect(google?.disabled).toBe(false);
  expect(button("Abrindo Google")).toBeUndefined();
  // A trava síncrona também foi solta: dá para tentar de novo.
  await act(async () => google!.click());
  expect(auth.loginComGoogle).toHaveBeenCalledTimes(2);
});
it("pageshow sem restauração do histórico não solta o clique do Google", async () => {
  auth.loginComGoogle.mockResolvedValue(true);
  await montar();
  await act(async () => button("Continuar com Google")!.click());
  await act(async () => pageshow(false));
  expect(button("Abrindo Google")?.disabled).toBe(true);
  await act(async () => button("Abrindo Google")!.click());
  expect(auth.loginComGoogle).toHaveBeenCalledTimes(1);
});
it("sem tentativa em curso, pageshow restaurado não muda nada", async () => {
  await montar();
  await act(async () => pageshow(true));
  expect(button("Continuar com Google")?.disabled).toBe(false);
  expect(auth.loginComGoogle).not.toHaveBeenCalled();
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
it("as frases-base ficam idênticas às anteriores e a da lojista não fala em Google", async () => {
  const mensagens = await import("@/lib/mensagens-auth");
  expect(mensagens.MENSAGEM_ERRO_LOGIN_GENERICA).toBe(
    "Não foi possível entrar agora. Tente novamente em instantes ou fale com a loja.",
  );
  expect(mensagens.MENSAGEM_CREDENCIAIS_CLIENTE).toBe(
    "E-mail ou senha incorretos. Verifique suas credenciais.",
  );
  expect(mensagens.MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA).not.toContain(
    "Google",
  );
});
it.each(
  ["false", "pendente", "true"].flatMap((estado) =>
    [400, 500].map((status) => ({ estado, status })),
  ),
)(
  "sonda $estado, erro $status: dica e botão concordam, sem mudar a frase antes do SIM",
  async ({ estado, status }) => {
    if (estado === "pendente") {
      vi.useFakeTimers();
      vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    } else {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ external: { google: estado === "true" } }),
      } as Response);
    }
    auth.login.mockResolvedValue({
      success: false,
      error: { status, message: "interno" },
    });
    await montar();
    await act(async () => {
      for (const [id, valor] of [
        ["email", "qualquer@example.test"],
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
    const base =
      status === 400
        ? "E-mail ou senha incorretos. Verifique suas credenciais."
        : "Não foi possível entrar agora. Tente novamente em instantes ou fale com a loja.";
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(
      estado === "true"
        ? `${base} Se você criou a conta com o Google, use o botão do Google.`
        : base,
    );
    expect(!!button("Continuar com Google")).toBe(estado === "true");
  },
);
