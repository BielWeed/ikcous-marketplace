// @vitest-environment jsdom
//
// CADASTRO, RECUPERAR SENHA e NOVA SENHA do cliente (AuthView) — bordas que
// sobreviviam à caça por mutação (o código de produção podia ser trocado e
// nenhum teste existente caía):
//
// - Cadastro: senha de 8 ESPAÇOS passava na conferência de tamanho; e-mail só de
//   espaços não pedia os campos; a conta nascia com e-mail/nome/WhatsApp sem
//   aparar; a senha de 8 caracteres com espaço no fim era contada aparada.
// - Recuperar: e-mail vazio, e-mail com espaços/maiúsculas, e a frase de erro
//   quando o servidor não manda texto.
// - Nova senha: a comparação exata das
//   duas senhas (maiúscula e espaço contam), o destino depois de trocar a senha
//   e o aviso "troca em andamento" que precisa ser desligado mesmo se der erro.
//
// Mesmo padrão de auth-view-cadastro-confirmacao-condicional-e-senha-minima
// (render de verdade, useAuth e sonner dublados). Só dados fictícios.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.fn();
const resetPassword = vi.fn();
const updatePassword = vi.fn();
let emRecuperacao = false;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: emRecuperacao ? { email: "pessoa.ficticia@exemplo.com" } : null,
    login: vi.fn(),
    signUp,
    resetPassword,
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
  useStore: () => ({ config: { storeCity: "Sao Paulo", storeState: "SP" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  const achado = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  expect(achado).toBeDefined();
  return achado as HTMLButtonElement;
}

type PropsDaTela = {
  onSuccess?: (origem?: "recuperacao") => void;
  onPasswordRecoveryPendingChange?: (pendente: boolean) => void;
};

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const MSG_CAMPOS = "Preencha todos os campos para o cadastro.";
const MSG_SENHA_CURTA = "A senha deve ter pelo menos 8 caracteres.";

describe("AuthView — cadastro, recuperar senha e nova senha: bordas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    emRecuperacao = false;
    signUp.mockReset().mockResolvedValue(true);
    resetPassword.mockReset();
    updatePassword.mockReset();
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

  async function abrir(props: PropsDaTela = {}) {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = vi.fn();
    await act(async () =>
      raiz.render(<AuthView onNavigate={onNavigate} {...props} />),
    );
    return onNavigate;
  }

  // Envia o formulário sem a validação nativa do navegador: é a defesa do
  // próprio código que se prova.
  async function enviarFormulario() {
    const form = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  }

  describe("cadastro", () => {
    async function abrirCadastro() {
      const onNavigate = await abrir();
      await act(async () => botao("CADASTRO").click());
      return onNavigate;
    }

    async function preencher(
      campos: Partial<
        Record<"fullName" | "phone" | "email" | "password", string>
      >,
    ) {
      const padrao = {
        fullName: "Pessoa Ficticia",
        phone: "11999999999",
        email: "pessoa.ficticia@exemplo.com",
        password: "senha-ficticia-1",
        ...campos,
      };
      await act(async () => {
        digitar("fullName", padrao.fullName);
        digitar("phone", padrao.phone);
        digitar("email", padrao.email);
        digitar("password", padrao.password);
      });
    }

    it("senha de 8 espaços não cria conta: pede os campos", async () => {
      await abrirCadastro();
      await preencher({ password: "        " });
      await enviarFormulario();

      expect(signUp).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(MSG_CAMPOS);
    });

    it("e-mail só de espaços não cria conta: pede os campos", async () => {
      await abrirCadastro();
      await preencher({ email: "   " });
      await enviarFormulario();

      expect(signUp).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(MSG_CAMPOS);
    });

    it("WhatsApp em branco pede os campos (e não a frase de número incompleto)", async () => {
      await abrirCadastro();
      await preencher({ phone: "" });
      await enviarFormulario();

      expect(signUp).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(MSG_CAMPOS);
    });

    it("limite: senha de 8 caracteres com espaço no fim vale 8 e vai ao servidor intacta", async () => {
      await abrirCadastro();
      await preencher({ password: "1234567 " });
      await enviarFormulario();

      expect(toast.error).not.toHaveBeenCalled();
      expect(signUp).toHaveBeenCalledTimes(1);
      expect(signUp.mock.calls[0]?.[1]).toBe("1234567 ");
    });

    it("limite: senha de 7 caracteres + espaço não vira 8 por conta do espaço", async () => {
      await abrirCadastro();
      await preencher({ password: "123456 " });
      await enviarFormulario();

      expect(signUp).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(MSG_SENHA_CURTA);
    });

    it("manda ao servidor o e-mail, o nome e o WhatsApp aparados e a senha como digitada", async () => {
      await abrirCadastro();
      await preencher({
        fullName: "  Pessoa Ficticia  ",
        phone: "11999999999",
        email: "  Pessoa.Ficticia@Exemplo.com  ",
        password: "  Senha Ficticia 1  ",
      });
      await enviarFormulario();

      expect(signUp).toHaveBeenCalledExactlyOnceWith(
        "Pessoa.Ficticia@Exemplo.com",
        "  Senha Ficticia 1  ",
        "Pessoa Ficticia",
        "(11) 99999-9999",
        undefined,
      );
    });

    it("o servidor recusar o cadastro (e-mail já cadastrado, limite) mantém o formulário preenchido, sem tela de confirmação", async () => {
      signUp.mockResolvedValue(false);
      await abrirCadastro();
      await preencher({});
      await enviarFormulario();

      expect(signUp).toHaveBeenCalledTimes(1);
      expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
      expect(campo("email").value).toBe("pessoa.ficticia@exemplo.com");
      expect(campo("fullName").value).toBe("Pessoa Ficticia");
      // O botão volta a funcionar (não fica preso em "enviando").
      const enviar = hospedeiro.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(enviar.disabled).toBe(false);
    });
  });

  describe("recuperar senha", () => {
    async function abrirRecuperar() {
      await abrir();
      await act(async () => botao("Esqueceu?").click());
    }

    it("e-mail em branco: avisa, não chama o servidor, e o botão não fica preso", async () => {
      await abrirRecuperar();
      await enviarFormulario();

      expect(resetPassword).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Informe seu e-mail para recuperação.",
      );
      const enviar = hospedeiro.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(enviar.disabled).toBe(false);

      // E o pedido seguinte, já com e-mail, sai normalmente.
      resetPassword.mockResolvedValue({ success: true, message: "ok" });
      await act(async () => digitar("email", "pessoa.ficticia@exemplo.com"));
      await enviarFormulario();
      expect(resetPassword).toHaveBeenCalledTimes(1);
    });

    it("e-mail só de espaços conta como em branco", async () => {
      await abrirRecuperar();
      await act(async () => digitar("email", "   "));
      await enviarFormulario();

      expect(resetPassword).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it("pede o link para o e-mail aparado, com as maiúsculas como digitadas", async () => {
      resetPassword.mockResolvedValue({ success: true, message: "ok" });
      await abrirRecuperar();
      await act(async () => digitar("email", "  Pessoa.Ficticia@Exemplo.com "));
      await enviarFormulario();

      expect(resetPassword).toHaveBeenCalledExactlyOnceWith(
        "Pessoa.Ficticia@Exemplo.com",
      );
      expect(hospedeiro.textContent).toContain("Verifique seu e-mail");
    });

    it("recusa com a frase do servidor: mostra essa frase e continua no formulário", async () => {
      resetPassword.mockResolvedValue({
        success: false,
        message: "Frase ficticia do aplicativo.",
      });
      await abrirRecuperar();
      await act(async () => digitar("email", "pessoa.ficticia@exemplo.com"));
      await enviarFormulario();

      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Frase ficticia do aplicativo.",
      );
      expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
      expect(campo("email").value).toBe("pessoa.ficticia@exemplo.com");
    });

    it("recusa sem frase nenhuma: usa a frase padrão, nunca um toast vazio", async () => {
      resetPassword.mockResolvedValue({ success: false });
      await abrirRecuperar();
      await act(async () => digitar("email", "pessoa.ficticia@exemplo.com"));
      await enviarFormulario();

      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Erro ao solicitar link de recuperação.",
      );
    });
  });

  describe("nova senha", () => {
    beforeEach(() => {
      emRecuperacao = true;
    });

    async function trocar(senha: string, confirmacao: string) {
      await act(async () => {
        digitar("password", senha);
        digitar("password-confirmacao", confirmacao);
      });
      await enviarFormulario();
    }

    it("a comparação é exata: maiúscula e espaço no fim contam como diferença", async () => {
      await abrir();
      await trocar("abcdefgh", "ABCDEFGH");
      expect(updatePassword).not.toHaveBeenCalled();

      await trocar("abcdefgh", "abcdefgh ");
      expect(updatePassword).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it("limite: 8 caracteres com espaço no fim valem 8 e vão ao servidor como digitados", async () => {
      updatePassword.mockResolvedValue(false);
      await abrir();
      await trocar("1234567 ", "1234567 ");

      expect(updatePassword).toHaveBeenCalledExactlyOnceWith("1234567 ");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("trocou: entrega 'recuperacao' à tela de cima e desliga o aviso de troca em andamento", async () => {
      updatePassword.mockResolvedValue(true);
      const onSuccess = vi.fn();
      const aviso = vi.fn();
      const onNavigate = await abrir({
        onSuccess,
        onPasswordRecoveryPendingChange: aviso,
      });
      await trocar("12345678", "12345678");

      expect(onSuccess).toHaveBeenCalledExactlyOnceWith("recuperacao");
      expect(onNavigate).not.toHaveBeenCalled();
      expect(aviso.mock.calls).toEqual([[true], [false]]);
    });

    it("trocou, sem tela de cima: vai para o perfil", async () => {
      updatePassword.mockResolvedValue(true);
      const onNavigate = await abrir();
      await trocar("12345678", "12345678");

      expect(onNavigate).toHaveBeenCalledExactlyOnceWith("profile");
    });

    it("o servidor recusou a troca: fica na tela, sem navegar, e desliga o aviso de troca em andamento", async () => {
      updatePassword.mockResolvedValue(false);
      const onSuccess = vi.fn();
      const aviso = vi.fn();
      const onNavigate = await abrir({
        onSuccess,
        onPasswordRecoveryPendingChange: aviso,
      });
      await trocar("12345678", "12345678");

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
      expect(aviso.mock.calls).toEqual([[true], [false]]);
      expect(hospedeiro.textContent).toContain("Nova Senha");
    });

    it("a troca que dá erro inesperado desliga o aviso, avisa a pessoa e libera nova tentativa", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      updatePassword.mockRejectedValueOnce(new Error("falha ficticia"));
      const aviso = vi.fn();
      await abrir({ onPasswordRecoveryPendingChange: aviso });
      await trocar("12345678", "12345678");

      expect(aviso.mock.calls).toEqual([[true], [false]]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Ocorreu um erro inesperado na autenticação.",
      );
      expect(hospedeiro.textContent).not.toContain("falha ficticia");

      updatePassword.mockResolvedValue(false);
      await enviarFormulario();
      expect(updatePassword).toHaveBeenCalledTimes(2);
    });

    it("não avisa 'troca em andamento' quando a recusa é local (senha curta)", async () => {
      const aviso = vi.fn();
      await abrir({ onPasswordRecoveryPendingChange: aviso });
      await trocar("123", "123");

      expect(aviso).not.toHaveBeenCalled();
    });
  });
});
