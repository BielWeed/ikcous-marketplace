// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.fn();
const resetPassword = vi.fn();
const resendConfirmationEmail = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp,
    resetPassword,
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

describe("AuthView — resposta atrasada respeita o fluxo e o e-mail enviado", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    resendConfirmationEmail.mockResolvedValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function montar() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
  }

  async function enviarCadastro() {
    await montar();
    await act(async () => botao("CADASTRO").click());
    await act(async () => {
      digitar("fullName", "Pessoa Teste");
      digitar("phone", "11999999999");
      digitar("email", "a@example.com");
      digitar("password", "senha12345");
    });
    await act(async () => botao("FINALIZAR REGISTRO").click());
    expect(signUp).toHaveBeenCalledWith(
      "a@example.com",
      "senha12345",
      "Pessoa Teste",
      "(11) 99999-9999",
      undefined,
    );
  }

  async function enviarRecuperacao() {
    await montar();
    await act(async () => botao("Esqueceu?").click());
    await act(async () => digitar("email", "a@example.com"));
    await act(async () => botao("SOLICITAR LINK").click());
    expect(resetPassword).toHaveBeenCalledWith("a@example.com");
  }

  it("mantém o login e o campo B quando o cadastro de A termina depois da troca", async () => {
    const envio = pendente<boolean>();
    signUp.mockReturnValue(envio.promessa);
    await enviarCadastro();
    await act(async () => botao("IDENTIFICAR-SE").click());
    await act(async () => digitar("email", "b@example.com"));
    await act(async () => envio.resolver(true));

    expect(host.textContent).toContain("ENTRAR AGORA");
    expect(host.textContent).not.toContain("Verifique seu e-mail");
    expect((document.getElementById("email") as HTMLInputElement).value).toBe(
      "b@example.com",
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.success).mock.calls[0]?.[0])).toContain(
      "a@example.com",
    );
  });

  it("mostra e reenvia para A mesmo se o campo mudar para B durante o cadastro", async () => {
    const envio = pendente<boolean>();
    signUp.mockReturnValue(envio.promessa);
    await enviarCadastro();
    await act(async () => digitar("email", "b@example.com"));
    await act(async () => envio.resolver(true));

    expect(host.textContent).toContain("Verifique seu e-mail");
    expect(host.textContent).toContain("a@example.com");
    expect(host.textContent).not.toContain("b@example.com");
    await act(async () => botao("Reenviar link").click());
    expect(resendConfirmationEmail).toHaveBeenCalledExactlyOnceWith(
      "a@example.com",
    );
  });

  it("não retoma o cadastro antigo se a pessoa sair e voltar ao mesmo modo", async () => {
    const envio = pendente<boolean>();
    signUp.mockReturnValue(envio.promessa);
    await enviarCadastro();
    await act(async () => botao("IDENTIFICAR-SE").click());
    await act(async () => botao("CADASTRO").click());
    await act(async () => envio.resolver(true));

    expect(host.textContent).toContain("FINALIZAR REGISTRO");
    expect(host.textContent).not.toContain("Verifique seu e-mail");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("a recuperação atrasada avisa sucesso sem tirar a pessoa do login", async () => {
    const envio = pendente<{ success: boolean; message: string }>();
    resetPassword.mockReturnValue(envio.promessa);
    await enviarRecuperacao();
    await act(async () => botao("LOGAR AGORA").click());
    await act(async () => digitar("email", "b@example.com"));
    await act(async () =>
      envio.resolver({
        success: true,
        message: "Se este e-mail estiver cadastrado, enviamos um link.",
      }),
    );

    expect(host.textContent).toContain("ENTRAR AGORA");
    expect(host.textContent).not.toContain("Verifique seu e-mail");
    expect((document.getElementById("email") as HTMLInputElement).value).toBe(
      "b@example.com",
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("a confirmação da recuperação mostra A mesmo que o campo já tenha B", async () => {
    const envio = pendente<{ success: boolean; message: string }>();
    resetPassword.mockReturnValue(envio.promessa);
    await enviarRecuperacao();
    await act(async () => digitar("email", "b@example.com"));
    await act(async () =>
      envio.resolver({
        success: true,
        message: "Se este e-mail estiver cadastrado, enviamos um link.",
      }),
    );

    expect(host.textContent).toContain("Verifique seu e-mail");
    expect(host.textContent).toContain("a@example.com");
    expect(host.textContent).not.toContain("b@example.com");
  });
});
