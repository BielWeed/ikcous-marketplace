// @vitest-environment jsdom
//
// O CADASTRO CRIAVA A CONTA COM WHATSAPP DE 6 DÍGITOS.
//
// A tela só conferia se o WhatsApp não estava vazio: "(34) 9999" passava e a
// conta nascia com um número que não existe (o rastreio de pedido e o aviso
// da loja dependem dele). Agora o cadastro exige 10 ou 11 dígitos (depois de
// tirar +55 e o zero de tronco, como o checkout) e avisa em português claro.
//
// Mesmo padrão de auth-view-cadastro-confirmacao-condicional-e-senha-minima
// (render de verdade, useAuth e sonner dublados).
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

describe("AuthView — cadastro exige WhatsApp com 10 ou 11 dígitos", () => {
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

  async function enviarCadastroCom(whatsapp: string) {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => localizarBotaoPorTexto("CADASTRO").click());
    await act(async () => {
      digitar("fullName", "Pessoa Teste");
      digitar("phone", whatsapp);
      digitar("email", "pessoa@example.com");
      digitar("password", "senha12345");
    });
    await act(async () => localizarBotaoPorTexto("FINALIZAR REGISTRO").click());
  }

  it("'(34) 9999' (6 dígitos) NÃO cria a conta e avisa em português", async () => {
    await enviarCadastroCom("(34) 9999");

    expect(signUp).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
      /confira o whatsapp/i,
    );
    expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
  });

  it("controle: celular de 11 dígitos '(34) 99999-8888' passa", async () => {
    await enviarCadastroCom("(34) 99999-8888");
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: fixo de 10 dígitos '(34) 3333-4444' passa", async () => {
    await enviarCadastroCom("(34) 3333-4444");
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: '+55 34 99999-8888' colado (limpo para 11 dígitos) passa", async () => {
    await enviarCadastroCom("+55 34 99999-8888");
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
