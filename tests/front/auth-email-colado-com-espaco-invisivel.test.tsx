// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();
const signUp = vi.fn();
const resetPassword = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp,
    resetPassword,
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
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type TipoDeInsercao = "insertText" | "insertFromPaste";

function digitar(
  id: string,
  valor: string,
  {
    cursor,
    tipo = "insertText",
  }: { cursor?: number; tipo?: TipoDeInsercao } = {},
) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  if (cursor !== undefined) campo.setSelectionRange(cursor, cursor);
  campo.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: tipo }),
  );
}

function colarEmail(valor: string) {
  digitar("email", valor, { tipo: "insertFromPaste" });
}

function inserirNaSelecao(
  campo: HTMLInputElement,
  trecho: string,
  tipo: TipoDeInsercao = "insertText",
) {
  const inicio = campo.selectionStart!;
  const fim = campo.selectionEnd!;
  digitar(
    campo.id,
    campo.value.slice(0, inicio) + trecho + campo.value.slice(fim),
    {
      cursor: inicio + trecho.length,
      tipo,
    },
  );
}

describe("AuthView — e-mail colado com espaço invisível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    login.mockReset().mockResolvedValue({ success: true });
    signUp.mockReset().mockResolvedValue(true);
    resetPassword.mockReset().mockResolvedValue({
      success: true,
      status: "success",
      message: "Se este e-mail estiver cadastrado, enviamos um link.",
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function clicarBotao(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (elemento) => elemento.textContent?.trim() === texto,
    );
    expect(botao).toBeDefined();
    botao!.click();
  }

  it.each([
    ["login", null, "ENTRAR AGORA", login],
    ["cadastro", "CADASTRO", "FINALIZAR REGISTRO", signUp],
    ["recuperação", "Esqueceu?", "SOLICITAR LINK", resetPassword],
  ] as const)(
    "%s envia o e-mail sem o espaço não separável colado no fim",
    async (modo, abrir, enviar, solicitar) => {
      if (abrir) await act(async () => clicarBotao(abrir));
      await act(async () => {
        if (modo === "cadastro") {
          digitar("fullName", "Pessoa Teste");
          digitar("phone", "(34) 99999-8888");
        }
        if (modo !== "recuperação") digitar("password", "senha12345");
        colarEmail("a@b.com\u{00A0}");
      });

      // Clique real no botão: disparar "submit" direto pularia a validação.
      await act(async () => clicarBotao(enviar));
      expect(solicitar).toHaveBeenCalledTimes(1);
      expect(solicitar.mock.calls[0]?.[0]).toBe("a@b.com");
    },
  );

  it("apara espaços misturados nas duas pontas e preserva as maiúsculas", async () => {
    await act(async () => {
      digitar("password", "senha12345");
      colarEmail(" \u{200B}\u{2007}A+B@Example.com\u{202F}\u{FEFF}\u{200B} ");
    });

    await act(async () => clicarBotao("ENTRAR AGORA"));
    expect(login).toHaveBeenCalledExactlyOnceWith(
      "A+B@Example.com",
      "senha12345",
      "customer",
    );
  });

  it("continua digitando no mesmo ponto depois de colar no trecho selecionado", async () => {
    const campo = document.getElementById("email") as HTMLInputElement;
    await act(async () => {
      digitar("email", "ana@example.test");
      campo.focus();
    });

    // jsdom não executa a ação padrão de colar: simulamos a inserção nativa.
    expect(campo.selectionStart).not.toBeNull();
    campo.setSelectionRange(0, 3);
    await act(async () =>
      inserirNaSelecao(campo, "\u{200B}bia", "insertFromPaste"),
    );

    expect(campo.value).toBe("bia@example.test");
    expect(campo.selectionStart).toBe(3);
    expect(campo.selectionEnd).toBe(3);

    // Também restaura a posição se a limpeza devolver o e-mail que já estava no estado.
    campo.setSelectionRange(0, 3);
    await act(async () =>
      inserirNaSelecao(campo, "\u{200B}bia", "insertFromPaste"),
    );
    expect(campo.selectionStart).toBe(3);
    await act(async () => inserirNaSelecao(campo, "x"));
    expect(campo.value).toBe("biax@example.test");
  });

  it("preserva o espaço comum digitado e não envia um endereço diferente", async () => {
    const campo = document.getElementById("email") as HTMLInputElement;
    const endereco = "ana maria@example.test";
    await act(async () => {
      digitar("password", "senha12345");
      campo.focus();
    });

    for (const caractere of endereco) {
      await act(async () => inserirNaSelecao(campo, caractere));
    }

    await act(async () => clicarBotao("ENTRAR AGORA"));
    expect.soft(campo.value).toBe(endereco);
    expect.soft(campo.checkValidity()).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });

  it("espaço comum no fim do e-mail digitado não trava o login e é aparado no envio", async () => {
    const campo = document.getElementById("email") as HTMLInputElement;
    await act(async () => {
      digitar("password", "senha12345");
      campo.focus();
    });

    for (const caractere of "ana@example.test ") {
      await act(async () => inserirNaSelecao(campo, caractere));
    }

    expect(campo.value).toBe("ana@example.test ");
    expect(campo.checkValidity()).toBe(true);
    await act(async () => clicarBotao("ENTRAR AGORA"));
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][0]).toBe("ana@example.test");
  });

  it("não corrige silenciosamente um espaço no meio do endereço", async () => {
    const campo = document.getElementById("email") as HTMLInputElement;
    await act(async () => {
      digitar("password", "senha12345");
      colarEmail("\u{200B}a\u{200B}b@b.com\u{00A0}");
    });

    expect(campo.value).toBe("a\u{200B}b@b.com");
    expect(campo.checkValidity()).toBe(false);
    await act(async () => clicarBotao("ENTRAR AGORA"));
    expect(login).not.toHaveBeenCalled();
  });
});
