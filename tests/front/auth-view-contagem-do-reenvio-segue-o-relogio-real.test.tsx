// @vitest-environment jsdom
//
// A CONTAGEM "DÁ PARA PEDIR OUTRO LINK EM N s" SEGUE O RELÓGIO REAL.
//
// Antes ela descontava 1 a cada tique do `setInterval`. Celular com a tela
// bloqueada, ou o app em segundo plano (a pessoa foi ao e-mail procurar a
// mensagem), congela esses tiques: 3 minutos depois a tela ainda dizia
// "em 52 s" e o botão seguia apagado. Agora a espera tem HORA DE TÉRMINO, e
// cada tique (e a volta do app à frente) calcula o que falta pela hora de
// verdade.
//
// O relógio é falso (Date + intervalos): "o app ficou em segundo plano" é
// pular a hora SEM disparar nenhum tique.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
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

describe("AuthView — a espera para pedir outro link conta pela hora real", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    resetPassword.mockReset().mockResolvedValue(SUCESSO);
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
    await act(async () => digitar("email", "maria@example.com"));
    await act(async () => botaoQueComeca("SOLICITAR LINK")!.click());
    expect(hospedeiro.textContent).toContain("Verifique seu e-mail");
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 60 s.",
    );
  }

  /** Segundo plano: a hora anda, nenhum tique roda. */
  function ficarEmSegundoPlano(segundos: number) {
    vi.setSystemTime(Date.now() + segundos * 1000);
  }

  async function voltarParaOApp(evento: "visibilitychange" | "pageshow") {
    await act(async () => {
      if (evento === "visibilitychange") {
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.dispatchEvent(new Event("pageshow"));
      }
    });
  }

  it("3 minutos em segundo plano: ao voltar à frente o botão já está liberado", async () => {
    await chegarNaTelaDeConfirmacao();
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);

    ficarEmSegundoPlano(180);
    await voltarParaOApp("visibilitychange");

    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
    expect(hospedeiro.textContent).not.toContain("Dá para pedir outro link");
  });

  it("20 s em segundo plano: ao voltar mostra o que falta de verdade (40 s), não 60", async () => {
    await chegarNaTelaDeConfirmacao();

    ficarEmSegundoPlano(20);
    await voltarParaOApp("visibilitychange");

    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 40 s.",
    );
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
  });

  it("voltar pelo histórico do navegador (pageshow) também confere a hora", async () => {
    await chegarNaTelaDeConfirmacao();

    ficarEmSegundoPlano(180);
    await voltarParaOApp("pageshow");

    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  });

  it("sem nenhum evento, o PRIMEIRO tique depois do congelamento já corrige (não desconta só 1)", async () => {
    await chegarNaTelaDeConfirmacao();

    ficarEmSegundoPlano(180);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
    expect(hospedeiro.textContent).not.toContain("Dá para pedir outro link");
  });

  it("sem segundo plano, a contagem desce pela hora e libera aos 60 s", async () => {
    await chegarNaTelaDeConfirmacao();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 50 s.",
    );

    await act(async () => {
      vi.advanceTimersByTime(50_000);
    });
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  });

  it("limite: voltar ao app ANTES do fim não libera o botão (a trava de 60 s continua valendo)", async () => {
    await chegarNaTelaDeConfirmacao();

    ficarEmSegundoPlano(59);
    await voltarParaOApp("visibilitychange");

    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 1 s.",
    );
  });

  it("limite: a hora do aparelho voltou para trás — a contagem nunca passa de 60 s", async () => {
    await chegarNaTelaDeConfirmacao();

    ficarEmSegundoPlano(-3600);
    await voltarParaOApp("visibilitychange");

    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 60 s.",
    );
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
  });

  it("depois de liberar e reenviar, a espera recomeça cheia (60 s) pela hora nova", async () => {
    await chegarNaTelaDeConfirmacao();
    ficarEmSegundoPlano(180);
    await voltarParaOApp("visibilitychange");

    await act(async () => botaoQueComeca("Reenviar link")!.click());
    expect(resetPassword).toHaveBeenCalledTimes(2);
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain(
      "Dá para pedir outro link em 60 s.",
    );

    ficarEmSegundoPlano(61);
    await voltarParaOApp("visibilitychange");
    expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  });

  it("clique no reenvio durante a espera (botão apagado) não dispara pedido nenhum", async () => {
    await chegarNaTelaDeConfirmacao();

    await act(async () => botaoQueComeca("Reenviar link")!.click());

    expect(resetPassword).toHaveBeenCalledTimes(1);
  });
});
