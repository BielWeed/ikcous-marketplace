// @vitest-environment jsdom
//
// Os números do topo de Pedidos ao voltar para o app.
//
// A lojista bloqueia o celular com Pedidos aberto e volta depois. A conexão
// ao vivo dorme com a tela bloqueada, então os pedidos que chegaram nesse
// meio-tempo não geravam evento nenhum; a lista se relia ao voltar, mas o topo
// seguia no número de antes ("Para preparar 0" com 3 pedidos novos logo
// abaixo). Contrato provado aqui (dublê do Supabase que responde pela cadeia
// da consulta + relógio falso):
//   - ao voltar a aba para a frente, os números são relidos UMA vez, pela
//     mesma janela de coalescência das outras recargas (sem laço, sem relógio);
//   - aba indo para o fundo não relê nada;
//   - várias voltas seguidas viram uma rodada só;
//   - com a tela inativa (outra aba do painel) ou desmontada, não relê.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATRASO_COALESCENCIA_NUMEROS_MS,
  useNumerosDosPedidos,
} from "@/hooks/useNumerosDosPedidos";

// Estado do banco de mentira: o número que cada contagem devolve.
const banco = vi.hoisted(() => ({ contagem: 0, consultas: 0 }));

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
        Promise.resolve({ count: banco.contagem, error: null }).then(
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

const lido = { paraPreparar: null as number | null };

function Sonda({ ativo }: { ativo: boolean }) {
  const numeros = useNumerosDosPedidos(ativo);
  useEffect(() => {
    lido.paraPreparar = numeros.paraPreparar;
  });
  return null;
}

describe("useNumerosDosPedidos — ao voltar a aba para a frente", () => {
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

  async function mudarVisibilidade(para: "visible" | "hidden") {
    visibilidade = para;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    banco.contagem = 0;
    banco.consultas = 0;
    lido.paraPreparar = null;
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

  it("pedidos que chegaram com a tela bloqueada aparecem no topo quando ela volta", async () => {
    await montar();
    expect(lido.paraPreparar).toBe(0);

    await mudarVisibilidade("hidden");
    // Enquanto a tela estava bloqueada, 3 pedidos novos entraram no banco.
    banco.contagem = 3;
    await mudarVisibilidade("visible");
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS);

    expect(lido.paraPreparar).toBe(3);
  });

  it("a releitura é UMA rodada e só ao fim da janela, sem relógio sobrando", async () => {
    await montar();
    const antes = banco.consultas;

    await mudarVisibilidade("visible");
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS - 1);
    expect(banco.consultas).toBe(antes);

    await passar(1);
    expect(banco.consultas).toBe(antes + CONSULTAS_POR_RODADA);

    // Nada mais fica agendado: sem laço.
    await passar(60_000);
    expect(banco.consultas).toBe(antes + CONSULTAS_POR_RODADA);
  });

  it("aba indo para o fundo não relê os números", async () => {
    await montar();
    const antes = banco.consultas;

    await mudarVisibilidade("hidden");
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS * 3);

    expect(banco.consultas).toBe(antes);
  });

  it("várias voltas seguidas viram uma rodada só", async () => {
    await montar();
    const antes = banco.consultas;

    for (let i = 0; i < 5; i += 1) {
      await mudarVisibilidade("visible");
      await passar(100);
    }
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS * 3);

    expect(banco.consultas).toBe(antes + CONSULTAS_POR_RODADA);
  });

  it("com a tela inativa (outra aba do painel) não relê ao voltar", async () => {
    await montar(false);
    const antes = banco.consultas;

    await mudarVisibilidade("visible");
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS * 3);

    expect(banco.consultas).toBe(antes);
  });

  it("tela desmontada não relê ao voltar", async () => {
    await montar();
    const antes = banco.consultas;

    act(() => {
      raiz.unmount();
    });
    await mudarVisibilidade("visible");
    await passar(ATRASO_COALESCENCIA_NUMEROS_MS * 3);
    // O afterEach desmonta de novo; uma raiz nova evita o erro de
    // "unmount de raiz já desmontada".
    raiz = createRoot(hospedeiro);

    expect(banco.consultas).toBe(antes);
  });
});
