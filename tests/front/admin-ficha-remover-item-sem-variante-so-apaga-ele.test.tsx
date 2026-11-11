// @vitest-environment jsdom
// Sem o filtro IS NULL, remover a linha simples apagaria também a com variante.
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

type Linha = {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  variant_id: string | null;
};
type Resultado = { data: { id: string }[]; error: null };
interface Consulta extends Promise<Resultado> {
  select: () => Consulta;
  eq: (coluna: keyof Linha, valor: unknown) => Consulta;
  is: (coluna: keyof Linha, valor: null) => Consulta;
}

const { banco } = vi.hoisted(() => ({
  banco: { linhas: [] as Linha[], apagadas: [] as string[] },
}));

const produto = {
  id: "produto-1",
  nome: "Camiseta de prova",
  preco_venda: 10,
  estoque: 12,
  ativo: true,
  imagens: [],
  product_variants: [
    {
      id: "variante-azul",
      product_id: "produto-1",
      name: "Cor",
      value: "Azul",
      stock_increment: 5,
      price_override: null,
      active: true,
    },
  ],
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
            email: "cliente@example.test",
            whatsapp: "",
          },
          orders: [],
          cart_items: banco.linhas.map((linha) => ({ ...linha })),
          addresses: [],
        },
        error: null,
      }),
    from: (tabela: string) => {
      if (tabela === "cart_items") {
        return {
          delete: () => {
            const filtros: ((linha: Linha) => boolean)[] = [];
            // A microtarefa executa só depois de a tela encadear TODOS os filtros.
            // Sem IS NULL, ambas as linhas do mesmo produto serão apagadas.
            const consulta: Consulta = Object.assign(
              Promise.resolve().then(() => {
                const removidas = banco.linhas.filter((linha) =>
                  filtros.every((filtro) => filtro(linha)),
                );
                banco.apagadas.push(...removidas.map((linha) => linha.id));
                banco.linhas = banco.linhas.filter(
                  (linha) => !removidas.includes(linha),
                );
                return {
                  data: removidas.map(({ id }) => ({ id })),
                  error: null,
                };
              }),
              {
                select: () => consulta,
                eq: (coluna: keyof Linha, valor: unknown) => {
                  filtros.push((linha) => Reflect.get(linha, coluna) === valor);
                  return consulta;
                },
                is: (coluna: keyof Linha, valor: null) => {
                  filtros.push((linha) => Reflect.get(linha, coluna) === valor);
                  return consulta;
                },
              },
            );
            return consulta;
          },
        };
      }
      if (tabela === "reviews" || tabela === "questions") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      if (tabela !== "vw_produtos_admin") {
        throw new Error(`Tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [produto], error: null }),
        }),
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

const esperar = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("Ficha da cliente — remoção preserva a outra linha do mesmo produto", () => {
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
    banco.apagadas = [];
    banco.linhas = [
      {
        id: "linha-sem-variante",
        user_id: "cliente-1",
        product_id: "produto-1",
        quantity: 1,
        variant_id: null,
      },
      {
        id: "linha-com-variante",
        user_id: "cliente-1",
        product_id: "produto-1",
        quantity: 2,
        variant_id: "variante-azul",
      },
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function removerPelaTela(indice: number) {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((botao) =>
      botao.textContent?.includes("Carrinho"),
    );
    if (!aba) throw new Error("Aba Carrinho não encontrada.");
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    const lixeiras = hospedeiro.querySelectorAll<HTMLButtonElement>(
      'button[title="Remover do Carrinho"]',
    );
    expect(lixeiras).toHaveLength(2);
    await act(async () => {
      lixeiras.item(indice).click();
    });
    const confirmar = [...document.body.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Remover Item",
    );
    if (!confirmar) throw new Error("Confirmação de remoção não encontrada.");
    await act(async () => {
      confirmar.click();
      await esperar(0);
    });
  }

  it("remover o item sem variante apaga só ele e preserva a linha com variante", async () => {
    await removerPelaTela(0);

    expect(banco.apagadas).toEqual(["linha-sem-variante"]);
    expect(banco.linhas.map(({ id }) => id)).toEqual(["linha-com-variante"]);
    expect(
      hospedeiro.querySelectorAll('button[title="Remover do Carrinho"]'),
    ).toHaveLength(1);
    expect(hospedeiro.textContent).toContain("Cor: Azul");
  });

  it("controle: remover o item com variante preserva a linha sem variante", async () => {
    await removerPelaTela(1);

    expect(banco.apagadas).toEqual(["linha-com-variante"]);
    expect(banco.linhas.map(({ id }) => id)).toEqual(["linha-sem-variante"]);
    expect(
      hospedeiro.querySelectorAll('button[title="Remover do Carrinho"]'),
    ).toHaveLength(1);
    expect(hospedeiro.textContent).not.toContain("Cor: Azul");
  });
});
