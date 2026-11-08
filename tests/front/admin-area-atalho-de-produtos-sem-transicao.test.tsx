// @vitest-environment jsdom
//
// Início → "N produtos com estoque baixo" e Relatórios → "Cadastrar custo" abrem
// Produtos pedindo uma visão (`onNavigate("admin-products", "estoque-baixo")`;
// o `id` é a visão). A AdminArea tem DOIS ramos que montam a lista de Produtos:
// o de aparelho com View Transitions e o de aparelho sem (iPhone com iOS 17 ou
// anterior, Chrome antigo). Só o primeiro repassava `visaoInicial`: no outro a
// lojista tocava no cartão e caía na lista inteira, sem filtro e sem a faixa.
//
// Aqui a AdminArea é a de verdade; só o layout e a tela de Produtos são dublês
// (a tela grava as props que recebeu).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  propsDaLista: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/views/admin/AdminProductsView", () => ({
  AdminProductsView: (props: Record<string, unknown>) => {
    h.propsDaLista.push(props);
    return <div data-testid="lista-de-produtos" />;
  },
}));

import { AdminArea } from "@/components/layouts/AdminArea";

describe("AdminArea: o atalho para Produtos chega com a visão, com ou sem View Transitions", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.propsDaLista = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(
    isTransitionSupported: boolean,
    selectedProductId: string | null,
  ) {
    await act(async () => {
      raiz.render(
        <AdminArea
          currentView="admin-products"
          onNavigate={vi.fn()}
          selectedProductId={selectedProductId}
          setIsAdminDirty={vi.fn()}
          setBackOverride={vi.fn()}
          handleAdminUserDetailBack={vi.fn()}
          backOverride={null}
          isTransitionSupported={isTransitionSupported}
        />,
      );
    });
    // O componente da lista é carregado sob demanda (lazy).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  const ultimaVisao = () => h.propsDaLista.at(-1)?.visaoInicial;

  it.each(["estoque-baixo", "sem-custo"])(
    "sem View Transitions, a visão '%s' chega à lista de Produtos",
    async (visao) => {
      await montar(false, visao);
      expect(h.propsDaLista.length).toBeGreaterThan(0);
      expect(ultimaVisao()).toBe(visao);
    },
  );

  it.each(["estoque-baixo", "sem-custo"])(
    "com View Transitions, a visão '%s' continua chegando (controle)",
    async (visao) => {
      await montar(true, visao);
      expect(ultimaVisao()).toBe(visao);
    },
  );

  it("sem View Transitions e sem pedido de visão, a lista abre normal (visão nula)", async () => {
    await montar(false, null);
    expect(h.propsDaLista.length).toBeGreaterThan(0);
    expect(ultimaVisao()).toBeNull();
  });
});
