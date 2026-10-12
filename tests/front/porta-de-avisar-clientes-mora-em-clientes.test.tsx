// @vitest-environment jsdom
//
// DECISÃO DO GABRIEL (30/08/2026, com print na mão): a porta "Avisar
// clientes" mora na tela de CLIENTES — não em Ajustes, onde ela tinha
// renascido por acaso (era a última porta visível no celular desde 24/08,
// quando o cartão duplicado saiu daqui e o sino ainda abria admin-push).
// Painel simples (C3): a faixa de Clientes passou a ser o AtalhosDaAba, com
// duas portas só — "Perguntas e avaliações" e "Avisar clientes". "Canais de
// Atendimento" saiu (Minha loja cuida do contato).
//
// O contrato agora tem dois lados:
//   1. Ajustes NÃO tem mais porta para admin-push (a seção "Clientes &
//      Avisos" saiu de lá). O teste antigo, que exigia a porta em Ajustes,
//      foi invertido com a decisão.
//   2. As portas de Clientes (AtalhosDaAba aba="clientes") TÊM a porta:
//      clicar em "Avisar clientes" navega para admin-push — e o Voltar de
//      admin-push é sensível à origem, então volta para Clientes. A tela de
//      Clientes montada de verdade tem prova própria em
//      portas-das-abas-nas-telas.test.tsx.
// O teste mede a PORTA, não o texto: clica nos botões e olha o destino.
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

import { AtalhosDaAba } from "@/components/admin/primitivos/AtalhosDaAba";
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

describe("Clientes tem a porta de Avisar clientes (AtalhosDaAba)", () => {
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
        <AtalhosDaAba
          aba="clientes"
          onNavigate={(view: View) => idas.push(view)}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function porta(nome: string): HTMLButtonElement {
    const achada = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === nome,
    );
    expect(achada, `sem a porta "${nome}"`).toBeDefined();
    return achada as HTMLButtonElement;
  }

  it("a porta 'Avisar clientes' leva para admin-push", () => {
    act(() => {
      porta("Avisar clientes").click();
    });
    expect(idas).toEqual(["admin-push"]);
  });

  it("a porta 'Perguntas e avaliações' leva para admin-qa", () => {
    act(() => {
      porta("Perguntas e avaliações").click();
    });
    expect(idas).toEqual(["admin-qa"]);
  });

  it("não há porta para admin-whatsapp-config em Clientes", () => {
    for (const botao of container.querySelectorAll("button")) {
      act(() => {
        botao.click();
      });
    }
    expect(idas).not.toContain("admin-whatsapp-config");
    expect(container.textContent).not.toContain("Canais de Atendimento");
  });
});
