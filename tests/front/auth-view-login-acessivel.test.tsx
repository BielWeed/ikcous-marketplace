// @vitest-environment jsdom
//
// Login acessível: o olho de mostrar/ocultar senha precisa de nome e estado
// para leitor de tela, e o erro do login precisa ser ANUNCIADO (role=alert),
// como o aviso do link de recuperação já é. Render de verdade (jsdom), pelo
// fluxo real de estado — mesmo padrão de auth-view-reset-prompt-copy.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const login = vi.fn();

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

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AuthView — login acessível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => {
      raiz.render(<AuthView onNavigate={vi.fn()} />);
    });
  }

  it("o olho da senha tem nome e estado, e o estado acompanha o clique", async () => {
    await renderizar();
    const olho = document.querySelector(
      'button[aria-label="Mostrar senha"]',
    ) as HTMLButtonElement | null;
    expect(olho).not.toBeNull();
    expect(olho?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      olho?.click();
    });
    const aberto = document.querySelector(
      'button[aria-label="Ocultar senha"]',
    ) as HTMLButtonElement | null;
    expect(aberto).not.toBeNull();
    expect(aberto?.getAttribute("aria-pressed")).toBe("true");
  });

  it("o erro do login aparece como alerta", async () => {
    login.mockResolvedValue({
      success: false,
      error: { message: "Invalid login credentials", status: 400 },
    });
    await renderizar();
    await act(async () => {
      digitar("email", "alguem@example.com");
      digitar("password", "senha-errada-1");
    });
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(login).toHaveBeenCalled();
    const alertas = [...document.querySelectorAll('[role="alert"]')];
    expect(alertas.length).toBeGreaterThan(0);
    expect(alertas.some((a) => (a.textContent ?? "").trim().length > 0)).toBe(
      true,
    );
  });
});
