// @vitest-environment jsdom
//
// DEFEITO A da peça "tela de atualização" (dono, 14/09): o selo "de → para" do
// aviso de atualização mostrava CÓDIGO ESTRANHO no lugar da versão. Causa:
// `SHORT_VERSION = v.slice(-6)` em UpdateNotification.tsx pegava os ÚLTIMOS 6
// CARACTERES da string — e a versão de build é `1.32.0-sha.2526bdd`, então o
// lojista via `526bdd` (hash), não `1.32.0`.
//
// O contrato novo: o selo mostra o NÚCLEO semver limpo de ambos os lados, e
// quando a "versão" não é legível (ex.: `binary-v24`, valor inventado do
// realtime), o selo NÃO NASCE — nunca um fragmento estranho.
//
// Molde: update-nao-interrompe-checkout.test.tsx (mesmos mocks; o gate de telas
// de compra já é coberto lá — aqui só a versão exibida importa).
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

vi.mock("@/hooks/useRealtimeUpdate", () => ({
  useRealtimeUpdate: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O `define` do Vite (`__APP_VERSION__`) mora no vite.config.ts, que o runner
// de teste usa de propósito NÃO usar (ver cabeçalho do vitest.config.ts). O
// componente lê a versão UMA vez, no nível do módulo (mesmo padrão do
// useUpdateCheck), então o valor precisa existir ANTES do import — vi.hoisted
// roda antes dos imports resolverem. O valor imita a forma REAL da produção:
// núcleo + sufixo de hash.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = "1.31.0-sha.abcdef";
});

import { PWAUpdateManager } from "@/components/pwa/PWAUpdateGate";
import type { View } from "@/types";

const TEXTO_DO_AVISO = "Nova Versão Disponível";

describe("aviso de atualização mostra a versão limpa, não um código estranho", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: true,
      newVersion: null,
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

  function montar() {
    act(() => {
      root.render(<PWAUpdateManager currentView={"home" as View} />);
    });
  }

  function textoNaTela() {
    return document.body.textContent ?? "";
  }

  it("o selo de → para mostra `1.31.0 → 1.32.0`, NUNCA o fragmento do hash", () => {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: true,
      newVersion: "1.32.0-sha.2526bdd",
      performNuclearPurge: vi.fn(),
    });
    montar();

    const tela = textoNaTela();
    expect(tela).toContain(TEXTO_DO_AVISO);
    expect(tela).toContain("1.31.0");
    expect(tela).toContain("1.32.0");
    // Os fragmentos que o lojista via antes (o "código estranho" da peça):
    expect(tela).not.toContain("526bdd");
    expect(tela).not.toContain("abcdef");
  });

  it("versão ilegível do realtime (binary-v24) → o selo NÃO nasce, sem inventar código", () => {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: true,
      newVersion: "binary-v24",
      performNuclearPurge: vi.fn(),
    });
    montar();

    const tela = textoNaTela();
    expect(tela).toContain(TEXTO_DO_AVISO);
    expect(tela).not.toContain("binary");
    expect(tela).not.toContain("v24");
  });

  it("controle: sem newVersion, o aviso nasce sem selo de versão nenhum", () => {
    montar();
    const tela = textoNaTela();
    expect(tela).toContain(TEXTO_DO_AVISO);
    expect(tela).not.toContain("1.31.0");
  });
});
