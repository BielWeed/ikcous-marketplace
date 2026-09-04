// @vitest-environment jsdom
//
// O AVISO DE ATUALIZAÇÃO NÃO INTERROMPE A COMPRA (F2, decisão do dono 03/09).
//
// O modal de "Nova Versão Disponível" tem backdrop que bloqueia a tela
// inteira: nascer em cima do checkout é subir um muro entre o cliente e o
// botão de finalizar o pedido. O combinado com o dono: nas telas de compra
// (carrinho, checkout — que já embute o pagamento — e endereço) o aviso
// fica ARMADO e só aparece quando a loja chega numa tela segura. Fora da
// compra, nada muda.
//
// Controles negativos decidem o teste: um aviso que nunca aparece passaria
// trivialmente — precisa provar que em tela segura ele continua nascendo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste" },
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

const useUpdateCheckMock = vi.fn();
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => useUpdateCheckMock(),
}));

// O canal realtime só importa no app de verdade; aqui ele seria peso morto
// (supabase) sem efeito no comportamento sob teste.
vi.mock("@/hooks/useRealtimeUpdate", () => ({
  useRealtimeUpdate: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PWAUpdateManager } from "@/components/pwa/PWAUpdateGate";
import type { View } from "@/types";

// O `define` do Vite (`__APP_VERSION__`) mora no vite.config.ts, que o runner
// de teste usa de propósito NÃO usar (ver cabeçalho do vitest.config.ts). Sem
// isto, o primeiro render do UpdateNotification morre em ReferenceError.
(globalThis as Record<string, unknown>).__APP_VERSION__ = "1.0.0-teste";

const TEXTO_DO_AVISO = "Nova Versão Disponível";

describe("aviso de atualização não interrompe a compra", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: true,
      newVersion: "1.0.1-teste",
      performNuclearPurge: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  function montar(currentView: string) {
    act(() => {
      root.render(<PWAUpdateManager currentView={currentView as View} />);
    });
  }

  // (a) update disponível DURANTE o checkout: o aviso não nasce.
  it("no CHECKOUT com update disponível, o aviso NÃO aparece", () => {
    montar("checkout");
    expect(container.textContent).not.toContain(TEXTO_DO_AVISO);
  });

  // (b) a compra termina e a loja chega em tela segura: o aviso que estava
  // armado aparece (a atualização não se perde pelo caminho).
  it("update que chegou no checkout APARECE quando a loja volta pra home", () => {
    montar("checkout");
    expect(container.textContent).not.toContain(TEXTO_DO_AVISO);

    act(() => {
      root.render(<PWAUpdateManager currentView={"home" as View} />);
    });
    expect(container.textContent).toContain(TEXTO_DO_AVISO);
  });

  // (c) update disponível fora da compra: comportamento de hoje — nasce.
  it("controle: em tela segura com update disponível, o aviso aparece como hoje", () => {
    montar("home");
    expect(container.textContent).toContain(TEXTO_DO_AVISO);
  });

  // As outras duas telas do caminho do dinheiro: mesma proteção.
  it("no CARRINHO com update disponível, o aviso NÃO aparece", () => {
    montar("cart");
    expect(container.textContent).not.toContain(TEXTO_DO_AVISO);
  });

  it("no ENDEREÇO com update disponível, o aviso NÃO aparece", () => {
    montar("address-form");
    expect(container.textContent).not.toContain(TEXTO_DO_AVISO);
  });

  // Sem update disponível o modal nunca nasce — nem em tela segura (o gate
  // não inventa aviso onde o hook não viu update).
  it("controle: sem update disponível, nada aparece nem na home", () => {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: false,
      newVersion: null,
      performNuclearPurge: vi.fn(),
    });
    montar("home");
    expect(container.textContent).not.toContain(TEXTO_DO_AVISO);
  });
});
