// @vitest-environment jsdom
//
// FORMAS DE PAGAMENTO POR LOJA (25/09/2026, migration 20261174000000) — a
// seção nova de AdminSettingsView (grupo "Pagamentos", ANTES de Mercado
// Pago): 3 switches (pix/card/cash na entrega), status de "Pagar pelo app
// (PIX)" sem duplicar o switch de lá, e a regra de recusa que espelha o
// trigger vivo do banco (`store_config_exige_forma_de_pagamento`) do lado
// do cliente — não gasta uma chamada de rede num clique que o banco
// reprovaria de qualquer forma.
//
// Padrão dos vizinhos (admin-ajustes-salao-e-porao.test.tsx,
// admin-settings-pix-acompanha-o-interruptor.test.tsx): createRoot + act do
// React puro, dependências de fora mockadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/types";

const { mockConfig, mockStore, mockFlags, mockChave, mockOnline } = vi.hoisted(
  () => ({
    mockConfig: {} as Record<string, unknown>,
    mockStore: { isLoaded: true, updateConfig: vi.fn(async () => true) },
    mockFlags: { pagamentoOnlineLigado: vi.fn(() => true) },
    mockChave: {
      chavePublicaMercadoPago: vi.fn((): string | null => "APP_USR-prova"),
    },
    mockOnline: { useOnlineStatus: vi.fn(() => false) },
  }),
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: mockStore.isLoaded,
    updateConfig: mockStore.updateConfig,
  }),
}));
vi.mock("@/lib/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));
vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  chavePublicaMercadoPago: mockChave.chavePublicaMercadoPago,
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: mockOnline.useOnlineStatus,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
const toastErro = vi.fn();
const toastSucesso = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminSettingsView — Formas de pagamento (pix/card/cash na entrega)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    mockConfig.shippingProvider = undefined;
    mockConfig.businessHours = undefined;
    mockConfig.storeName = undefined;
    mockConfig.formasPagamentoEntrega = ["pix", "card", "cash"];
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue("APP_USR-prova");
    mockOnline.useOnlineStatus.mockReturnValue(false);
    mockStore.isLoaded = true;
    mockStore.updateConfig.mockReset();
    mockStore.updateConfig.mockResolvedValue(true);
    toastErro.mockReset();
    toastSucesso.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function botaoPorTexto(trecho: string): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    );
    if (!botao) throw new Error(`Botão "${trecho}" não está na tela.`);
    return botao as HTMLButtonElement;
  }

  function switchPorRotulo(rotulo: string): HTMLButtonElement {
    const alvo = hospedeiro.querySelector(
      `[role="switch"][aria-label="${rotulo}"]`,
    );
    if (!alvo) throw new Error(`O switch "${rotulo}" não está na tela.`);
    return alvo as HTMLButtonElement;
  }

  async function clicar(elemento: HTMLElement) {
    await act(async () => {
      elemento.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  async function abrirASecao() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(
        <AdminSettingsView
          onNavigate={vi.fn() as unknown as (view: View) => void}
          active={true}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await clicar(botaoPorTexto("Formas de pagamento"));
  }

  it("mostra os 3 switches ligados quando a loja tem pix/card/cash (padrão de hoje)", async () => {
    await abrirASecao();
    expect(
      switchPorRotulo("Pix na entrega ou retirada").getAttribute("data-state"),
    ).toBe("checked");
    expect(
      switchPorRotulo("Cartão na entrega ou retirada").getAttribute(
        "data-state",
      ),
    ).toBe("checked");
    expect(
      switchPorRotulo("Dinheiro na entrega ou retirada").getAttribute(
        "data-state",
      ),
    ).toBe("checked");
  });

  it("desligar uma forma (não a última) chama updateConfig com a lista sem ela, em ordem CANÔNICA", async () => {
    await abrirASecao();
    await clicar(switchPorRotulo("Cartão na entrega ou retirada"));

    expect(mockStore.updateConfig).toHaveBeenCalledWith(
      { formasPagamentoEntrega: ["pix", "cash"] },
      { silentSuccess: true },
    );
  });

  it("religar uma forma desligada volta na ordem CANÔNICA, não na ordem do clique", async () => {
    mockConfig.formasPagamentoEntrega = ["cash"];
    await abrirASecao();
    await clicar(switchPorRotulo("Pix na entrega ou retirada"));

    // Canônica é [pix, card, cash] — "cash" já ligado, "pix" entra na
    // posição dele, nunca no fim por ter sido clicado por último.
    expect(mockStore.updateConfig).toHaveBeenCalledWith(
      { formasPagamentoEntrega: ["pix", "cash"] },
      { silentSuccess: true },
    );
  });

  it("EDGE CASE: desligar a ÚLTIMA forma com o pagamento pelo app DESLIGADO é recusado pela UI, sem chamar updateConfig", async () => {
    mockConfig.formasPagamentoEntrega = ["pix"];
    mockFlags.pagamentoOnlineLigado.mockReturnValue(false);
    await abrirASecao();
    await clicar(switchPorRotulo("Pix na entrega ou retirada"));

    expect(mockStore.updateConfig).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledWith(
      expect.stringContaining("última forma"),
    );
  });

  it("desligar a ÚLTIMA forma com o pagamento pelo app LIGADO é PERMITIDO (loja só-pelo-app é um estado válido)", async () => {
    mockConfig.formasPagamentoEntrega = ["pix"];
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    await abrirASecao();
    await clicar(switchPorRotulo("Pix na entrega ou retirada"));

    expect(mockStore.updateConfig).toHaveBeenCalledWith(
      { formasPagamentoEntrega: [] },
      { silentSuccess: true },
    );
  });

  it("loja sem nenhuma forma na entrega, com o app ligado: aviso nomeia que está pronto (chave ok)", async () => {
    mockConfig.formasPagamentoEntrega = [];
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue("APP_USR-prova");
    await abrirASecao();

    expect(hospedeiro.textContent).toContain("pagamento pelo app está pronto");
  });

  it("loja sem nenhuma forma na entrega, app ligado MAS sem chave: aviso nomeia o estado quebrado (ninguém finaliza pedido)", async () => {
    mockConfig.formasPagamentoEntrega = [];
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue(null);
    await abrirASecao();

    expect(hospedeiro.textContent).toContain("SEM a chave configurada");
    expect(hospedeiro.textContent).toContain(
      "ninguém consegue finalizar pedido",
    );
  });

  it("config sem o campo (loja antiga, ainda sem a coluna no retrato) cai nas 3 formas — não muda comportamento sozinha", async () => {
    mockConfig.formasPagamentoEntrega = undefined;
    await abrirASecao();
    expect(
      switchPorRotulo("Pix na entrega ou retirada").getAttribute("data-state"),
    ).toBe("checked");
    expect(
      switchPorRotulo("Cartão na entrega ou retirada").getAttribute(
        "data-state",
      ),
    ).toBe("checked");
    expect(
      switchPorRotulo("Dinheiro na entrega ou retirada").getAttribute(
        "data-state",
      ),
    ).toBe("checked");
  });

  it("o botão de status abre a seção Mercado Pago (a de baixo) sem duplicar o switch 'Receber PIX no app'", async () => {
    await abrirASecao();
    expect(
      hospedeiro.querySelector(
        '[role="switch"][aria-label="Receber PIX no app"]',
      ),
    ).toBeNull();

    await clicar(botaoPorTexto("Configurar credenciais"));

    // A seção Mercado Pago abriu (lazy: o fallback ou o conteúdo aparece).
    const cabecalhoMP = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Mercado Pago"),
    );
    expect(cabecalhoMP?.getAttribute("aria-expanded")).toBe("true");
  });

  it("offline: clicar um switch não chama updateConfig e avisa 'Você está offline'", async () => {
    mockOnline.useOnlineStatus.mockReturnValue(true);
    await abrirASecao();
    await clicar(switchPorRotulo("Cartão na entrega ou retirada"));

    expect(mockStore.updateConfig).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledWith("Você está offline");
  });
});
