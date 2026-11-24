// @vitest-environment jsdom
//
// LOGIN DO CLIENTE (AuthView) — as bordas que os outros testes deixavam passar.
// Cada caso abaixo nasceu de uma mutação do código de produção que NENHUM teste
// existente derrubava (caça por mutação):
//
// 1) Campos vazios: senha só de espaços e e-mail só de espaços não podem
//    chegar ao servidor (a conferência `trim()` de cada campo era trocável por
//    "campo sem trim" sem nenhum teste cair).
// 2) A senha vai EXATAMENTE como foi digitada (espaços nas pontas fazem parte
//    dela); só o e-mail é aparado. E a audiência é "customer" (a tela do
//    cliente nunca fala como lojista).
// 3) Cada SINAL do erro, sozinho, basta: o servidor antigo manda só a mensagem,
//    o novo manda só o código. Os testes antigos davam sempre os dois sinais
//    juntos, então tirar um deles não derrubava nada.
// 4) O que acontece depois de entrar: aviso de boas-vindas, destino e o
//    destino do Google restaurado.
//
// Mesmo padrão de auth-else-final-do-login-e-excecao-do-reset-nao-vazam-erro-cru
// (render de verdade, useAuth e sonner dublados). Só dados fictícios.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();
const restaurarDestinoGoogle = vi.fn();

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
    restaurarDestinoGoogle,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeCity: "Sao Paulo", storeState: "SP" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_CAMPOS = "Por favor, preencha todos os campos.";
const FRASE_NAO_CONFIRMADO =
  "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e a pasta de spam.";
const FRASE_CREDENCIAIS = /e-?mail ou senha incorretos/i;
const FRASE_GENERICA = /não foi possível entrar agora/i;
const FRASE_LIMITE = /muitas tentativas/i;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
}

describe("AuthView — login: campos vazios, senha intacta e cada sinal do erro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    restaurarDestinoGoogle.mockReset();
    vi.mocked(toast.success).mockClear();
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

  async function abrir(
    props: { onSuccess?: () => void; onNavigate?: () => void } = {},
  ) {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = props.onNavigate ?? vi.fn();
    await act(async () =>
      raiz.render(
        <AuthView onNavigate={onNavigate} onSuccess={props.onSuccess} />,
      ),
    );
    return onNavigate;
  }

  // Dispara o envio do formulário sem passar pela validação nativa do
  // navegador (`required`/`pattern`): é a defesa do próprio código que se prova.
  async function enviarFormulario() {
    const form = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  }

  async function entrar(email: string, senha: string) {
    await act(async () => {
      digitar("email", email);
      digitar("password", senha);
    });
    await act(async () => botao("ENTRAR AGORA")?.click());
  }

  const alerta = () => hospedeiro.querySelector('[role="alert"]');

  describe("campos vazios não chegam ao servidor", () => {
    it("senha só de espaços: pede os campos e não chama o login", async () => {
      await abrir();
      await act(async () => {
        digitar("email", "pessoa.ficticia@exemplo.com");
        digitar("password", "     ");
      });
      await enviarFormulario();

      expect(login).not.toHaveBeenCalled();
      expect(alerta()?.textContent).toBe(FRASE_CAMPOS);
    });

    it("e-mail só de espaços: pede os campos e não chama o login", async () => {
      await abrir();
      await act(async () => {
        digitar("email", "   ");
        digitar("password", "senha-ficticia-1");
      });
      await enviarFormulario();

      expect(login).not.toHaveBeenCalled();
      expect(alerta()?.textContent).toBe(FRASE_CAMPOS);
    });

    it("tudo vazio: pede os campos, e corrigir libera o envio seguinte (a faixa some)", async () => {
      await abrir();
      await enviarFormulario();
      expect(alerta()?.textContent).toBe(FRASE_CAMPOS);

      login.mockResolvedValueOnce({ success: false, error: { status: 400 } });
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(login).toHaveBeenCalledTimes(1);
      expect(hospedeiro.textContent).not.toContain(FRASE_CAMPOS);
    });

    it("a faixa 'preencha os campos' some assim que a pessoa volta a digitar", async () => {
      await abrir();
      await enviarFormulario();
      expect(alerta()?.textContent).toBe(FRASE_CAMPOS);

      await act(async () => digitar("email", "p"));
      expect(alerta()).toBeNull();
    });
  });

  describe("o que vai ao servidor", () => {
    it("a senha vai exatamente como digitada (espaços e maiúsculas) e o e-mail vai aparado, como cliente", async () => {
      login.mockResolvedValue({ success: false, error: { status: 400 } });
      await abrir();
      await entrar("  Pessoa.Ficticia@Exemplo.com  ", "  SenhA 123  ");

      expect(login).toHaveBeenCalledExactlyOnceWith(
        "Pessoa.Ficticia@Exemplo.com",
        "  SenhA 123  ",
        "customer",
      );
    });
  });

  describe("cada sinal do erro, sozinho, basta", () => {
    it("e-mail não confirmado só pelo CÓDIGO (mensagem qualquer, status 400)", async () => {
      login.mockResolvedValue({
        success: false,
        error: { status: 400, code: "email_not_confirmed", message: "x" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toContain(FRASE_NAO_CONFIRMADO);
      expect(hospedeiro.textContent).toContain("Reenviar link de confirmação");
      expect(hospedeiro.textContent).not.toMatch(FRASE_CREDENCIAIS);
    });

    it("e-mail não confirmado só pela MENSAGEM (cliente antigo, sem code)", async () => {
      login.mockResolvedValue({
        success: false,
        error: { status: 400, message: "Email not confirmed" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toContain(FRASE_NAO_CONFIRMADO);
      expect(hospedeiro.textContent).toContain("Reenviar link de confirmação");
      expect(hospedeiro.textContent).not.toMatch(FRASE_CREDENCIAIS);
    });

    it("conta bloqueada só pelo CÓDIGO (status 400, mensagem qualquer): frase genérica, nunca 'incorretos'", async () => {
      login.mockResolvedValue({
        success: false,
        error: { status: 400, code: "user_banned", message: "x" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toMatch(FRASE_GENERICA);
      expect(hospedeiro.textContent).not.toMatch(FRASE_CREDENCIAIS);
    });

    it("conta bloqueada só pela MENSAGEM (status 400, sem code): frase genérica, nunca 'incorretos'", async () => {
      login.mockResolvedValue({
        success: false,
        error: { status: 400, message: "User is banned" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toMatch(FRASE_GENERICA);
      expect(hospedeiro.textContent).not.toMatch(FRASE_CREDENCIAIS);
    });

    it("credencial errada só pelo STATUS 400 (mensagem desconhecida)", async () => {
      login.mockResolvedValue({
        success: false,
        error: { status: 400, message: "mensagem-desconhecida" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toMatch(FRASE_CREDENCIAIS);
    });

    it("credencial errada só pela MENSAGEM (sem status)", async () => {
      login.mockResolvedValue({
        success: false,
        error: { message: "Invalid login credentials" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toMatch(FRASE_CREDENCIAIS);
    });

    it("limite de tentativas pelo STATUS 429, com qualquer mensagem", async () => {
      login.mockResolvedValue({
        success: false,
        error: { status: 429, message: "qualquer-coisa" },
      });
      await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(alerta()?.textContent).toBe(
        "Muitas tentativas. Tente novamente em alguns minutos.",
      );
      expect(alerta()?.textContent).toMatch(FRASE_LIMITE);
    });

    it.each([401, 403, 422, 500, 503])(
      "status %i sem outro sinal: frase genérica, nem 'incorretos' nem 'muitas tentativas'",
      async (status) => {
        login.mockResolvedValue({
          success: false,
          error: { status, message: "mensagem-desconhecida" },
        });
        await abrir();
        await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

        expect(alerta()?.textContent).toMatch(FRASE_GENERICA);
        expect(hospedeiro.textContent).not.toMatch(FRASE_CREDENCIAIS);
        expect(hospedeiro.textContent).not.toMatch(FRASE_LIMITE);
      },
    );
  });

  describe("depois de entrar", () => {
    it("com onSuccess: avisa, restaura o destino do Google e entrega a decisão à tela de cima", async () => {
      login.mockResolvedValue({ success: true });
      const onSuccess = vi.fn();
      const onNavigate = await abrir({ onSuccess });
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(toast.success).toHaveBeenCalledExactlyOnceWith(
        "Acesso concedido. Bem-vindo!",
      );
      expect(restaurarDestinoGoogle).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it("sem onSuccess: vai para o perfil", async () => {
      login.mockResolvedValue({ success: true });
      const onNavigate = await abrir();
      await entrar("pessoa.ficticia@exemplo.com", "senha-ficticia-1");

      expect(onNavigate).toHaveBeenCalledExactlyOnceWith("profile");
    });

    it("entrar que falha não avisa boas-vindas nem navega", async () => {
      login.mockResolvedValue({ success: false, error: { status: 400 } });
      const onSuccess = vi.fn();
      const onNavigate = await abrir({ onSuccess });
      await entrar("pessoa.ficticia@exemplo.com", "senha-errada-1");

      expect(toast.success).not.toHaveBeenCalled();
      expect(restaurarDestinoGoogle).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
    });
  });
});
