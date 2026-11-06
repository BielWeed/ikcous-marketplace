// @vitest-environment jsdom
//
// A TELA "NOVA SENHA" NÃO DIZIA DE QUAL CONTA ERA A SENHA.
//
// Quem abre o link de "esqueci a senha" cai numa tela só com dois campos de
// senha, sem e-mail. O gerenciador de senhas (iPhone, Chrome) não sabe a qual
// conta atribuir a senha nova e oferece salvar/atualizar na conta errada ou
// sem nome. A correção é um campo de e-mail ESCONDIDO (autocomplete=username)
// com o e-mail da própria sessão de recuperação: não aparece, não é lido por
// leitor de tela, não recebe foco e não é enviado a lugar nenhum (o envio usa
// só a senha digitada).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let emRecuperacao = false;
let usuario: { email?: string | null } | null = null;
const updatePassword = vi.fn(async (_senha: string) => false);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword,
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: emRecuperacao,
    setIsPasswordRecovery: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const EMAIL_DA_CONTA = "cliente.ficticia@exemplo.com";

describe("AuthView — Nova senha informa a conta ao gerenciador de senhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    emRecuperacao = true;
    usuario = { email: EMAIL_DA_CONTA };
    updatePassword.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
  }

  const camposUsername = () =>
    [
      ...hospedeiro.querySelectorAll('input[autocomplete="username"]'),
    ] as HTMLInputElement[];

  async function digitar(campo: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("nova senha: existe um único campo username com o e-mail da sessão, escondido de todos", async () => {
    await abrir();
    expect(hospedeiro.textContent).toContain("Nova Senha");
    const campos = camposUsername();
    expect(campos.length).toBe(1);
    const campo = campos[0];
    expect(campo.type).toBe("email");
    expect(campo.value).toBe(EMAIL_DA_CONTA);
    expect(campo.readOnly).toBe(true);
    expect(campo.hidden).toBe(true);
    expect(campo.tabIndex).toBe(-1);
    expect(campo.getAttribute("aria-hidden")).toBe("true");
  });

  it("o campo escondido não é um campo visível nem tem rótulo", async () => {
    await abrir();
    const campo = camposUsername()[0];
    expect(campo.labels?.length ?? 0).toBe(0);
    expect(hospedeiro.querySelector('label[for="email"]')).toBeNull();
  });

  it("enviar a nova senha manda só a senha digitada, nunca o e-mail", async () => {
    await abrir();
    await digitar(
      document.getElementById("password") as HTMLInputElement,
      "senha-nova-123",
    );
    await digitar(
      document.getElementById("password-confirmacao") as HTMLInputElement,
      "senha-nova-123",
    );
    const form = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("senha-nova-123");
  });

  it("sessão sem e-mail: nenhum campo escondido é desenhado", async () => {
    usuario = { email: null };
    await abrir();
    expect(camposUsername().length).toBe(0);
  });

  it("sem sessão (user nulo): nenhum campo escondido é desenhado", async () => {
    usuario = null;
    await abrir();
    expect(camposUsername().length).toBe(0);
  });

  it("entrar: só o campo de e-mail de verdade, sem o escondido", async () => {
    emRecuperacao = false;
    await abrir();
    const campos = camposUsername();
    expect(campos.length).toBe(1);
    expect(campos[0].id).toBe("email");
    expect(campos[0].hidden).toBe(false);
    expect(campos[0].value).toBe("");
  });
});
