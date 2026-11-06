// @vitest-environment jsdom
//
// Rede pendurada no ENTRAR: quando o prazo estoura, `login` (AuthContext)
// devolve `{ success: false, message }` SEM `error` (não há causa do servidor
// para traduzir). As duas telas de login precisam MOSTRAR essa frase — antes
// o ramo `else if (error)` da AuthView não existia para esse formato e a tela
// ficava muda (botão solto, nenhuma explicação), e a tela do lojista caía na
// frase "o acesso desta conta precisa ser verificado".
//
// Controle: o formato de sempre (com `error`) segue traduzido pelas telas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: false,
    setIsPasswordRecovery: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeCity: "Sao Paulo", storeState: "SP" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_LENTA =
  "A conexão está lenta e a entrada não foi confirmada. Tente de novo em instantes.";

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("telas de login — prazo estourado mostra a frase de conexão lenta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function entrarNaTelaDoCliente() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => {
      raiz.render(<AuthView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      digitar("email", "alguem@example.com");
      digitar("password", "senha1234");
    });
    const botao = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("ENTRAR AGORA"),
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  async function entrarNaTelaDoLojista() {
    const { AdminLoginView } = await import("@/views/admin/AdminLoginView");
    await act(async () => {
      raiz.render(<AdminLoginView onLogin={vi.fn()} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      digitar("admin-email", "lojista@example.com");
      digitar("admin-password", "senha1234");
    });
    const form = document.body.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("cliente: success:false sem error mostra a frase e o botão solta", async () => {
    login.mockResolvedValue({ success: false, message: FRASE_LENTA });

    await entrarNaTelaDoCliente();

    expect(hospedeiro.textContent).toContain(FRASE_LENTA);
    const botao = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("ENTRAR AGORA"),
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
  });

  it("lojista: success:false sem error mostra a frase, não a de 'verificar fora do painel'", async () => {
    login.mockResolvedValue({ success: false, message: FRASE_LENTA });

    await entrarNaTelaDoLojista();

    expect(hospedeiro.textContent).toContain(FRASE_LENTA);
    expect(hospedeiro.textContent).not.toMatch(/verificado fora deste painel/i);
  });

  it("controle cliente: com error (400) a tela segue traduzindo, ignora o message", async () => {
    login.mockResolvedValue({
      success: false,
      error: { status: 400, message: "Invalid login credentials" },
      message: "texto que a tela do cliente não deve usar quando há error",
    });

    await entrarNaTelaDoCliente();

    expect(hospedeiro.textContent).toMatch(/e-?mail ou senha incorretos/i);
    expect(hospedeiro.textContent).not.toContain("texto que a tela");
  });

  it("controle lojista: com error (400) a tela segue traduzindo, ignora o message", async () => {
    login.mockResolvedValue({
      success: false,
      error: { status: 400, message: "Invalid login credentials" },
      message: "texto que a tela do lojista não deve usar quando há error",
    });

    await entrarNaTelaDoLojista();

    expect(hospedeiro.textContent).toMatch(/senha administrativos incorretos/i);
    expect(hospedeiro.textContent).not.toContain("texto que a tela");
  });
});
