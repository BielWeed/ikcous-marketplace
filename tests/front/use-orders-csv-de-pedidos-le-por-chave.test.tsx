// @vitest-environment jsdom
//
// O CSV de Pedidos (`buscarPedidosDoFiltroParaExportar`, useOrders.ts) lia o
// filtro inteiro de 100 em 100 pela RPC `get_admin_orders_paged`, por POSIÇÃO
// (OFFSET). Duas mudanças entre uma página e a outra que se anulam na contagem
// — um pedido já lido sai do filtro (avançou de status) e outro, mais antigo,
// entra mais para baixo — fazem a lista subir uma casa: o pedido da fronteira
// (o 101º) não é lido por página nenhuma e o arquivo sai com o mesmo total,
// sem erro, trocando um pedido por outro.
//
// A leitura passa a ser por CHAVE: cada página pede só o que vem a partir da
// data do último pedido lido (`p_end_date`, inclusivo, com a data EXATAMENTE
// como o banco devolveu — microssegundos e fuso), na ordem da RPC
// (created_at desc, id). O que mudou no meio vira "consulta incompleta",
// nunca um arquivo trocado.
//
// O dublê da RPC faz o que o banco faz: filtra por status e pelo período
// (comparando INSTANTES em microssegundos), ordena por created_at desc e id,
// corta no OFFSET/LIMIT e conta o filtro inteiro.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, isAdmin: true }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = { id: string; status: string; created_at: string };
type Argumentos = {
  p_status: string;
  p_end_date: string;
  p_page: number;
  p_page_size: number;
};

/** `timestamptz` como o Postgres compara: microssegundos desde a época. */
function microssegundos(valor: string): bigint {
  const m =
    // eslint-disable-next-line security/detect-unsafe-regex -- o grupo opcional roda no máximo uma vez e a entrada é texto fabricado pelo próprio dublê
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      valor,
    );
  if (!m) throw new Error(`data inválida no dublê: ${valor}`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const fuso =
    m[8] === "Z"
      ? 0
      : (m[8][0] === "-" ? -1 : 1) *
        (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(4, 6)));
  const fracao = BigInt((m[7] ?? "").padEnd(6, "0"));
  return (BigInt(ms) - BigInt(fuso) * 60_000n) * 1000n + fracao;
}

/** Pedido `n`: quanto maior o número, mais antigo (1 = o mais novo). */
function pedidoDoBanco(n: number, status = "processing"): Linha {
  const segundos = 100_000 - n; // datas distintas, decrescentes com n
  const base = Date.UTC(2026, 8, 1) / 1000 + segundos;
  const iso = new Date(base * 1000).toISOString().replace(".000Z", "");
  return {
    id: `pedido-${String(n).padStart(6, "0")}`,
    status,
    // Microssegundos e fuso, como o PostgREST devolve um timestamptz.
    created_at: `${iso}.${String(n % 1_000_000).padStart(6, "0")}+00:00`,
  };
}

let banco: Linha[];
let chamadas: Argumentos[];
let depoisDaChamada: (n: number) => void;
// Servidor que não anda: ignora a posição pedida e devolve sempre a primeira.
let respostaNaoAnda: boolean;

function responder(args: Argumentos) {
  const fim = args.p_end_date ? microssegundos(args.p_end_date) : null;
  const filtro = banco
    .filter((l) => args.p_status === "all" || l.status === args.p_status)
    .filter((l) => fim === null || microssegundos(l.created_at) <= fim)
    .sort((a, b) => {
      const da = microssegundos(a.created_at);
      const db = microssegundos(b.created_at);
      if (da !== db) return da > db ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const inicio = args.p_page * args.p_page_size;
  return {
    data: {
      data: filtro.slice(inicio, inicio + args.p_page_size),
      total_count: filtro.length,
    },
    error: null,
  };
}

let host: HTMLDivElement;
let raiz: Root;
let exportar: (filtro: { statusFilter?: string }) => Promise<Order[]>;

beforeEach(async () => {
  rpc.mockReset();
  chamadas = [];
  depoisDaChamada = () => {};
  respostaNaoAnda = false;
  rpc.mockImplementation((nome: string, args: Argumentos) => {
    if (nome !== "get_admin_orders_paged" || args.p_page_size !== 100) {
      const vazio = Promise.resolve({
        data: { data: [], total_count: 0 },
        error: null,
      });
      return Object.assign(vazio, { abortSignal: () => vazio });
    }
    chamadas.push({ ...args });
    const resposta = responder(respostaNaoAnda ? { ...args, p_page: 0 } : args);
    depoisDaChamada(chamadas.length);
    return Promise.resolve(resposta);
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda() {
    const { buscarPedidosDoFiltroParaExportar } = useOrders(true, true);
    useEffect(() => {
      exportar = buscarPedidosDoFiltroParaExportar;
    });
    return null;
  }
  await act(async () => raiz.render(<Sonda />));
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

const numeros = (lista: Order[]) =>
  lista.map((p) => Number(p.id.replace("pedido-", "")));

describe("CSV de pedidos lê por chave, não por posição", () => {
  it("duas mudanças que se anulam no total não trocam o pedido da fronteira por outro", async () => {
    banco = Array.from({ length: 150 }, (_, i) => pedidoDoBanco(i + 1));
    // Fora do filtro no começo; entra mais para baixo da lista no meio da leitura.
    banco.push(pedidoDoBanco(1205, "pending"));
    banco[banco.length - 1].created_at = pedidoDoBanco(120).created_at.replace(
      /\.\d{6}/,
      ".000000",
    );
    depoisDaChamada = (n) => {
      if (n !== 1) return;
      // Depois da 1ª página: o #30 (já lido) avança e sai do filtro, e o
      // #1205 passa a casar com ele — o total continua 150.
      banco[29].status = "shipping";
      banco[150].status = "processing";
    };
    const leitura = exportar({ statusFilter: "processing" });
    // Por posição: o arquivo saía com 150 linhas, sem o #101 e com o #1205.
    await expect(leitura).rejects.toThrow(/incompleta/i);
  });

  it("a página seguinte continua da data EXATA do último lido (microssegundos e fuso), sem repetir nem perder", async () => {
    banco = Array.from({ length: 250 }, (_, i) => pedidoDoBanco(i + 1));
    // Empate na fronteira: #99 a #102 no mesmo instante.
    const mesmoInstante = banco[98].created_at;
    for (const linha of banco.slice(99, 102)) linha.created_at = mesmoInstante;

    const lista = await exportar({ statusFilter: "processing" });

    expect(numeros(lista)).toEqual(
      Array.from({ length: 250 }, (_, i) => i + 1),
    );
    expect(chamadas[0].p_end_date).toBe("");
    const ultimaDaPrimeira = responder({ ...chamadas[0] }).data.data.at(-1)!;
    expect(chamadas[1]).toMatchObject({
      p_page: 0,
      p_end_date: ultimaDaPrimeira.created_at,
    });
    expect(chamadas[1].p_end_date).toMatch(/\.\d{6}\+00:00$/);
  });

  it("conta que bate no fim de uma página CHEIA não fecha o arquivo: pedido que entrou no meio não esconde o mais antigo", async () => {
    // 199 no filtro; o #150 ainda está fora (pending) na 1ª página.
    banco = Array.from({ length: 200 }, (_, i) => pedidoDoBanco(i + 1));
    banco[149].status = "pending";
    depoisDaChamada = (n) => {
      // Depois da 1ª página o #150 entra no filtro: a 2ª página volta cheia
      // (#100 repetido + 99 novos) e a conta fecha em 199 sem o #200.
      if (n === 1) banco[149].status = "processing";
    };
    const leitura = exportar({ statusFilter: "processing" });
    // Revisão Opus 27/11: o arquivo saía com 199 linhas, sem o #200.
    await expect(leitura).rejects.toThrow(/incompleta/i);
  });

  it("total igual ao tamanho da página confere a página seguinte e fecha", async () => {
    banco = Array.from({ length: 100 }, (_, i) => pedidoDoBanco(i + 1));

    const lista = await exportar({ statusFilter: "processing" });

    expect(numeros(lista)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect(chamadas).toHaveLength(2);
  });

  it("empate maior que a página (importação no mesmo instante) anda pela posição dentro do empate e lê todos", async () => {
    banco = Array.from({ length: 250 }, (_, i) => pedidoDoBanco(i + 1));
    const mesmoInstante = banco[49].created_at;
    for (const linha of banco.slice(50, 220)) linha.created_at = mesmoInstante;

    const lista = await exportar({ statusFilter: "processing" });

    expect(numeros(lista)).toEqual(
      Array.from({ length: 250 }, (_, i) => i + 1),
    );
    expect(chamadas.length).toBeLessThanOrEqual(5);
  });

  it("empate maior que a página com resposta que não anda: para logo, sem pedir dezenas de páginas", async () => {
    // 150 pedidos no mesmo instante: a leitura precisa andar pela posição
    // dentro do empate, mas o servidor devolve sempre a mesma página.
    banco = Array.from({ length: 150 }, (_, i) => pedidoDoBanco(i + 1));
    const mesmoInstante = banco[0].created_at;
    for (const linha of banco) linha.created_at = mesmoInstante;
    respostaNaoAnda = true;

    const leitura = exportar({ statusFilter: "processing" });

    await expect(leitura).rejects.toThrow(/incompleta/i);
    // 1ª página, a 1ª da chave nova (o empate inteiro já tinha vindo) e a
    // 2ª da chave, que não trouxe nada novo: para aí.
    expect(chamadas).toHaveLength(3);
  });
});
