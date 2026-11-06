// @vitest-environment jsdom
//
// Cadastro: WhatsApp incompleto e senha curta só apareciam num aviso que some
// (toast), sem marcar nem levar a pessoa ao campo — quem rolou a tela até o
// botão não sabia QUAL campo estava errado. Agora, além do toast (que fica),
// o campo ganha aria-invalid, uma mensagem logo abaixo e o foco; o foco vai
// para o PRIMEIRO campo inválido na ordem da tela (WhatsApp, CPF, senha).
//
// Só aviso/foco/rótulo: a regra (celular completo, 8 caracteres) e o que vai
// ao servidor não mudaram — o teste de limite confere isso.
//
// Mesmo padrão de auth-view-cadastro-confirmacao-condicional-e-senha-minima.test.tsx.
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

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const invalido = (id: string) => campo(id).getAttribute("aria-invalid");
const descritoPor = (id: string) =>
  (campo(id).getAttribute("aria-describedby") ?? "").split(/\s+/);

describe("AuthView — cadastro: WhatsApp e senha inválidos marcam e focam o campo", () => {
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

  async function preencherEEnviar(dados: {
    phone?: string;
    password?: string;
    cpf?: string;
  }) {
    await act(async () => {
      digitar("fullName", "Pessoa Teste");
      digitar("phone", dados.phone ?? "11999999999");
      if (dados.cpf !== undefined) digitar("cpf", dados.cpf);
      digitar("email", "pessoa@example.com");
      digitar("password", dados.password ?? "12345678");
    });
    await act(async () => localizarBotaoPorTexto("FINALIZAR REGISTRO").click());
  }

  describe("WhatsApp incompleto", () => {
    it("marca o campo, mostra a mensagem perto dele, foca nele e mantém o toast", async () => {
      await abrirCadastro();
      await preencherEEnviar({ phone: "1199" });

      expect(signUp).not.toHaveBeenCalled();
      expect(invalido("phone")).toBe("true");
      expect(document.activeElement).toBe(campo("phone"));

      const idDoErro = descritoPor("phone").find((id) => id !== "");
      expect(idDoErro).toBeTruthy();
      const mensagem = document.getElementById(idDoErro!);
      expect(mensagem?.textContent).toMatch(/Confira o WhatsApp/);
      // a mensagem mora no mesmo bloco do campo (perto dele), não no fim da tela
      expect(mensagem?.parentElement?.contains(campo("phone"))).toBe(true);

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
        /Confira o WhatsApp/,
      );
    });

    it("limite: fixo de 10 dígitos diz 'faltou um número' no campo, igual ao toast", async () => {
      await abrirCadastro();
      await preencherEEnviar({ phone: "1133334444" });

      expect(invalido("phone")).toBe("true");
      const idDoErro = descritoPor("phone").find((id) => id !== "");
      expect(document.getElementById(idDoErro!)?.textContent).toMatch(
        /faltou um número/,
      );
    });

    it("voltar a digitar no WhatsApp limpa a marca e a mensagem", async () => {
      await abrirCadastro();
      await preencherEEnviar({ phone: "1199" });
      expect(invalido("phone")).toBe("true");

      await act(async () => digitar("phone", "11999"));

      expect(invalido("phone")).not.toBe("true");
      expect(descritoPor("phone").filter((id) => id !== "")).toEqual([]);
      expect(hospedeiro.textContent).not.toMatch(/Confira o WhatsApp/);
    });
  });

  describe("senha curta", () => {
    it("marca o campo, mostra a mensagem perto dele, foca nele e mantém o toast", async () => {
      await abrirCadastro();
      await preencherEEnviar({ password: "1234567" });

      expect(signUp).not.toHaveBeenCalled();
      expect(invalido("password")).toBe("true");
      expect(document.activeElement).toBe(campo("password"));
      // o WhatsApp está certo: não pode aparecer marcado
      expect(invalido("phone")).not.toBe("true");

      const ids = descritoPor("password");
      // a dica "Mínimo 8 caracteres" continua ligada, e o erro entra junto
      expect(ids).toContain("password-dica");
      const idDoErro = ids.find((id) => id !== "" && id !== "password-dica");
      expect(idDoErro).toBeTruthy();
      expect(document.getElementById(idDoErro!)?.textContent).toMatch(
        /pelo menos 8 caracteres/i,
      );

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
        /pelo menos 8 caracteres/i,
      );
    });

    it("voltar a digitar na senha limpa a marca e a mensagem, mas a dica fica", async () => {
      await abrirCadastro();
      await preencherEEnviar({ password: "1234567" });
      expect(invalido("password")).toBe("true");

      await act(async () => digitar("password", "12345678"));

      expect(invalido("password")).not.toBe("true");
      expect(descritoPor("password")).toEqual(["password-dica"]);
    });
  });

  describe("mais de um campo inválido", () => {
    it("WhatsApp e senha errados: os dois ficam marcados e o foco vai para o primeiro da tela (WhatsApp)", async () => {
      await abrirCadastro();
      await preencherEEnviar({ phone: "1199", password: "123" });

      expect(invalido("phone")).toBe("true");
      expect(invalido("password")).toBe("true");
      expect(document.activeElement).toBe(campo("phone"));
      expect(signUp).not.toHaveBeenCalled();
    });

    it("CPF inválido e senha curta: o foco vai para o CPF, que vem antes na tela", async () => {
      await abrirCadastro();
      await preencherEEnviar({ cpf: "111.111.111-11", password: "123" });

      expect(invalido("cpf")).toBe("true");
      expect(invalido("password")).toBe("true");
      expect(document.activeElement).toBe(campo("cpf"));
      expect(signUp).not.toHaveBeenCalled();
    });
  });

  describe("o que NÃO mudou", () => {
    it("tudo certo: nada marcado e o cadastro vai ao servidor com os mesmos dados", async () => {
      await abrirCadastro();
      await preencherEEnviar({ phone: "11999999999", password: "12345678" });

      expect(signUp).toHaveBeenCalledTimes(1);
      expect(signUp.mock.calls[0]?.[0]).toBe("pessoa@example.com");
      expect(signUp.mock.calls[0]?.[1]).toBe("12345678");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("corrigir e reenviar depois de um erro funciona (o erro não 'gruda')", async () => {
      await abrirCadastro();
      await preencherEEnviar({ phone: "1199" });
      expect(signUp).not.toHaveBeenCalled();

      await act(async () => digitar("phone", "11999999999"));
      await act(async () =>
        localizarBotaoPorTexto("FINALIZAR REGISTRO").click(),
      );

      expect(signUp).toHaveBeenCalledTimes(1);
    });

    it("no login não aparece nenhuma marca de erro nos campos", async () => {
      const { AuthView } = await import("@/views/shared/AuthView");
      await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
      expect(invalido("password")).not.toBe("true");
      expect(descritoPor("password").filter((id) => id !== "")).toEqual([]);
    });
  });
});
