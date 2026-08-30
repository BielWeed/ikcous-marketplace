// @vitest-environment jsdom
//
// DECISÃO DO GABRIEL (30/08/2026, com print na mão): a porta "Avisar
// clientes" mora na tela de CLIENTES, ao lado de "Canais de Atendimento" —
// não em Ajustes, onde ela tinha renascido por acaso (era a última porta
// visível no celular desde 24/08, quando o cartão duplicado saiu daqui e o
// sino ainda abria admin-push).
//
// O contrato agora tem dois lados:
//   1. Ajustes NÃO tem mais porta para admin-push (a seção "Clientes &
//      Avisos" saiu de lá). O teste antigo, que exigia a porta em Ajustes,
//      foi invertido com a decisão.
//   2. CustomerBanners (a faixa de cartões da tela de Clientes) TEM a
//      porta: clicar em "Avisar clientes" navega para admin-push — e o
//      Voltar de admin-push é sensível à origem, então volta para Clientes.
// O teste mede a PORTA, não o texto: clica nos cartões e olha o destino.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    isLoaded: true,
    config: { storeCity: "Monte Carmelo", storeState: "MG" },
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/admin/AdminHelpModal", () => ({
  AdminHelpModal: () => null,
}));

import { CustomerBanners } from "@/components/admin/dashboard/CustomerBanners";
import type { View } from "@/types";
import { AdminSettingsView } from "@/views/admin/AdminSettingsView";

describe("Ajustes NÃO tem mais a porta de Avisar clientes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let idas: View[];

  beforeEach(() => {
    idas = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <AdminSettingsView onNavigate={(view: View) => idas.push(view)} />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("nenhum cartão da tela leva para admin-push", () => {
    for (const cartao of container.querySelectorAll('[role="button"]')) {
      act(() => {
        cartao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(idas).not.toContain("admin-push");
  });

  it("as portas das telas irmas continuam de pé (banners e carrosséis)", () => {
    for (const cartao of container.querySelectorAll('[role="button"]')) {
      act(() => {
        cartao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(idas).toContain("admin-banners");
    expect(idas).toContain("admin-carousels");
  });
});

describe("Clientes tem a porta de Avisar clientes (CustomerBanners)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let idas: View[];

  beforeEach(() => {
    idas = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <CustomerBanners onNavigate={(view: View) => idas.push(view)} />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("o cartão 'Avisar clientes' leva para admin-push", () => {
    const cartao = [...container.querySelectorAll('[role="button"]')].find(
      (b) => b.textContent?.includes("Avisar clientes"),
    );
    expect(cartao).toBeDefined();
    act(() => {
      cartao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(idas).toContain("admin-push");
  });

  it("o cartão 'Canais de Atendimento' continua levando ao Atendimento", () => {
    const cartao = [...container.querySelectorAll('[role="button"]')].find(
      (b) => b.textContent?.includes("Canais de Atendimento"),
    );
    expect(cartao).toBeDefined();
    act(() => {
      cartao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(idas).toContain("admin-whatsapp-config");
  });
});
