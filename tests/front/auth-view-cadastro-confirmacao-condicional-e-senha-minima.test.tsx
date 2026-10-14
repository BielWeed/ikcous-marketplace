// @vitest-environment jsdom
//
// Dois defeitos da tela de CADASTRO do cliente (AuthView):
//
// 1) Quem JÁ TEM conta clica em "Cadastro" (no checkout, pagar online exige
//    conta) e a tela dizia "Um link de acesso exclusivo foi enviado para…" —
//    mas o servidor de autenticação responde sucesso FALSO, sem mandar e-mail,
//    quando o endereço já está confirmado (a pessoa espera para sempre). A tela
//    agora fala dos DOIS casos ("se ainda não tinha conta… se já tem conta…")
//    e leva ao login. NÃO pode revelar se o e-mail tem conta (a #120 fechou
//    esse vazamento): o texto é o mesmo para qualquer endereço.
//
// 2) Senha curta ("123456") voltava "Senha muito fraca" sem dizer o mínimo. O
//    servidor exige 8; o cadastro agora confere os 8 ANTES de enviar e mostra
//    a dica "Mínimo 8 caracteres" no campo — a mesma régua da troca de senha.
//
// Mesmo padrão de auth-view-reenvio-na-confirmacao-tem-trava.test.tsx
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

describe("AuthView — cadastro: texto condicional e senha mínima", () => {
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

  async function abrirCadastro() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => localizarBotaoPorTexto("CADASTRO").click());
  }

  async function preencherEEnviar(senha: string) {
    await act(async () => {
      digitar("fullName", "Pessoa Teste");
      digitar("phone", "11999999999");
      digitar("email", "pessoa@example.com");
      digitar("password", senha);
    });
    await act(async () => localizarBotaoPorTexto("FINALIZAR REGISTRO").click());
  }

  describe("tela 'Verifique seu e-mail' (quem já tem conta não fica esperando)", () => {
    it("fala dos dois casos: 'se ainda não tinha conta' E 'se já tem conta', sem afirmar o envio", async () => {
      await abrirCadastro();
      await preencherEEnviar("senha12345");

      expect(signUp).toHaveBeenCalledTimes(1);
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("Verifique seu e-mail");
      expect(texto).toMatch(/se este e-?mail ainda não tinha conta/i);
      expect(texto).toMatch(/se você já tem conta/i);
      // O endereço continua visível (ajuda quem digitou errado).
      expect(texto).toContain("pessoa@example.com");
      // A frase antiga afirmava o envio de forma categórica.
      expect(texto).not.toMatch(/foi enviado para/i);
      expect(texto).not.toMatch(/link de acesso exclusivo/i);
    });

    it("limite: o texto não depende do e-mail digitado (não vira oráculo de quem tem conta)", async () => {
      const comOutroEmail = async (email: string) => {
        act(() => raiz.unmount());
        hospedeiro.remove();
        hospedeiro = document.createElement("div");
        document.body.appendChild(hospedeiro);
        raiz = createRoot(hospedeiro);
        await abrirCadastro();
        await act(async () => {
          digitar("fullName", "Pessoa Teste");
          digitar("phone", "11999999999");
          digitar("email", email);
          digitar("password", "senha12345");
        });
        await act(async () =>
          localizarBotaoPorTexto("FINALIZAR REGISTRO").click(),
        );
        return (hospedeiro.textContent ?? "").replaceAll(email, "<EMAIL>");
      };
      const a = await comOutroEmail("a@example.com");
      const b = await comOutroEmail("bem-diferente@exemplo.com.br");
      expect(a).toBe(b);
    });

    it("tem o botão que leva ao login (com o e-mail já preenchido)", async () => {
      await abrirCadastro();
      await preencherEEnviar("senha12345");

      await act(async () =>
        localizarBotaoPorTexto("Retornar ao Login").click(),
      );

      expect(hospedeiro.textContent).toContain("ENTRAR AGORA");
      expect((document.getElementById("email") as HTMLInputElement).value).toBe(
        "pessoa@example.com",
      );
    });
  });

  describe("senha mínima de 8 no cadastro", () => {
    it("mostra a dica 'Mínimo 8 caracteres' no campo de senha do cadastro", async () => {
      await abrirCadastro();
      expect(hospedeiro.textContent).toContain("Mínimo 8 caracteres");
    });

    it("não mostra a dica no login (só no cadastro)", async () => {
      const { AuthView } = await import("@/views/shared/AuthView");
      await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
      expect(hospedeiro.textContent).not.toContain("Mínimo 8 caracteres");
    });

    it("barra senha de 7 caracteres ANTES de enviar, dizendo o mínimo", async () => {
      await abrirCadastro();
      await preencherEEnviar("1234567");

      expect(signUp).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
        /pelo menos 8 caracteres/i,
      );
      // Continua na tela de cadastro (não foi para a confirmação).
      expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
    });

    it("limite: senha de exatamente 8 caracteres passa e vai ao servidor", async () => {
      await abrirCadastro();
      await preencherEEnviar("12345678");

      expect(signUp).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
