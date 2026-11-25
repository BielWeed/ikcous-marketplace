// @vitest-environment jsdom
//
// Os números do topo de Pedidos: o que NUNCA vira número.
//  - contagem com erro, ou com resposta que não é número, é "não sei" (null) e
//    nunca "0 pedidos"; um 0 de verdade continua sendo 0;
//  - sem acesso (401/403) é "não sei" e NÃO fica tentando de novo;
//  - falha de rede tenta de novo em 1 s, 2 s e 4 s (e só); aba no fundo não tenta;
//  - com a tela inativa, pedir a recarga à mão não consulta nada.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type NumerosDosPedidos,
  useNumerosDosPedidos,
} from "@/hooks/useNumerosDosPedidos";

interface RespostaDaContagem {
  count: unknown;
  error: unknown;
  status: number;
}

type Contagem =
  | "paraPreparar"
  | "aguardandoPagamento"
  | "aCaminho"
  | "abertosComPagamentoAConferir";

const banco = vi.hoisted(() => ({
  consultas: 0,
  // Resposta de cada contagem, pelo nome dela (a consulta é reconhecida pelos
  // filtros que monta).
  resposta: (_contagem: Contagem): RespostaDaContagem => ({
    count: 0,
    error: null,
    status: 200,
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      banco.consultas += 1;
      let nome: Contagem = "paraPreparar";
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = (coluna: string) => {
        if (coluna === "payment_status") nome = "abertosComPagamentoAConferir";
        return builder;
      };
      builder.eq = (_coluna: string, valor: string) => {
        if (valor === "aguardando") nome = "aguardandoPagamento";
        if (valor === "shipping") nome = "aCaminho";
        return builder;
      };
      builder.or = () => builder;
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
      builder.then = (resolve: unknown, reject?: unknown) =>
        Promise.resolve(banco.resposta(nome)).then(
          resolve as never,
          reject as never,
        );
      return builder;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ultimo: NumerosDosPedidos;
function Sonda({ ativo }: { ativo: boolean }) {
  const numeros = useNumerosDosPedidos(ativo);
  useEffect(() => {
    ultimo = numeros;
  });
  return null;
}

describe("useNumerosDosPedidos — contagem ruim e tentativas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let visibilidade: "visible" | "hidden";

  async function montar(ativo = true) {
    await act(async () => {
      raiz.render(<Sonda ativo={ativo} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    banco.consultas = 0;
    banco.resposta = () => ({ count: 0, error: null, status: 200 });
    visibilidade = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilidade,
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("erro com número junto e contagem que não é número viram 'não sei'; o zero de verdade fica zero", async () => {
    banco.resposta = (contagem) => {
      switch (contagem) {
        case "paraPreparar":
          return { count: 7, error: { message: "falhou" }, status: 500 };
        case "aguardandoPagamento":
          return { count: "5", error: null, status: 200 };
        case "aCaminho":
          return { count: 2, error: null, status: 200 };
        default:
          return { count: 0, error: null, status: 200 };
      }
    };
    await montar();
    expect(ultimo.paraPreparar).toBeNull();
    expect(ultimo.aguardandoPagamento).toBeNull();
    expect(ultimo.aCaminho).toBe(2);
    expect(ultimo.abertosComPagamentoAConferir).toBe(0);
  });

  it("sem acesso (401/403) vira 'não sei' e não fica tentando de novo", async () => {
    banco.resposta = (contagem) =>
      contagem === "paraPreparar"
        ? { count: null, error: { message: "jwt" }, status: 401 }
        : contagem === "aguardandoPagamento"
          ? { count: null, error: { message: "rls" }, status: 403 }
          : { count: 3, error: null, status: 200 };
    await montar();
    expect(ultimo.paraPreparar).toBeNull();
    expect(ultimo.aguardandoPagamento).toBeNull();
    expect(ultimo.aCaminho).toBe(3);
    expect(banco.consultas).toBe(4);
    await passar(20_000);
    expect(banco.consultas).toBe(4);
  });

  it("falha de rede: só a contagem que falhou tenta de novo, em 1 s, 2 s e 4 s, e para", async () => {
    banco.resposta = (contagem) =>
      contagem === "aCaminho"
        ? { count: null, error: { message: "rede" }, status: 500 }
        : { count: 1, error: null, status: 200 };
    await montar();
    expect(banco.consultas).toBe(4);
    expect(ultimo.aCaminho).toBeNull();

    await passar(999);
    expect(banco.consultas).toBe(4);
    await passar(1);
    expect(banco.consultas).toBe(5);

    await passar(1_999);
    expect(banco.consultas).toBe(5);
    await passar(1);
    expect(banco.consultas).toBe(6);

    await passar(3_999);
    expect(banco.consultas).toBe(6);
    await passar(1);
    expect(banco.consultas).toBe(7);

    await passar(60_000);
    expect(banco.consultas).toBe(7);
  });

  it("falha de rede com a aba no fundo: não agenda nova tentativa", async () => {
    visibilidade = "hidden";
    banco.resposta = () => ({
      count: null,
      error: { message: "rede" },
      status: 500,
    });
    await montar();
    expect(banco.consultas).toBe(4);
    await passar(60_000);
    expect(banco.consultas).toBe(4);
  });

  it("tela inativa: pedir a recarga à mão não consulta nada", async () => {
    await montar(false);
    await act(async () => {
      await ultimo.recarregar();
    });
    await passar(5_000);
    expect(banco.consultas).toBe(0);
  });
});
