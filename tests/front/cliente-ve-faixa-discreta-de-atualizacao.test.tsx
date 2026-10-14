// @vitest-environment jsdom
//
// O AVISO DE VERSÃO NOVA NÃO CAI COMO MURO NA CARA DA CLIENTE.
//
// Antes, a cliente via o mesmo cartão do painel: fundo preto com desfoque por
// cima da vitrine inteira, foguete âmbar e "melhorias de desempenho". Agora:
//   - CLIENTE: uma faixa de uma linha ("Há uma versão nova do app.") com
//     "Atualizar" e "Depois", sem diálogo, sem fundo escuro, sem desfoque;
//   - PAINEL do lojista (qualquer view `admin*`): o cartão de sempre;
//   - telas de compra, login, confirmação do pedido e página do produto: nada.
// "Depois" adia por 1 hora e "Atualizar" faz o mesmo de antes.
//
// Os controles negativos precisam do positivo ao lado: um aviso que nunca
// aparece passaria em todo "não aparece".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de Teste" } }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useRealtimeUpdate", () => ({ useRealtimeUpdate: vi.fn() }));

const atualizacao = vi.hoisted(() => ({
  performNuclearPurge: undefined as unknown as (forcar?: boolean) => void,
}));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    checkUpdate: () => {},
    updateAvailable: true,
    newVersion: "1.0.1-teste",
    performNuclearPurge: atualizacao.performNuclearPurge,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = "1.0.0-teste";
});

import { PWAUpdateManager } from "@/components/pwa/PWAUpdateGate";
import type { View } from "@/types";

const FAIXA = "Há uma versão nova do app.";
const CARTAO = "Nova Versão Disponível";
const CHAVE_SNOOZE = "pwa_update_snooze_until";

describe("aviso de versão nova: faixa discreta para a cliente, cartão só no painel", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let armazem: Map<string, string>;

  beforeEach(() => {
    atualizacao.performNuclearPurge = vi.fn();
    armazem = new Map();
    const dubleDeArmazem = () => ({
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("localStorage", dubleDeArmazem());
    vi.stubGlobal("sessionStorage", dubleDeArmazem());
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  const montar = (view: string) => {
    act(() => {
      raiz.render(<PWAUpdateManager currentView={view as View} />);
    });
  };
  const texto = () => document.body.textContent ?? "";
  const faixa = () => document.querySelector<HTMLElement>('[role="status"]');
  const botao = (nome: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === nome,
    );

  it("a CLIENTE vê a faixa de uma linha, e NÃO o cartão", () => {
    montar("home");

    expect(faixa()?.textContent).toContain(FAIXA);
    expect(botao("Atualizar")).toBeDefined();
    expect(botao("Depois")).toBeDefined();

    // Nada do cartão: sem diálogo, sem foguete, sem o texto de "melhorias".
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect(texto()).not.toContain(CARTAO);
    expect(texto()).not.toContain("melhorias de desempenho");
    expect(document.querySelector(".lucide-rocket")).toBeNull();
  });

  it("a faixa não cobre a tela: sem fundo escuro, sem desfoque, sem tela cheia", () => {
    montar("home");
    const classes = faixa()?.className ?? "";

    expect(classes).not.toMatch(/inset-0|inset-y|\bh-screen\b|\bh-full\b/);
    expect(classes).not.toMatch(/backdrop-blur|bg-black|bg-zinc-950/);
    expect(classes).toContain("max-w-md");
    // Nada na tela com desfoque (o cartão antigo trazia `backdrop-blur-md`).
    expect(document.querySelector('[class*="backdrop-blur"]')).toBeNull();
  });

  it("o PAINEL do lojista mantém o cartão, e não ganha a faixa", () => {
    for (const view of ["admin-dashboard", "admin-orders", "admin-login"]) {
      montar(view);
      expect(texto()).toContain(CARTAO);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(texto()).not.toContain(FAIXA);
    }
  });

  it("nas telas de compra, no login, na confirmação e na página do produto: nenhum dos dois", () => {
    for (const view of [
      "cart",
      "checkout",
      "address-form",
      "order-success",
      "auth",
      "login",
      "product-detail",
    ]) {
      montar(view);
      expect(texto(), view).not.toContain(FAIXA);
      expect(texto(), view).not.toContain(CARTAO);
    }
    // Controle: a mesma montagem numa tela segura mostra a faixa.
    montar("home");
    expect(texto()).toContain(FAIXA);
  });

  it("'Atualizar' faz o mesmo de antes (performNuclearPurge(true)) e a faixa avisa que está atualizando", () => {
    montar("home");

    act(() => {
      botao("Atualizar")?.click();
    });

    expect(atualizacao.performNuclearPurge).toHaveBeenCalledTimes(1);
    expect(atualizacao.performNuclearPurge).toHaveBeenCalledWith(true);
    expect(faixa()?.textContent).toContain("Atualizando");
    expect(botao("Atualizar")).toBeUndefined();
  });

  it("'Depois' esconde a faixa, grava ~1h e uma montagem nova (F5) não a reabre", () => {
    montar("home");
    expect(faixa()).not.toBeNull();

    act(() => {
      botao("Depois")?.click();
    });
    expect(faixa()).toBeNull();

    const minutos = (Number(armazem.get(CHAVE_SNOOZE)) - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(55);
    expect(minutos).toBeLessThan(65);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(host);
    montar("home");
    expect(faixa()).toBeNull();
    expect(texto()).not.toContain(CARTAO);
  });
});
