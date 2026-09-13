// @vitest-environment jsdom
//
// Pedido do Gabriel (12/09/2026, D1 refinado): o centro da barra superior
// tem um espaço vazio quando a busca some (hoje só em "address-form" e
// "checkout"). O mecanismo escolhido é o Header expor um ponto de encaixe
// com ID ESTÁVEL nesse centro, para o CheckoutView portar ali o gatilho do
// resumo do pedido (`createPortal`) — sem o Header saber nada sobre
// carrinho, frete ou total. Esta suíte prova só o PONTO DE ENCAIXE: existe
// quando não há busca, some quando a busca existe, e o Header nunca
// duplica cálculo nenhum (ele só hospeda o slot vazio).
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, mesmo padrão de
// header-logo-atualizada.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Header — ponto de encaixe no centro quando não há busca", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = { storeName: "LOJA DA PROVA" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("com hideSearch, o slot central existe e nasce vazio", async () => {
    const { Header, HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} hideSearch />
        </StrictMode>,
      );
    });

    const slot = document.getElementById(HEADER_CENTER_SLOT_ID);
    expect(slot).not.toBeNull();
    expect(slot!.childElementCount).toBe(0);
  });

  it("sem hideSearch (outras telas), o slot não existe — Header idêntico ao de hoje", async () => {
    const { Header, HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });

    expect(document.getElementById(HEADER_CENTER_SLOT_ID)).toBeNull();
  });

  it("achado 3 do bloqueante (12/09/2026): o slot tem um orçamento PRÓPRIO (≤140px), que encolhe quando a cápsula de aviso do sino está ativa", async () => {
    // Sem um teto próprio, o espaço "disponível" dependia só da largura da
    // logo desta loja (32px) — outra loja com logo larga (o Header permite
    // até 100px, `max-w-[100px]` na logo) cortava o gatilho no meio, e a
    // publicação vai para TODAS as lojas.
    const { Header, HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} hideSearch />
        </StrictMode>,
      );
    });

    const slot = document.getElementById(HEADER_CENTER_SLOT_ID);
    expect(slot).not.toBeNull();
    expect(slot!.className).toContain("max-w-[140px]");
    expect(slot!.className).not.toContain("max-w-[72px]");

    // Mesmo evento global que abre a cápsula de aviso do sino
    // (src/utils/headerToast.ts) — o slot precisa recolher para caber só
    // as miniaturas que o CheckoutView porta ali (mesmo mecanismo que a
    // busca já usa, `activeToast ? "max-w-[...]" : "max-w-lg"`).
    await act(async () => {
      globalThis.dispatchEvent(
        new CustomEvent("header-toast-event", {
          detail: { id: "t1", message: "Pedido salvo", duration: 5000 },
        }),
      );
    });

    expect(slot!.className).toContain("max-w-[72px]");
    expect(slot!.className).not.toContain("max-w-[140px]");
  });
});
