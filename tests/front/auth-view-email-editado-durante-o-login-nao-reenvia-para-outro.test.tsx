// @vitest-environment jsdom
//
// Internet lenta: a cliente toca ENTRAR com o e-mail A (conta ainda não
// confirmada) e, enquanto espera a resposta, corrige o campo para o e-mail B.
// A resposta "e-mail não confirmado" é da conta A: ela não pode acender o aviso
// nem o botão "Reenviar link de confirmação" sobre o campo que agora diz B,
// porque o botão manda o link para o que está no campo — e B receberia uma
// mensagem do app que ninguém pediu, enquanto A seguiria esperando em vão.
//
// A troca de tela (Cadastro / "Esqueceu?") já era coberta por
// auth-view-login-resposta-atrasada.test.tsx; aqui é a EDIÇÃO do e-mail.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();
const resendConfirmationEmail = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail,
    isPasswordRecovery: false,
    setIsPasswordRecovery: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type RespostaDoLogin = {
  success: boolean;
  error?: { code?: string; status?: number; message?: string };
  message?: string;
};

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(texto: string) {
  const encontrado = [...document.body.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === texto,
  );
  if (!encontrado) throw new Error(`Botão não encontrado: ${texto}`);
  return encontrado as HTMLButtonElement;
}

const NAO_CONFIRMADO: RespostaDoLogin = {
  success: false,
  error: { code: "email_not_confirmed", status: 400 },
};
const SENHA_ERRADA: RespostaDoLogin = {
  success: false,
  error: { status: 400, message: "Invalid login credentials" },
};
const REENVIAR = "Reenviar link de confirmação";

describe("AuthView — e-mail editado enquanto o login de outro e-mail está pendente", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function tocarEntrarCom(email: string) {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => {
      digitar("email", email);
      digitar("password", "senha12345");
    });
    await act(async () => botao("ENTRAR AGORA").click());
    expect(login).toHaveBeenCalledWith(email, "senha12345", "customer");
  }

  it("o 'não confirmado' de A chegando com o campo já em B não arma aviso nem reenvio", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrarCom("a@example.com");
    await act(async () => digitar("email", "b@example.com"));
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    expect(host.textContent).not.toContain(REENVIAR);
    expect(host.textContent).not.toContain("ainda não foi confirmado");
    expect(toast.error).not.toHaveBeenCalled();
    expect(resendConfirmationEmail).not.toHaveBeenCalled();
    // A tela destravou: dá para tentar de novo com o e-mail certo.
    expect(botao("ENTRAR AGORA").disabled).toBe(false);
  });

  it("depois de descartar o aviso de A, a nova tentativa com B segue normal (B não confirmado arma o reenvio para B)", async () => {
    const envioA = pendente<RespostaDoLogin>();
    login.mockReturnValueOnce(envioA.promessa);
    await tocarEntrarCom("a@example.com");
    await act(async () => digitar("email", "b@example.com"));
    await act(async () => envioA.resolver(NAO_CONFIRMADO));

    login.mockResolvedValueOnce(NAO_CONFIRMADO);
    await act(async () => botao("ENTRAR AGORA").click());
    expect(login).toHaveBeenLastCalledWith(
      "b@example.com",
      "senha12345",
      "customer",
    );
    resendConfirmationEmail.mockResolvedValue(true);
    await act(async () => botao(REENVIAR).click());

    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(resendConfirmationEmail).toHaveBeenCalledWith("b@example.com");
  });

  it("editar para B e voltar para A antes da resposta: ainda é A, o aviso e o reenvio (para A) aparecem", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    resendConfirmationEmail.mockResolvedValue(true);
    await tocarEntrarCom("a@example.com");
    await act(async () => digitar("email", "b@example.com"));
    await act(async () => digitar("email", "a@example.com"));
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    expect(host.textContent).toContain("ainda não foi confirmado");
    await act(async () => botao(REENVIAR).click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(resendConfirmationEmail).toHaveBeenCalledWith("a@example.com");
  });

  it("controle: sem editar o campo, a resposta arma o aviso e o reenvio vai para A", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    resendConfirmationEmail.mockResolvedValue(true);
    await tocarEntrarCom("a@example.com");
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    expect(host.textContent).toContain("ainda não foi confirmado");
    await act(async () => botao(REENVIAR).click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(resendConfirmationEmail).toHaveBeenCalledWith("a@example.com");
  });

  it("o mesmo e-mail com espaços e maiúsculas conta como o mesmo: o aviso aparece", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    resendConfirmationEmail.mockResolvedValue(true);
    await tocarEntrarCom("a@example.com");
    await act(async () => digitar("email", "  A@Example.COM  "));
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    expect(host.textContent).toContain("ainda não foi confirmado");
    await act(async () => botao(REENVIAR).click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    // O campo passou a ter outra grafia do MESMO endereço: a caixa de entrada
    // é a mesma (e-mail não diferencia maiúsculas).
    const enviadoPara = String(resendConfirmationEmail.mock.calls[0]?.[0]);
    expect(enviadoPara.toLowerCase()).toBe("a@example.com");
  });

  it("controle: a resposta de senha errada segue como antes, mesmo com o campo editado (só o 'não confirmado' foi tocado)", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrarCom("a@example.com");
    await act(async () => digitar("email", "b@example.com"));
    await act(async () => envio.resolver(SENHA_ERRADA));

    expect(host.textContent).toMatch(/e-?mail ou senha incorretos/i);
    expect(host.textContent).not.toContain(REENVIAR);
  });
});
