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
const logout = vi.fn().mockResolvedValue(undefined);
const recuperacao = { ativa: false };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
    signUp: vi.fn(),
    resetPassword,
    updatePassword: vi.fn(),
    logout,
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: recuperacao.ativa,
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
    // Só intervalos e a hora são falsos: o resto da suíte espera setTimeout
    // real. A contagem do reenvio lê a hora (`Date`), então ela anda junto.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    resetPassword.mockReset().mockResolvedValue(SUCESSO);
    logout.mockClear();
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

  it("sai da recuperação pelo login do painel, sem passar pelo cadastro de cliente", async () => {
    const { AuthView } = await import("@/views/shared/AuthView");
    const urlAnterior = globalThis.location.href;
    const estadoAnterior = globalThis.history.state;
    const navegar = vi.fn();
    const abrir = async (chave: string, url: string) => {
      navegar.mockClear();
      globalThis.history.replaceState(null, "", url);
      await act(async () =>
        raiz.render(<AuthView key={chave} onNavigate={navegar} />),
      );
    };
    const voltarAoPainel = async (texto: string) => {
      await act(async () => botaoQueComeca(texto)!.click());
      expect.soft(navegar).toHaveBeenLastCalledWith("admin-login");
      expect.soft(botaoQueComeca("CADASTRO")).toBeUndefined();
    };

    try {
      const pedido = "/auth?modo=recuperar&origem=painel";
      await abrir("pedido", pedido);
      await voltarAoPainel("Entrar");

      await abrir("confirmacao", pedido);
      await act(async () => digitar("email", "maria@example.com"));
      await act(async () => botaoQueComeca("SOLICITAR LINK")!.click());
      await voltarAoPainel("Voltar para o Login");

      expect(logout).not.toHaveBeenCalled();
      recuperacao.ativa = true;
      await abrir("nova-senha", "/auth?origem=painel");
      expect(hospedeiro.textContent).toContain("Nova Senha");
      await voltarAoPainel("Entrar");
      expect(logout).toHaveBeenCalledTimes(1);

      recuperacao.ativa = false;
      await abrir("vitrine", "/auth");
      await act(async () => botaoQueComeca("Esqueceu?")!.click());
      await act(async () => botaoQueComeca("Entrar")!.click());
      expect(navegar).not.toHaveBeenCalled();
      expect(botaoQueComeca("CADASTRO")).toBeDefined();
    } finally {
      recuperacao.ativa = false;
      globalThis.history.replaceState(estadoAnterior, "", urlAnterior);
    }
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

  it("o formulário respeita o reenvio pendente só para o mesmo endereço", async () => {
    await chegarNaTelaDeConfirmacao();
    await passarOIntervalo();
    const { promessa, resolver } = criarEnvioPendente();
    resetPassword.mockReturnValueOnce(promessa);
    await act(async () => botaoQueComeca("Reenviar link")!.click());
    await act(async () => botaoQueComeca("Corrigir e-mail")!.click());
    await act(async () => digitar("email", " MARIA@gmial.com "));

    try {
      const formulario = hospedeiro.querySelector("form")!;
      const enviar = formulario.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      await act(async () => {
        enviar.click();
        formulario.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      expect(resetPassword).toHaveBeenCalledTimes(2);
      expect(enviar.disabled).toBe(true);
      expect(enviar.textContent).toContain("Enviando o link");

      await act(async () => digitar("email", "maria@gmail.com"));
      expect(enviar.disabled).toBe(false);
      await act(async () => enviar.click());
      expect(resetPassword).toHaveBeenCalledTimes(3);
      expect(resetPassword).toHaveBeenLastCalledWith("maria@gmail.com");
      expect(hospedeiro.textContent).toContain("maria@gmail.com");
    } finally {
      await act(async () => resolver(SUCESSO));
    }

    await act(async () => botaoQueComeca("Corrigir e-mail")!.click());
    await act(async () => digitar("email", "maria@gmial.com"));
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 60 s.",
    );
  });

  it("um pedido pendente no formulário não bloqueia outro endereço nem troca a tela dele", async () => {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => raiz.render(<AuthView onNavigate={vi.fn()} />));
    await act(async () => botaoQueComeca("Esqueceu?")!.click());
    await act(async () => digitar("email", "maria@gmial.com"));

    const original = criarEnvioPendente();
    resetPassword.mockReturnValueOnce(original.promessa);
    await act(async () => botaoQueComeca("SOLICITAR LINK")!.click());
    expect(resetPassword).toHaveBeenCalledTimes(1);
    try {
      await act(async () => digitar("email", "maria@gmail.com"));
      const enviar = hospedeiro.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      expect(enviar.disabled).toBe(false);

      const corrigido = criarEnvioPendente();
      resetPassword.mockReturnValueOnce(corrigido.promessa);
      await act(async () => enviar.click());
      try {
        expect(resetPassword).toHaveBeenLastCalledWith("maria@gmail.com");
        await act(async () => original.resolver(SUCESSO));
        expect(hospedeiro.textContent).not.toContain("Verifique seu e-mail");
        expect(enviar.disabled).toBe(true);
      } finally {
        await act(async () => corrigido.resolver(SUCESSO));
      }
      expect(hospedeiro.textContent).toContain("maria@gmail.com");
    } finally {
      await act(async () => original.resolver(SUCESSO));
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

  it("o formulário mantém a espera do mesmo endereço e libera após 60 s", async () => {
    await chegarNaTelaDeConfirmacao();
    await act(async () => vi.advanceTimersByTime(10_000));
    await act(async () => botaoQueComeca("Corrigir e-mail")!.click());

    const enviar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    await act(async () => enviar.click());
    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 50 s.",
    );

    await act(async () => digitar("email", " MARIA@gmial.com "));
    // O bloqueio é também no formulário, não só no clique do botão.
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(enviar.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTime(49_000));
    expect(enviar.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(enviar.disabled).toBe(false);
    await act(async () => enviar.click());
    expect(resetPassword).toHaveBeenCalledTimes(2);
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
    // E o intervalo recomeça para o novo envio, sem apagar o do anterior.
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
    await act(async () => botaoQueComeca("Corrigir e-mail")!.click());
    await act(async () => digitar("email", "maria@gmial.com"));
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 60 s.",
    );
  });
});
