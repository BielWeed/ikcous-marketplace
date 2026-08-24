// @vitest-environment jsdom
//
// REGRESSAO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR, medida em 24/08/2026 no
// painel rodando, DEPOIS de remover o cartao "Disparo Push" da tela de
// Clientes (commit bc2b148):
//
//     largura 375 (celular)      portas VISIVEIS para admin-push
//     tela Painel .............. 0
//     tela Ajustes ............. 0
//     tela Clientes ............ 0
//     sino do topo ............. vai para /admin-orders, nao para as
//                                Notificacoes — ele so abre admin-push com
//                                ZERO pedido e ZERO pergunta pendentes
//                                (AdminLayout.tsx, `notificationBellTarget`)
//
// Ou seja: a remocao do cartao repetido custou a ULTIMA porta visivel no
// celular. Sobrava so um caminho de quatro toques, por dentro do menu de um
// cliente qualquer, trocando o destino para "todos" no fim. O botao "Push" da
// barra lateral nao salva: o `aside` e' `lg:flex`, some abaixo de 1024px.
//
// A porta certa e' a tela de Ajustes: e' onde as telas irmas ja moram
// (Banners, Carrosseis) e e' o "pai" que o proprio Voltar de `admin-push`
// aponta desde sempre (`paiDaTelaDoAdmin`). O que faltava era a tela de
// Ajustes ter a entrada correspondente — ela tinha o pai sem ter o filho.
//
// O teste mede a PORTA, nao o texto: clica em todos os cartoes da tela e
// exige que ALGUM leve a `admin-push`. Trocar o titulo do cartao nao quebra;
// apagar a porta, sim.
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

import type { View } from "@/types";
import { AdminSettingsView } from "@/views/admin/AdminSettingsView";

describe("a tela de Ajustes tem porta para as Notificacoes", () => {
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

  it("algum cartao da tela leva para admin-push", () => {
    for (const cartao of container.querySelectorAll('[role="button"]')) {
      act(() => {
        cartao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(idas).toContain("admin-push");
  });

  it("as portas das telas irmas continuam de pe", () => {
    for (const cartao of container.querySelectorAll('[role="button"]')) {
      act(() => {
        cartao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(idas).toContain("admin-banners");
    expect(idas).toContain("admin-carousels");
  });

  it("a porta e' UMA so — Ajustes nao repete o defeito que acabou de sair", () => {
    for (const cartao of container.querySelectorAll('[role="button"]')) {
      act(() => {
        cartao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    expect(idas.filter((view) => view === "admin-push")).toHaveLength(1);
  });
});
