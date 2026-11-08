// @vitest-environment jsdom
//
// Internet lenta: a cliente toca ENTRAR e, antes da resposta, troca para
// CADASTRO ou "Esqueceu?". A resposta tardia do login NÃO pode acender a faixa
// vermelha de "entrar" (nem o botão de reenviar confirmação) sobre a tela
// errada: o cadastro e o "esqueci a senha" já conferem o fluxo, o login também
// confere. Fora do fluxo de origem a resposta vira só um aviso (toast).
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
  let rejeitar!: (motivo: unknown) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
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

function faixasDeErro() {
  return [...document.body.querySelectorAll('[role="alert"]')].filter((el) =>
    el.className.includes("bg-red-50"),
  );
}

const NAO_CONFIRMADO = {
  success: false,
  error: { code: "email_not_confirmed", status: 400 },
};
const SENHA_ERRADA = {
  success: false,
  error: { status: 400, message: "Invalid login credentials" },
};

describe("AuthView — resposta do login que chega depois da troca de tela", () => {
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

  async function tocarEntrar() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => {
      digitar("email", "a@example.com");
      digitar("password", "senha12345");
    });
    await act(async () => botao("ENTRAR AGORA").click());
    expect(login).toHaveBeenCalledWith(
      "a@example.com",
      "senha12345",
      "customer",
    );
  }

  it("e-mail não confirmado chegando já no CADASTRO não pinta a faixa nem oferece reenvio", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => botao("CADASTRO").click());
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    expect(host.textContent).toContain("FINALIZAR REGISTRO");
    expect(faixasDeErro()).toHaveLength(0);
    expect(host.textContent).not.toContain("Reenviar link de confirmação");
    expect(toast.error).toHaveBeenCalledTimes(1);
    // Voltar para entrar depois NÃO traz a faixa velha de volta.
    await act(async () => botao("Entrar").click());
    expect(faixasDeErro()).toHaveLength(0);
    expect(host.textContent).not.toContain("Reenviar link de confirmação");
  });

  it("o 'não confirmado' tardio não deixa o botão de reenvio armado para a próxima senha errada", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValueOnce(envio.promessa);
    await tocarEntrar();
    await act(async () => botao("CADASTRO").click());
    await act(async () => botao("Entrar").click());
    // Já de volta ao entrar (outro fluxo), chega o "não confirmado" velho.
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    // Nova tentativa na tela de entrar, agora com senha errada de verdade.
    login.mockResolvedValue(SENHA_ERRADA);
    await act(async () => {
      digitar("email", "a@example.com");
      digitar("password", "outra-senha");
    });
    await act(async () => botao("ENTRAR AGORA").click());

    expect(host.textContent).toMatch(/e-?mail ou senha incorretos/i);
    expect(host.textContent).not.toContain("Reenviar link de confirmação");
  });

  it("senha errada chegando já no 'Esqueceu?' não pinta a faixa vermelha", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => botao("Esqueceu?").click());
    await act(async () => envio.resolver(SENHA_ERRADA));

    expect(host.textContent).toContain("SOLICITAR LINK");
    expect(faixasDeErro()).toHaveLength(0);
    expect(host.textContent).not.toMatch(/e-?mail ou senha incorretos/i);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("a frase de conexão lenta (sem causa do servidor) também vira só aviso", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => botao("CADASTRO").click());
    await act(async () =>
      envio.resolver({ success: false, message: "A conexão está lenta." }),
    );

    expect(faixasDeErro()).toHaveLength(0);
    expect(String(vi.mocked(toast.error).mock.calls[0]?.[0])).toContain(
      "A conexão está lenta.",
    );
  });

  it("sair e voltar ao mesmo modo também é outro fluxo: a resposta velha não pinta a faixa", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => botao("CADASTRO").click());
    await act(async () => botao("Entrar").click());
    await act(async () => envio.resolver(SENHA_ERRADA));

    expect(host.textContent).toContain("ENTRAR AGORA");
    expect(faixasDeErro()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("erro inesperado do login que chega no CADASTRO vira aviso, não faixa de entrar", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => botao("CADASTRO").click());
    await act(async () => envio.rejeitar(new Error("queda")));

    expect(faixasDeErro()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("o reenvio da confirmação que falha depois da troca de tela vira aviso, não faixa", async () => {
    const reenvio = pendente<boolean>();
    resendConfirmationEmail.mockReturnValue(reenvio.promessa);
    login.mockResolvedValue(NAO_CONFIRMADO);
    await tocarEntrar();
    expect(host.textContent).toContain("Reenviar link de confirmação");
    await act(async () => botao("Reenviar link de confirmação").click());
    await act(async () => botao("CADASTRO").click());
    await act(async () => reenvio.rejeitar(new Error("queda")));

    expect(host.textContent).toContain("FINALIZAR REGISTRO");
    expect(faixasDeErro()).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledTimes(1);
    await act(async () => botao("Entrar").click());
    expect(faixasDeErro()).toHaveLength(0);
  });

  it("controle: o reenvio que falha SEM trocar de tela segue na faixa", async () => {
    resendConfirmationEmail.mockRejectedValue(new Error("queda"));
    login.mockResolvedValue(NAO_CONFIRMADO);
    await tocarEntrar();
    await act(async () => botao("Reenviar link de confirmação").click());

    expect(host.textContent).toContain("Não foi possível reenviar");
    expect(faixasDeErro()).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: sem trocar de tela, a faixa de e-mail não confirmado e o reenvio aparecem", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => envio.resolver(NAO_CONFIRMADO));

    expect(faixasDeErro()).toHaveLength(1);
    expect(host.textContent).toContain("ainda não foi confirmado");
    expect(host.textContent).toContain("Reenviar link de confirmação");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: sem trocar de tela, senha errada e conexão lenta seguem na faixa", async () => {
    const envio = pendente<RespostaDoLogin>();
    login.mockReturnValue(envio.promessa);
    await tocarEntrar();
    await act(async () => envio.resolver(SENHA_ERRADA));
    expect(host.textContent).toMatch(/e-?mail ou senha incorretos/i);
    expect(faixasDeErro()).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
