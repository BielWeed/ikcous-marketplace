// @vitest-environment jsdom
//
// Prova de mutação (24/11/2026): trocar `Math.ceil` por `Math.floor` em
// `useEsperaDoReenvio` (AuthView) não derrubava nenhum dos 9 testes da contagem
// — todos andam o relógio em segundos INTEIROS. Na vida real a hora cai no meio
// do segundo (o tique atrasa, a pessoa volta ao app aos 59,5 s). Com `floor` a
// espera de 59,5 s virava 0: a tela libertava o botão meio segundo ANTES do
// fim da trava de 60 s (que existe para a pessoa não martelar o envio), e a
// contagem mostrava 39 onde faltavam 39,8.
//
// Regra: o que falta arredonda PARA CIMA — nunca libera antes, nunca mostra 0.
//
// Harness copiado de auth-view-contagem-do-reenvio-segue-o-relogio-real.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
  expect(hospedeiro.textContent).toContain("Dá para pedir outro link em 60 s.");
}

/** A hora anda um tanto quebrado de segundo; nenhum tique roda. */
async function voltarAoAppDepoisDe(milissegundos: number) {
  vi.setSystemTime(Date.now() + milissegundos);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

it("faltando 0,5 s a trava de 60 s ainda vale: o botão fica apagado e a contagem diz 1 s", async () => {
  await chegarNaTelaDeConfirmacao();

  await voltarAoAppDepoisDe(59_500);

  expect(botaoQueComeca("Reenviar link")!.disabled).toBe(true);
  expect(hospedeiro.textContent).toContain("Dá para pedir outro link em 1 s.");
});

it("faltando 39,8 s a contagem mostra 40 (arredonda para cima), não 39", async () => {
  await chegarNaTelaDeConfirmacao();

  await voltarAoAppDepoisDe(20_200);

  expect(hospedeiro.textContent).toContain("Dá para pedir outro link em 40 s.");
});

it("limite: passados os 60 s inteiros o botão libera", async () => {
  await chegarNaTelaDeConfirmacao();

  await voltarAoAppDepoisDe(60_000);

  expect(botaoQueComeca("Reenviar link")!.disabled).toBe(false);
  expect(hospedeiro.textContent).not.toContain("Dá para pedir outro link");
});
