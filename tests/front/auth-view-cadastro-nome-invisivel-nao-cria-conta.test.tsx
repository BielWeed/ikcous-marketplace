// @vitest-environment jsdom
//
// O CADASTRO CRIAVA A CONTA COM NOME FEITO SÓ DE CARACTERES INVISÍVEIS.
//
// A tela conferia o nome com `trim()`, que só tira espaços comuns: um espaço de
// largura zero (U+200B), o Braille em branco (U+2800) ou o preenchimento Hangul
// (U+3164) passavam como "nome" e a conta nascia com o nome em branco no Perfil
// e nas avaliações. Agora o campo vazio considera esses caracteres vazios e o
// cadastro avisa como já avisava para campo em branco. A regra da senha, do
// e-mail e do WhatsApp não mudou (os controles abaixo provam).
//
// Mesmo padrão de auth-view-cadastro-whatsapp-incompleto-nao-cria-conta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp,
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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(texto: string) {
  const botao = [...document.body.querySelectorAll("button")].find(
    (elemento) => elemento.textContent?.trim() === texto,
  );
  expect(botao).toBeDefined();
  return botao as HTMLButtonElement;
}

describe("AuthView — cadastro não aceita nome só de caracteres invisíveis", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    signUp.mockReset().mockResolvedValue(true);
    vi.mocked(toast.error).mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function enviarCadastroComNome(nome: string) {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => localizarBotaoPorTexto("CADASTRO").click());
    await act(async () => {
      digitar("fullName", nome);
      digitar("phone", "(34) 99999-8888");
      digitar("email", "pessoa@example.com");
      digitar("password", "senha12345");
    });
    await act(async () => localizarBotaoPorTexto("FINALIZAR REGISTRO").click());
  }

  it.each([
    ["espaço de largura zero (U+200B)", "\u200B"],
    ["Braille em branco (U+2800)", "\u2800"],
    ["preenchimento Hangul (U+3164)", "\u3164"],
    ["mistura com espaços", " \u200B\u3164 "],
  ])("%s NÃO cria a conta e avisa que faltou preencher", async (_d, nome) => {
    await enviarCadastroComNome(nome);

    expect(signUp).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Preencha todos os campos para o cadastro.",
    );
    expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
  });

  it("controle: nome com letra visível continua criando a conta", async () => {
    await enviarCadastroComNome("Pessoa Teste");

    expect(signUp).toHaveBeenCalledTimes(1);
    expect(signUp.mock.calls[0]?.[2]).toBe("Pessoa Teste");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: nome só com espaços comuns continua recusado do mesmo jeito", async () => {
    await enviarCadastroComNome("     ");

    expect(signUp).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Preencha todos os campos para o cadastro.",
    );
  });
});
