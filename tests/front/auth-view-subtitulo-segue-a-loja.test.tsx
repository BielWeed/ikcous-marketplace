// @vitest-environment jsdom
//
// PEÇA 4 (12/09/2026) — a mini-descrição da tela de login era cravada
// ("O seu acesso VIP aos achadinhos mais baratos da região."), servida
// IGUAL para toda loja hospedada por este mesmo build. A Savy Collection
// vende roupa; a frase promete preço e região que não são dela. O texto
// agora tem que vir da FICHA DA LOJA (config.storeName, já lido pelo
// rodapé desta mesma tela — ver auth-view-reset-prompt-copy.test.tsx) e
// cair num texto neutro (sem preço, sem região, sem "achadinhos") quando a
// loja não tem nome configurado.
//
// Mesma forma de teste que auth-view-reset-prompt-copy.test.tsx: render de
// verdade (react-dom/client + jsdom) porque o texto em disputa só existe na
// árvore renderizada de AuthView em viewMode "login".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login: vi.fn(),
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

// Mesmo mock mutável de auth-view-reset-prompt-copy.test.tsx: sem ele,
// importar o módulo de verdade arrasta @/lib/supabase.ts.
let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// auth-view-reset-prompt-copy.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AuthView — subtítulo da tela de login segue a loja, não uma frase cravada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function renderizarLogin() {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(<AuthView onNavigate={onNavigate} />);
    });
  }

  // Escopa a leitura ao ELEMENTO do subtítulo (irmão seguinte do h1
  // "Bem-vindo"), nunca à árvore inteira: o rodapé desta mesma tela
  // (linha ~811) já imprime `config.storeName` sem condição nenhuma, então
  // uma asserção sobre `hospedeiro.textContent` passa mesmo que o subtítulo
  // em si esteja cravado — o rodapé "empresta" o nome da loja ao teste.
  function pegarTextoDoSubtitulo(container: HTMLElement): string {
    const h1 = [...container.querySelectorAll("h1")].find(
      (el) => el.textContent === "Bem-vindo",
    );
    return h1?.nextElementSibling?.textContent?.trim() ?? "";
  }

  it("nunca mostra a frase cravada de outra loja (achadinhos/região/VIP)", async () => {
    mockConfig = { storeName: "Savy Collection" };
    await renderizarLogin();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/achadinhos/i);
    expect(texto).not.toMatch(/regi[aã]o/i);
    expect(texto).not.toMatch(/vip/i);
  });

  it("cita o nome da loja configurada no banco (ficha da loja), não um nome cravado", async () => {
    mockConfig = { storeName: "Savy Collection" };
    await renderizarLogin();

    expect(pegarTextoDoSubtitulo(hospedeiro)).toContain("Savy Collection");
  });

  it("troca de loja troca o subtítulo — não é a mesma frase para toda loja", async () => {
    mockConfig = { storeName: "IKCOUS" };
    await renderizarLogin();
    const subtituloIkcous = pegarTextoDoSubtitulo(hospedeiro);

    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    mockConfig = { storeName: "Savy Collection" };
    await renderizarLogin();
    const subtituloSavy = pegarTextoDoSubtitulo(hospedeiro);

    expect(subtituloIkcous).toContain("IKCOUS");
    expect(subtituloIkcous).not.toContain("Savy Collection");
    expect(subtituloSavy).toContain("Savy Collection");
    expect(subtituloSavy).not.toContain("IKCOUS");
  });

  it("sem nome de loja configurado, usa um texto neutro (sem preço nem região prometidos)", async () => {
    mockConfig = {};
    await renderizarLogin();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/achadinhos/i);
    expect(texto).not.toMatch(/regi[aã]o/i);
    expect(texto).not.toMatch(/mais barat/i);
    // A tela continua tendo ALGUM subtítulo abaixo do "Bem-vindo" — não fica
    // muda por falta de nome configurado. E o texto do subtítulo em si (não
    // a árvore inteira) não pode vazar "undefined"/"null": sem esta
    // asserção sobre `texto` (o retorno de pegarTextoDoSubtitulo, escopado
    // ao <p>), um subtítulo cravado tipo "...novidades da ${nome}." sem a
    // guarda de nome ausente passaria aqui mesmo mostrando lixo na tela.
    const h1 = [...hospedeiro.querySelectorAll("h1")].find(
      (el) => el.textContent === "Bem-vindo",
    );
    expect(h1).toBeTruthy();
    const textoDoSubtitulo = pegarTextoDoSubtitulo(hospedeiro);
    expect(textoDoSubtitulo.length).toBeGreaterThan(0);
    expect(textoDoSubtitulo).not.toMatch(/undefined|null/i);
  });
});
