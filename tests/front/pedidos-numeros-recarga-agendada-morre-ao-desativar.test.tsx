// @vitest-environment jsdom
//
// Os números do topo de Pedidos: a recarga que já estava AGENDADA (tempo real,
// ação na tela) some quando a tela fica inativa. Voltar à tela relê na hora, uma
// vez; a recarga velha não pode disparar por cima e contar tudo outra vez.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATRASO_COALESCENCIA_NUMEROS_MS,
  type NumerosDosPedidos,
  useNumerosDosPedidos,
} from "@/hooks/useNumerosDosPedidos";

const banco = vi.hoisted(() => ({ consultas: 0 }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      banco.consultas += 1;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = () => builder;
      builder.eq = () => builder;
      builder.or = () => builder;
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
      builder.then = (resolve: unknown, reject?: unknown) =>
        Promise.resolve({ count: 0, error: null, status: 200 }).then(
          resolve as never,
          reject as never,
        );
      return builder;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Cada rodada monta 4 consultas (3 cartões + o aviso de pagamento). */
const CONSULTAS_POR_RODADA = 4;

let ultimo: NumerosDosPedidos;

function Sonda({ ativo }: { ativo: boolean }) {
  const numeros = useNumerosDosPedidos(ativo);
  useEffect(() => {
    ultimo = numeros;
  });
  return null;
}

describe("useNumerosDosPedidos — recarga agendada ao desativar a tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function renderizar(ativo: boolean) {
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
  });

  it("recarga pedida e depois tela inativa/ativa: lê só a da volta, a velha não dispara", async () => {
    await renderizar(true);
    expect(banco.consultas).toBe(CONSULTAS_POR_RODADA);

    await act(async () => {
      ultimo.pedirRecarga();
    });
    await renderizar(false);
    await renderizar(true);
    // A volta à tela leu na hora (uma rodada).
    expect(banco.consultas).toBe(2 * CONSULTAS_POR_RODADA);

    await passar(ATRASO_COALESCENCIA_NUMEROS_MS * 3);
    expect(banco.consultas).toBe(2 * CONSULTAS_POR_RODADA);
  });

  it("depois de descartar a velha, um pedido novo de recarga volta a funcionar (não fica travado)", async () => {
    await renderizar(true);
    await act(async () => {
      ultimo.pedirRecarga();
    });
    await renderizar(false);
    await renderizar(true);
    const antes = banco.consultas;

    await act(async () => {
      ultimo.pedirRecarga();
    });
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS);
    expect(banco.consultas).toBe(antes + CONSULTAS_POR_RODADA);
  });

  it("tela desmontada com recarga agendada: nada é lido depois", async () => {
    await renderizar(true);
    await act(async () => {
      ultimo.pedirRecarga();
    });
    const antes = banco.consultas;
    await renderizar(false);
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS * 3);
    expect(banco.consultas).toBe(antes);
  });
});
