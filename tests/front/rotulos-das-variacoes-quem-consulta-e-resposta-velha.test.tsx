// @vitest-environment jsdom
//
// `useRotulosDasVariacoes` (o "Cor Azul" de cada linha da compra) nos limites que
// o caminho feliz não mostra:
//  - só consulta o banco para o que NÃO tem retrato guardado na compra;
//  - o histórico só é lido na ficha de devolução (`lerHistorico`) e só para linha
//    que tem id E variação;
//  - os ids vão ordenados (a mesma lista nunca vira duas consultas);
//  - resposta velha (a lista de itens mudou) não apaga o rótulo da lista nova;
//  - leitura com erro, ou sem dados, não inventa rótulo;
//  - linha sem rótulo, ou sem id nenhum, não vira chave no resultado.
// Dados inventados.
import { useRotulosDasVariacoes } from "@/hooks/useRotulosDasVariacoes";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Itens = Parameters<typeof useRotulosDasVariacoes>[0];
interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  consultas: [] as Array<{ tabela: string; ids: readonly string[] }>,
  respostas: {} as {
    product_variants?: () => Promise<Resposta>;
    marketplace_order_items?: () => Promise<Resposta>;
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        in: (_coluna: string, ids: readonly string[]) => {
          banco.consultas.push({ tabela, ids });
          // Cada consulta tira a próxima resposta da fila daquela tabela.
          const resposta =
            tabela === "product_variants"
              ? banco.respostas.product_variants
              : banco.respostas.marketplace_order_items;
          return resposta?.() ?? Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: Record<string, string>;

function Sonda({ itens, ler }: { itens: Itens; ler: boolean }) {
  const valor = useRotulosDasVariacoes(itens, ler);
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}
async function renderizar(itens: Itens, ler = false) {
  await act(async () => {
    raiz.render(<Sonda itens={itens} ler={ler} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}
const nasVariantes = () =>
  banco.consultas.filter((c) => c.tabela === "product_variants");
const nosItens = () =>
  banco.consultas.filter((c) => c.tabela === "marketplace_order_items");

function adiada() {
  let resolver!: (r: Resposta) => void;
  const promessa = new Promise<Resposta>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

beforeEach(() => {
  banco.consultas = [];
  banco.respostas = {};
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
});

describe("useRotulosDasVariacoes — quem consulta e o que não inventa", () => {
  it("só com retrato guardado: não consulta o banco em tabela nenhuma", async () => {
    await renderizar(
      [
        {
          id: "l1",
          variantId: "v1",
          variacaoNomeNaCompra: "Cor",
          variacaoValorNaCompra: "Azul",
        },
      ],
      true,
    );
    expect(banco.consultas).toEqual([]);
    expect(ultimo).toEqual({ l1: "Cor Azul" });
  });

  it("sem pedir o histórico: nunca consulta os itens do pedido, só as variações do catálogo", async () => {
    banco.respostas.product_variants = () =>
      Promise.resolve({
        data: [{ id: "v1", name: "Cor", value: "Verde" }],
        error: null,
      });
    await renderizar([{ id: "l1", variantId: "v1" }], false);
    expect(nosItens()).toEqual([]);
    expect(nasVariantes()).toEqual([
      { tabela: "product_variants", ids: ["v1"] },
    ]);
    expect(ultimo).toEqual({ l1: "Cor Verde" });
  });

  it("histórico: só entra na consulta a linha com id E variação e sem retrato guardado, ordenada", async () => {
    await renderizar(
      [
        { id: "l-b", variantId: "v2" },
        { id: "l-sem-variacao" },
        { variantId: "v-sem-id" },
        {
          id: "l-guardada",
          variantId: "v3",
          variacaoNomeNaCompra: "Cor",
          variacaoValorNaCompra: "Rosa",
        },
        { id: "l-a", variantId: "v1" },
      ],
      true,
    );
    expect(nosItens()).toEqual([
      { tabela: "marketplace_order_items", ids: ["l-a", "l-b"] },
    ]);
  });

  it("catálogo: os ids das variações vão ordenados e sem repetir", async () => {
    await renderizar([
      { id: "l1", variantId: "v-z" },
      { id: "l2", variantId: "v-a" },
      { id: "l3", variantId: "v-z" },
    ]);
    expect(nasVariantes()).toEqual([
      { tabela: "product_variants", ids: ["v-a", "v-z"] },
    ]);
  });

  it("sem nenhuma variação a descobrir: não consulta e limpa o que tinha", async () => {
    banco.respostas.product_variants = () =>
      Promise.resolve({
        data: [{ id: "v1", name: "Cor", value: "Verde" }],
        error: null,
      });
    await renderizar([{ id: "l1", variantId: "v1" }]);
    expect(ultimo).toEqual({ l1: "Cor Verde" });
    const consultasAntes = banco.consultas.length;

    await renderizar([{ id: "l1" }]);
    expect(banco.consultas.length).toBe(consultasAntes);
    expect(ultimo).toEqual({});
  });

  it("resposta VELHA do catálogo (a lista mudou) não apaga o rótulo da lista nova", async () => {
    const velha = adiada();
    const respostas = [
      () => velha.promessa,
      () =>
        Promise.resolve({
          data: [{ id: "v2", name: "Cor", value: "Roxo" }],
          error: null,
        }),
    ];
    banco.respostas.product_variants = () =>
      (respostas.shift() as () => Promise<Resposta>)();

    await renderizar([{ id: "l1", variantId: "v1" }]);
    await renderizar([{ id: "l2", variantId: "v2" }]);
    expect(ultimo).toEqual({ l2: "Cor Roxo" });

    await act(async () => {
      velha.resolver({
        data: [{ id: "v1", name: "Cor", value: "Ocre" }],
        error: null,
      });
      await velha.promessa;
    });
    expect(ultimo).toEqual({ l2: "Cor Roxo" });
  });

  it("leitura do catálogo com erro: sem rótulo, sem quebrar", async () => {
    banco.respostas.product_variants = () =>
      Promise.resolve({
        data: [{ id: "v1", name: "Cor", value: "Verde" }],
        error: { code: "42501" },
      });
    await renderizar([{ id: "l1", variantId: "v1" }]);
    expect(ultimo).toEqual({});
  });

  it("leitura do catálogo sem dados (null): sem rótulo, sem quebrar", async () => {
    banco.respostas.product_variants = () =>
      Promise.resolve({ data: null, error: null });
    await renderizar([{ id: "l1", variantId: "v1" }]);
    expect(ultimo).toEqual({});
  });

  it("linha sem rótulo nenhum não vira chave; linha sem id nem variação nem retrato some", async () => {
    await renderizar([
      { id: "l-sem-rotulo" },
      { variacaoNomeNaCompra: "Cor", variacaoValorNaCompra: "Azul" },
    ]);
    expect(Object.keys(ultimo)).toEqual([]);
  });
});
