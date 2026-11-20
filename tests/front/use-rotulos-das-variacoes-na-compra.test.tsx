// @vitest-environment jsdom
import { useRotulosDasVariacoes } from "@/hooks/useRotulosDasVariacoes";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => ({
      select: () => ({
        in: async () => ({
          data:
            tabela === "marketplace_order_items"
              ? [
                  {
                    id: "compra-antiga",
                    variacao_nome_na_compra: "Cor",
                    variacao_valor_na_compra: "Azul",
                  },
                ]
              : [{ id: "mesma", name: "Cor", value: "Marinho" }],
          error: null,
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function rotulosDas(
  itens: Parameters<typeof useRotulosDasVariacoes>[0],
  lerHistorico = false,
) {
  const Prova = () => (
    <pre>{JSON.stringify(useRotulosDasVariacoes(itens, lerHistorico))}</pre>
  );
  const hospedeiro = document.createElement("div");
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () => raiz.render(<Prova />));
    return JSON.parse(hospedeiro.textContent ?? "{}");
  } finally {
    await act(async () => raiz.unmount());
  }
}

const recente = { id: "compra-nova", variantId: "mesma" };

it("resolve por linha: o nome guardado vence sem contaminar outra compra do mesmo id", async () => {
  expect(
    await rotulosDas([
      {
        id: "compra-antiga",
        variantId: "mesma",
        variacaoNomeNaCompra: "Cor",
        variacaoValorNaCompra: "Azul",
      },
      recente,
    ]),
  ).toEqual({ "compra-antiga": "Cor Azul", "compra-nova": "Cor Marinho" });
});

it("na devolução busca o nome histórico pelo id da linha do pedido", async () => {
  expect(
    await rotulosDas(
      [{ id: "compra-antiga", variantId: "mesma" }, recente],
      true,
    ),
  ).toEqual({ "compra-antiga": "Cor Azul", "compra-nova": "Cor Marinho" });
});
