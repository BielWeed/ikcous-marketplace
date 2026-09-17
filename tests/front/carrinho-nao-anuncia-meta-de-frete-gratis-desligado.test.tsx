// @vitest-environment jsdom
//
// Achado CartView-328: com o preset "desligado" (ou "por_produto" sem item
// marcado) o carrinho renderizava `ShippingProgress` mesmo assim, passando
// progressPercent=0 e amountToFree=0 — e o componente imprimia "META FRETE
// GRÁTIS", 0% e "Faltam R$ 0,00": uma meta que a loja nunca configurou.
//
// Duas camadas de defesa, as duas cobertas aqui:
//  1. `deveExibirMetaDeFreteGratis` (CartView.tsx) — a decisão de exibir o
//     bloco, exportada como função pura pelo MESMO motivo de
//     `mesclarListaAposRecarga`: montar a `CartView` inteira no teste arrasta
//     o mundo (useOrders, useProducts, realtime) só para exercitar um
//     booleano (ver comentário no próprio CartView.tsx).
//  2. `ShippingProgress` — rede de segurança: mesmo que o chamador esqueça a
//     guarda, o componente não desenha "Meta Frete Grátis" com os dois
//     números zerados ao mesmo tempo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importar a CartView arrasta `@/lib/supabase` (via AuthContext), e o
// [EnvGuard] lança no import sem VITE_SUPABASE_* — a máquina de CI não tem
// nenhum (mesmo porquê do mock em
// cart-view-lista-de-pedidos-resiste-a-recarga-vazia.test.tsx). A função sob
// teste é pura; o mock existe só para o módulo carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import type { Product } from "@/types";
import { deveExibirMetaDeFreteGratis } from "@/views/customer/CartView";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/shipping-progress-contraste-aa.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("deveExibirMetaDeFreteGratis — só existe meta de valor em 'acima_de_valor'", () => {
  it("preset desligado (freeShippingMin=0) e frete não garantido: não exibe", () => {
    expect(deveExibirMetaDeFreteGratis(false, 0)).toBe(false);
  });

  it("preset 'por_produto' (sentinela -1) sem item marcado (frete não garantido): não exibe", () => {
    expect(deveExibirMetaDeFreteGratis(false, -1)).toBe(false);
  });

  it("preset 'acima_de_valor' (freeShippingMin=100) ainda não atingido: exibe (é a meta de verdade)", () => {
    expect(deveExibirMetaDeFreteGratis(false, 100)).toBe(true);
  });

  it("frete já garantido (freteGratis=true), qualquer preset: exibe para comemorar 'Liberado'", () => {
    expect(deveExibirMetaDeFreteGratis(true, 0)).toBe(true);
    expect(deveExibirMetaDeFreteGratis(true, -1)).toBe(true);
    expect(deveExibirMetaDeFreteGratis(true, 0.01)).toBe(true);
  });
});

describe("ShippingProgress — rede de segurança contra meta 0%/R$ 0,00", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("progressPercent=0 e amountToFree=0 (sem meta configurada): não renderiza nada — nunca 'Meta Frete Grátis'/'Faltam R$ 0,00'", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          shipping={25}
          savings={0}
          progressPercent={0}
          amountToFree={0}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });

    expect(hospedeiro.textContent ?? "").toBe("");
    expect(hospedeiro.children.length).toBe(0);
  });

  it("progresso real (preset acima_de_valor, ainda longe da meta) continua aparecendo normalmente", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          shipping={25}
          savings={0}
          progressPercent={40}
          amountToFree={60}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });

    const texto = (hospedeiro.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Meta Frete Grátis");
    expect(texto).toContain("Faltam");
    expect(texto).toContain("R$ 60,00");
  });
});
