// @vitest-environment jsdom
//
// `useEstornosEmCursoDosPedidos` (o aviso "já tem estorno em curso, não devolva
// por fora" do painel de pedidos): o toque da lojista em `recarregar` (abrir o
// painel) SEMPRE lança uma leitura nova, mesmo com outra ainda no ar, e a
// resposta da leitura antiga é descartada — senão o retrato de ANTES do toque
// ("devolva R$ 100") ficava na tela e a cliente podia ser paga em dobro.
// Dados inventados.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LinhaDoLedger {
  order_id: string;
  amount: number;
  status: string;
  solicitado_por: string | null;
  tentativas: number | null;
}
interface Resposta {
  data: LinhaDoLedger[];
  error: unknown;
}

const banco = vi.hoisted(() => ({
  consultas: 0,
  proximas: [] as Array<() => Promise<Resposta>>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "order_refunds") throw new Error(`tabela ${tabela}`);
      banco.consultas += 1;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = () => builder;
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
      builder.then = (resolve: unknown, reject?: unknown) => {
        const proxima = banco.proximas.shift();
        return (
          proxima ? proxima() : Promise.resolve({ data: [], error: null })
        ).then(resolve as never, reject as never);
      };
      return builder;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  type EstornoEmCurso,
  useEstornosEmCursoDosPedidos,
} from "@/hooks/useEstornosEmCursoDosPedidos";

type Visto = ReturnType<typeof useEstornosEmCursoDosPedidos>;
let ultimo: Visto;
const PEDIDOS = [{ id: "pedido-1", valorEstornado: 0 }];

function Sonda() {
  const valor = useEstornosEmCursoDosPedidos(PEDIDOS);
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}

function adiada() {
  let resolver!: (r: Resposta) => void;
  const promessa = new Promise<Resposta>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}
const linha = (amount: number): LinhaDoLedger => ({
  order_id: "pedido-1",
  amount,
  status: "solicitado",
  solicitado_por: null,
  tentativas: 0,
});
const situacao = (): EstornoEmCurso | undefined =>
  ultimo.porPedido.get("pedido-1");

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  banco.consultas = 0;
  banco.proximas = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
});

describe("useEstornosEmCursoDosPedidos — recarregar força e a resposta velha perde", () => {
  it("com a primeira leitura ainda no ar, recarregar lança outra; a resposta da antiga não vence a nova", async () => {
    const primeira = adiada();
    const segunda = adiada();
    banco.proximas.push(
      () => primeira.promessa,
      () => segunda.promessa,
    );
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(banco.consultas).toBe(1);
    expect(situacao()).toEqual({ tipo: "conferindo" });

    await act(async () => {
      ultimo.recarregar();
    });
    expect(banco.consultas).toBe(2);

    await act(async () => {
      segunda.resolver({ data: [linha(30)], error: null });
      await segunda.promessa;
    });
    expect(situacao()).toMatchObject({
      tipo: "conferido",
      emCurso: 30,
      pedidoPeloApp: 30,
    });

    await act(async () => {
      primeira.resolver({ data: [linha(99)], error: null });
      await primeira.promessa;
    });
    expect(situacao()).toMatchObject({ tipo: "conferido", emCurso: 30 });
  });
});
