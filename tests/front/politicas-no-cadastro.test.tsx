// @vitest-environment jsdom
//
// ENTRAR e CADASTRAR: a cliente lê, junto do botão, "Ao <entrar | criar sua
// conta> você concorda com os Termos de uso e a Política de Privacidade",
// com os dois links. Os links abrem folha POR CIMA: o que ela já digitou no
// cadastro (nome, e-mail, senha) não pode se perder. Harness herdado de
// `auth-view-subtitulo-segue-a-loja`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

const signUp = vi.fn();
const login = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
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
let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({ data: null, error: { message: "fora do ar" } }),
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AuthView — termos e privacidade junto do botão de entrar/cadastrar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = { storeName: "Loja da Ana" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { AuthView } = await import("@/views/shared/AuthView");
    await act(async () => {
      raiz.render(<AuthView onNavigate={onNavigate} />);
    });
  }

  const frase = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="frase-de-aceite"]');

  function botaoPorTexto(texto: string): HTMLButtonElement {
    const achado = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(achado, `botão "${texto}"`).toBeDefined();
    return achado as HTMLButtonElement;
  }

  async function irParaCadastro() {
    await act(async () => {
      botaoPorTexto("CADASTRO").click();
    });
  }

  async function digitar(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function aguardarFolha(): Promise<Element> {
    for (let i = 0; i < 80; i++) {
      const f = document.querySelector('[data-testid="folha-politica"]');
      if (f) return f;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    throw new Error("a folha da política não abriu");
  }

  it("login: 'Ao entrar você concorda…' antes do botão ENTRAR AGORA", async () => {
    await montar();
    expect(frase()?.textContent).toBe(
      "Ao entrar você concorda com os Termos de uso e a Política de Privacidade.",
    );
    const entrar = botaoPorTexto("ENTRAR AGORA");
    expect(
      (frase() as Node).compareDocumentPosition(entrar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("cadastro: 'Ao criar sua conta você concorda…' antes do botão FINALIZAR REGISTRO", async () => {
    await montar();
    await irParaCadastro();
    expect(frase()?.textContent).toBe(
      "Ao criar sua conta você concorda com os Termos de uso e a Política de Privacidade.",
    );
    const finalizar = botaoPorTexto("FINALIZAR REGISTRO");
    expect(
      (frase() as Node).compareDocumentPosition(finalizar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(hospedeiro.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("recuperar senha NÃO mostra a frase (ali ninguém entra nem cria conta)", async () => {
    await montar();
    // O atalho "Esqueceu?" existe no login.
    await act(async () => {
      botaoPorTexto("Esqueceu?").click();
    });
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Recuperar");
    expect(frase()).toBeNull();
  });

  it("o que a cliente digitou no cadastro sobrevive a abrir e fechar os termos", async () => {
    await montar();
    await irParaCadastro();
    const nome = hospedeiro.querySelector(
      'input[placeholder="Seu nome"]',
    ) as HTMLInputElement;
    const email = hospedeiro.querySelector(
      'input[placeholder="seu@email.com"]',
    ) as HTMLInputElement;
    await digitar(nome, "Maria da Silva");
    await digitar(email, "maria@exemplo.com");

    await act(async () => {
      (frase()?.querySelector("button") as HTMLButtonElement).click();
    });
    const folha = await aguardarFolha();
    expect(folha.textContent).toContain("Termos de uso");
    expect(folha.textContent).toContain("Loja da Ana");
    // Nada navegou, ninguém foi cadastrado, e o formulário está de pé.
    expect(onNavigate).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector('input[placeholder="Seu nome"]')).toBe(
      nome,
    );

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    expect(nome.value).toBe("Maria da Silva");
    expect(email.value).toBe("maria@exemplo.com");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
