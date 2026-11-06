// @vitest-environment jsdom
//
// A TELA "VERIFIQUE SEU E-MAIL" DA RECUPERAÇÃO ERA BECO SEM SAÍDA.
//
// O único botão era "Voltar para o Login". Quem digitou o e-mail errado, ou
// cujo e-mail caiu no spam, ou que apagou a mensagem sem querer, tinha de
// voltar e refazer o caminho todo. Agora a tela traz: reenviar o link (com
// trava contra clique duplo e um intervalo entre reenvios), o aviso da pasta
// de spam e "Corrigir e-mail", que volta ao campo já preenchido.
//
// Regra de enumeração (#120): a tela e o reenvio nunca revelam se o e-mail tem
// conta nem ecoam o tempo de espera do servidor; o intervalo é fixo e do app.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetPassword = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp: vi.fn(),
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

const SUCESSO = {
  success: true,
  status: "success" as const,
  message:
    "Se este e-mail estiver cadastrado, enviamos um link de recuperação.",
};
const FALHA = {
  success: false,
  status: "error" as const,
  message:
    "Não foi possível enviar o link de recuperação agora. Tente novamente em instantes.",
};

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoQueComeca(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(texto),
  ) as HTMLButtonElement | undefined;
}

function criarEnvioPendente() {
  let resolver!: (valor: typeof SUCESSO | typeof FALHA) => void;
  const promessa = new Promise<typeof SUCESSO | typeof FALHA>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("AuthView — recuperação: reenviar, spam e corrigir o e-mail", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Só os intervalos são falsos: o resto da suíte espera setTimeout real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    resetPassword.mockReset().mockResolvedValue(SUCESSO);
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
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

  async function chegarNaTelaDeConfirmacao() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => botaoQueComeca("Esqueceu?")!.click());
    await act(async () => digitar("email", "maria@gmial.com"));
    await act(async () => botaoQueComeca("SOLICITAR LINK")!.click());
    expect(hospedeiro.textContent).toContain("Verifique seu e-mail");
    expect(resetPassword).toHaveBeenCalledTimes(1);
  }

  async function passarOIntervalo() {
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
  }

  it("avisa da pasta de spam e oferece reenviar e corrigir", async () => {
    await chegarNaTelaDeConfirmacao();
    expect(hospedeiro.textContent).toMatch(/spam/i);
    expect(botaoQueComeca("Reenviar link")).toBeDefined();
    expect(botaoQueComeca("Corrigir e-mail")).toBeDefined();
    expect(botaoQueComeca("Voltar para o Login")).toBeDefined();
  });

  it("logo depois do primeiro envio o reenvio espera o intervalo e depois libera", async () => {
    await chegarNaTelaDeConfirmacao();
    const reenviar = botaoQueComeca("Reenviar link")!;
    expect(reenviar.disabled).toBe(true);
    await act(async () => reenviar.click());
    expect(resetPassword).toHaveBeenCalledTimes(1);

    await passarOIntervalo();
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  });

  it("reenviar chama resetPassword com o MESMO e-mail da confirmação e volta a esperar", async () => {
    await chegarNaTelaDeConfirmacao();
    await passarOIntervalo();
    await act(async () => botaoQueComeca("Reenviar link")!.click());

    expect(resetPassword).toHaveBeenCalledTimes(2);
    expect(resetPassword).toHaveBeenLastCalledWith("maria@gmial.com");
    expect(toast.success).toHaveBeenLastCalledWith(SUCESSO.message);
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
  });

  it("dois cliques antes do próximo render disparam um único reenvio", async () => {
    await chegarNaTelaDeConfirmacao();
    await passarOIntervalo();
    const { promessa, resolver } = criarEnvioPendente();
    resetPassword.mockReturnValueOnce(promessa);
    const reenviar = botaoQueComeca("Reenviar link")!;
    await act(async () => {
      reenviar.click();
      reenviar.click();
    });
    try {
      expect(resetPassword).toHaveBeenCalledTimes(2); // 1 do pedido + 1 do reenvio
      expect(reenviar.disabled).toBe(true);
      expect(reenviar.textContent).toBe("Reenviando...");
    } finally {
      await act(async () => resolver(SUCESSO));
    }
  });

  it("falha no reenvio mostra o erro genérico e também espera (não convida a martelar o servidor)", async () => {
    await chegarNaTelaDeConfirmacao();
    await passarOIntervalo();
    resetPassword.mockResolvedValueOnce(FALHA);
    await act(async () => botaoQueComeca("Reenviar link")!.click());

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(FALHA.message);
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/\d+ segundos|seconds/i),
    );
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
    await passarOIntervalo();
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  });

  it("resetPassword que LANÇA não deixa o botão preso nem vira erro não tratado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await chegarNaTelaDeConfirmacao();
    await passarOIntervalo();
    resetPassword.mockRejectedValueOnce(new Error("falha de rede"));
    await act(async () => botaoQueComeca("Reenviar link")!.click());

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.error).mock.calls[0]?.[0])).not.toMatch(
      /falha de rede/,
    );
    await passarOIntervalo();
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  });

  it("'Corrigir e-mail' volta ao campo de recuperação com o e-mail digitado preservado", async () => {
    await chegarNaTelaDeConfirmacao();
    await act(async () => botaoQueComeca("Corrigir e-mail")!.click());

    expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
    expect(hospedeiro.textContent).toContain("Recuperar");
    expect((document.getElementById("email") as HTMLInputElement).value).toBe(
      "maria@gmial.com",
    );
    // Corrigido e enviado de novo: pede outro link para o endereço novo.
    await act(async () => digitar("email", "maria@gmail.com"));
    await act(async () => botaoQueComeca("SOLICITAR LINK")!.click());
    expect(resetPassword).toHaveBeenLastCalledWith("maria@gmail.com");
    expect(hospedeiro.textContent).toContain("maria@gmail.com");
    // E o intervalo recomeça para o novo envio.
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
  });
});
