// @vitest-environment jsdom
//
// Defeito carrinho-checkout-1, lado do PAINEL: a coluna `cart_items.variant_id`
// guarda a chave da linha (`idDaCor~idDoTamanho`) quando a cliente escolheu cor
// e tamanho de um produto de cadastro antigo. A ficha da cliente tem de
//   - mostrar as DUAS escolhas (e nunca acusar "Esta variação não existe mais"
//     só porque o texto da coluna não é o id puro de uma variação);
//   - remover a linha certa: o delete usa a chave inteira da coluna, senão a
//     lojista apagaria "Azul-P" e o banco, sem achar a chave, não removeria nada.
// Andaime copiado de painel-nao-mente-sobre-o-carrinho-da-cliente.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

const { filtros } = vi.hoisted(() => ({
  filtros: [] as [string, unknown][],
}));

const produtoDoBanco = {
  id: "p-camiseta",
  nome: "Camiseta",
  preco_venda: 10,
  estoque: 16,
  ativo: true,
  imagens: [],
  product_variants: [
    ["vc-azul", "Cor", "Azul", 5],
    ["vt-p", "Tamanho", "P", 4],
    ["vt-m", "Tamanho", "M", 2],
  ].map(([id, name, value, stock]) => ({
    id,
    product_id: "p-camiseta",
    name,
    value,
    stock_increment: stock,
    price_override: null,
    active: true,
  })),
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: [
            {
              product_id: "p-camiseta",
              quantity: 1,
              variant_id: "vc-azul~vt-p",
            },
            {
              product_id: "p-camiseta",
              quantity: 2,
              variant_id: "vc-azul~vt-m",
            },
            // Linha de antes da correção: um id só.
            { product_id: "p-camiseta", quantity: 1, variant_id: "vt-m" },
          ],
          addresses: [],
        },
        error: null,
      }),
    from: (tabela: string) => {
      if (tabela === "cart_items") {
        return {
          delete: () => {
            const builder: any = Promise.resolve({
              data: [{ id: "linha-0" }],
              error: null,
            });
            builder.select = () => builder;
            builder.eq = (coluna: string, valor: unknown) => {
              filtros.push([coluna, valor]);
              return builder;
            };
            builder.is = () => builder;
            return builder;
          },
        };
      }
      return {
        select: () => {
          const vazio = Promise.resolve({ data: [], error: null });
          return Object.assign(vazio, {
            in: () => Promise.resolve({ data: [produtoDoBanco], error: null }),
            eq: () => vazio,
            order: () => vazio,
          });
        },
      };
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe("AdminUserDetailView — carrinho da cliente com cor e tamanho separados", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    filtros.length = 0;
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

  async function abrirAbaCarrinho() {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes("Carrinho"),
    );
    await act(async () => {
      aba!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    await act(async () => {
      await esperar(0);
    });
  }

  it("mostra as duas escolhas de cada linha e não diz que a variação sumiu", async () => {
    await abrirAbaCarrinho();

    const texto = hospedeiro.textContent ?? "";
    expect(texto.match(/Cor: Azul/g) ?? []).toHaveLength(2);
    expect(texto.match(/Tamanho: P/g) ?? []).toHaveLength(1);
    // Azul-M (duas escolhas) e a linha antiga só "M".
    expect(texto.match(/Tamanho: M/g) ?? []).toHaveLength(2);
    expect(texto).not.toContain("Esta variação não existe mais");
  });

  it("remover a linha usa a chave inteira da coluna (as duas escolhas)", async () => {
    await abrirAbaCarrinho();

    const lixeira = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.getAttribute("title")?.includes("Remover do Carrinho"),
    )!;
    await act(async () => {
      lixeira.click();
    });
    const confirmar = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Remover Item",
    )!;
    await act(async () => {
      confirmar.click();
    });
    await act(async () => {
      await esperar(0);
    });

    expect(filtros).toContainEqual(["product_id", "p-camiseta"]);
    expect(filtros).toContainEqual(["variant_id", "vc-azul~vt-p"]);
  });
});
