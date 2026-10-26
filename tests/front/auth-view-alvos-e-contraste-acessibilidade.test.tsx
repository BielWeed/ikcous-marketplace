// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 4: links pequenos e claros demais na entrada
// (Esqueceu?, CADASTRO, Reenviar link), rótulos 10 px em zinc-400 (2,56:1) e um
// botão de enviar que, com o spinner, ficava sem nome para o leitor de tela.
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

describe("AuthView — alvos, contraste e botão de enviar falado", () => {
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

  const porTexto = (t: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === t,
    );

  it("Esqueceu? e CADASTRO têm alvo de 44 px sem mover o desenho, e Esqueceu? é legível", async () => {
    await renderizar();
    const esqueceu = porTexto("Esqueceu?");
    const cadastro = porTexto("CADASTRO");
    expect(esqueceu).toBeDefined();
    expect(cadastro).toBeDefined();
    for (const b of [esqueceu!, cadastro!]) {
      expect(b.className).toContain("relative");
      expect(b.className).toContain("after:-inset-y-3.5");
    }
    expect(esqueceu!.className).toContain("text-zinc-700");
    expect(esqueceu!.className).not.toContain("text-zinc-400");
  });

  it("os rótulos dos campos não usam mais zinc-400", async () => {
    await renderizar();
    const rotulos = [...document.querySelectorAll("label")];
    expect(rotulos.length).toBeGreaterThan(0);
    for (const r of rotulos) {
      expect(r.className).not.toContain("text-zinc-400");
    }
  });

  it("enquanto entra, o botão de enviar diz o que está fazendo", async () => {
    login.mockReturnValue(new Promise(() => {}));
    await renderizar();
    await act(async () => {
      digitar("email", "alguem@example.com");
      digitar("password", "senha-qualquer-1");
    });
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
      await esperarMicrotarefas();
    });
    const enviar = form.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    const falado = enviar.querySelector(".sr-only");
    expect(falado?.textContent).toBe("Entrando…");
  });
});
