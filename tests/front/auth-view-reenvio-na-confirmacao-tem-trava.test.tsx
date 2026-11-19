// @vitest-environment jsdom
// Issue #208 — o reenvio depois do cadastro usa a mesma trava do login.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.fn();
const login = vi.fn();
const resendConfirmationEmail = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp,
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail,
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

function criarReenvioPendente() {
  let resolver!: (valor: boolean) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<boolean>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  resendConfirmationEmail.mockReturnValue(promessa);
  return { resolver, rejeitar };
}

describe("AuthView — reenvio na confirmação tem trava (issue #208)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    signUp.mockReset().mockResolvedValue(true);
    login.mockReset().mockResolvedValue({
      success: false,
      error: { status: 400, code: "email_not_confirmed" },
    });
    resendConfirmationEmail.mockReset();
    vi.mocked(toast.error).mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function cadastrar() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => localizarBotaoPorTexto("CADASTRO").click());
    await act(async () => {
      digitar("fullName", "Pessoa Teste");
      digitar("phone", "11999999999");
      digitar("email", "pessoa@example.com");
      digitar("password", "senha12345");
    });
    await act(async () => localizarBotaoPorTexto("FINALIZAR REGISTRO").click());
    expect(signUp).toHaveBeenCalledWith(
      "pessoa@example.com",
      "senha12345",
      "Pessoa Teste",
      "(11) 99999-9999",
      // CPF opcional (23/09/2026): cadastro sem CPF digitado passa undefined.
      undefined,
    );
    expect(hospedeiro.textContent).toContain("Verifique seu e-mail");
    return localizarBotaoPorTexto("Reenviar link");
  }

  it("dois cliques rápidos disparam um único reenvio antes do próximo render", async () => {
    const { resolver } = criarReenvioPendente();
    const botao = await cadastrar();
    await act(async () => {
      botao.click();
      botao.click();
    });
    try {
      expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
      expect(resendConfirmationEmail).toHaveBeenCalledWith(
        "pessoa@example.com",
      );
    } finally {
      await act(async () => resolver(true));
    }
  });

  it("desabilita o botão e mostra Reenviando... enquanto a promise está pendente", async () => {
    const { resolver } = criarReenvioPendente();
    const botao = await cadastrar();
    await act(async () => botao.click());
    try {
      expect(botao.disabled).toBe(true);
      expect(botao.textContent).toBe("Reenviando...");
    } finally {
      await act(async () => resolver(true));
    }
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toBe("Reenviar em 30s");
    await act(async () => botao.click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(botao.textContent).toBe("Reenviar em 29s");
    await act(async () => vi.advanceTimersByTime(28_000));
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toBe("Reenviar em 1s");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(botao.disabled).toBe(false);
    expect(botao.textContent).toBe("Reenviar link");
    resendConfirmationEmail.mockResolvedValue(true);
    await act(async () => botao.click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(2);
    expect(botao.textContent).toBe("Reenviar em 30s");
  });

  it("a espera da confirmação continua no login só para o mesmo endereço", async () => {
    resendConfirmationEmail.mockResolvedValue(true);
    const botao = await cadastrar();
    await act(async () => botao.click());
    expect(botao.textContent).toBe("Reenviar em 30s");
    await act(async () => vi.advanceTimersByTime(5_000));
    await act(async () => localizarBotaoPorTexto("Retornar ao Login").click());
    expect(document.querySelector<HTMLInputElement>("#email")?.value).toBe(
      "pessoa@example.com",
    );
    expect(document.querySelector<HTMLInputElement>("#password")?.value).toBe(
      "",
    );

    async function entrarComo(email: string) {
      await act(async () => {
        digitar("email", email);
        digitar("password", "senha12345");
      });
      await act(async () => localizarBotaoPorTexto("ENTRAR AGORA").click());
    }

    await entrarComo("outro@example.com");
    expect(
      localizarBotaoPorTexto("Reenviar link de confirmação").disabled,
    ).toBe(false);

    await entrarComo(" PESSOA@example.com ");
    const reenviar = localizarBotaoPorTexto("Reenviar em 25s");
    expect(reenviar.disabled).toBe(true);
    await act(async () => reenviar.click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(25_000));
    expect(
      localizarBotaoPorTexto("Reenviar link de confirmação").disabled,
    ).toBe(false);
  });

  it("resposta sem sucesso não inicia a contagem", async () => {
    resendConfirmationEmail.mockResolvedValue(false);
    const botao = await cadastrar();
    await act(async () => botao.click());
    expect(botao.disabled).toBe(false);
    expect(botao.textContent).toBe("Reenviar link");
  });

  it("limpa o intervalo ao desmontar durante a espera", async () => {
    const iniciar = vi.spyOn(globalThis, "setInterval");
    const limpar = vi.spyOn(globalThis, "clearInterval");
    resendConfirmationEmail.mockResolvedValue(true);
    const botao = await cadastrar();
    await act(async () => botao.click());
    const indice = iniciar.mock.calls.findIndex(
      (chamada) => chamada[1] === 1000,
    );
    expect(indice).toBeGreaterThanOrEqual(0);
    // eslint-disable-next-line security/detect-object-injection -- teste: entrada fixa, sem dado de usuário
    const intervalo = iniciar.mock.results[indice].value;
    act(() => raiz.unmount());
    expect(limpar).toHaveBeenCalledWith(intervalo);
    raiz = createRoot(hospedeiro);
  });

  it("rejeição mostra o erro traduzido e libera uma nova tentativa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rejeitar } = criarReenvioPendente();
    const botao = await cadastrar();
    await act(async () => botao.click());
    await act(async () => rejeitar(new Error("falha de rede")));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Não foi possível reenviar o e-mail de confirmação. Tente novamente.",
    );
    expect(botao.disabled).toBe(false);
    expect(botao.textContent).toBe("Reenviar link");
    resendConfirmationEmail.mockResolvedValue(true);
    await act(async () => botao.click());
    expect(resendConfirmationEmail).toHaveBeenCalledTimes(2);
    expect(botao.disabled).toBe(true);
    await act(async () => localizarBotaoPorTexto("Retornar ao Login").click());
    expect(hospedeiro.textContent).not.toContain(
      "Não foi possível reenviar o e-mail de confirmação. Tente novamente.",
    );
  });
});
