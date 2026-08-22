// @vitest-environment jsdom
//
// A "Fila Limpa" mentirosa — getQAStats não pode apresentar falha como zero.
//
// O DEFEITO: getQAStats lia só o `count` das duas consultas (`totalRes.count
// || 0`). O cliente do Supabase NÃO lança exceção: consulta que falha volta
// como `{ count: null, error }`, e o `|| 0` transformava esse "não sei" no
// "não há nenhuma". O cartão de Perguntas anunciava "Fila Limpa" e "Taxa de
// Resposta 0%" numa loja com cliente esperando resposta — sem nada na tela
// indicando erro.
//
// POR QUE O TESTE PASSA PELO HOOK DE VERDADE (render React + jsdom) e não por
// função extraída: a regra da bancada é que teste que continua verde com o
// `|| 0` de volta não protege nada. Quem tinha o defeito era o fechamento
// dentro de `useQuestions().getQAStats`; então quem é exercitado aqui é ELE,
// com o cliente do Supabase dublê logo abaixo. Uma função extraída e testada
// sozinha ficaria verde com a correção desfeita no lugar que importa.
//
// Os três estados que precisam ficar distinguíveis a quem consome:
//   1. consulta que falha            -> { status: "error", ... }   (nunca zeros)
//   2. loja com perguntas            -> { status: "ok", números }
//   3. loja legitimamente vazia      -> { status: "ok", zeros }    (zero REAL)
//
// Dublê do BroadcastChannel: jsdom não tem, e o módulo do hook instancia um
// no topo do arquivo (`new BroadcastChannel(...)`) na importação.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

// As respostas que o dublê do Supabase devolve, trocadas caso a caso pelos
// testes. Índice 0 = consulta do total; índice 1 = consulta dos pendentes
// (a que encadeia .eq("answers_count", 0)).
const h = vi.hoisted(() => {
  const respostas: Array<{ count: number | null; error: unknown }> = [
    { count: null, error: null },
    { count: null, error: null },
  ];
  return { respostas };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let passouPorEq = false;
      const construtor: {
        select: () => typeof construtor;
        eq: () => typeof construtor;
        then: (
          resolucao: (valor: { count: number | null; error: unknown }) => void,
          rejeicao: (erro: unknown) => void,
        ) => void;
      } = {
        select: () => construtor,
        eq: () => {
          passouPorEq = true;
          return construtor;
        },
        // O query builder do Supabase É thenable por desenho — é isso que faz
        // `await supabase.from(...).select(...)` funcionar sem `.execute()`.
        // O dublê precisa desta propriedade para se parecer com o objeto real;
        // mesmo precedente de admin-layout-cracha-pedidos-pendentes.test.tsx.
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (resolucao, rejeicao) => {
          Promise.resolve(passouPorEq ? h.respostas[1] : h.respostas[0]).then(
            resolucao,
            rejeicao,
          );
        },
      };
      return construtor;
    },
  },
}));

// Importar o módulo do hook instancia coisas que não interessam ao julgamento
// (sessão, eleição de aba). Dublês mínimos para o hook montar.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-teste" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedQuestionsData: null,
  setCachedQuestionsData: vi.fn(),
}));

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type QAStatsResult, useQuestions } from "@/hooks/useQuestions";

// Mesmo padrão de product-card-gate-avaliacoes.test.tsx: sem esta flag o
// React reclama de act() em todo render.
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("getQAStats — falha de consulta nunca vira 'Fila Limpa'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.respostas[0] = { count: null, error: null };
    h.respostas[1] = { count: null, error: null };
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

  const montarECapturar = async (): Promise<() => Promise<QAStatsResult>> => {
    // A Sonda REPORTA por callback (mesmo padrão de auth-logout-cleanup.test.tsx:
    // "não por mutação de variável fechada — é isso que react-hooks/globals
    // reprova"). Quem captura é o vi.fn; o teste lê a última chamada.
    const capturada = vi.fn((_g: () => Promise<QAStatsResult>) => {});
    function Sonda({
      aoCapturar,
    }: {
      readonly aoCapturar: (g: () => Promise<QAStatsResult>) => void;
    }) {
      const { getQAStats } = useQuestions();
      aoCapturar(getQAStats);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda aoCapturar={capturada} />);
    });
    const capturado = capturada.mock.calls.at(-1)?.[0];
    if (!capturado) throw new Error("A sonda não capturou getQAStats");
    return capturado;
  };

  const chamar = async (): Promise<QAStatsResult> => {
    const getQAStats = await montarECapturar();
    let capturado: QAStatsResult | undefined;
    await act(async () => {
      capturado = await getQAStats();
    });
    return capturado as QAStatsResult;
  };

  it("CASO 1 — consulta que falha: status 'error', nunca zeros de fila limpa", async () => {
    // É exatamente isto que o Supabase devolve num erro real: count nulo e
    // objeto de erro. Com o `|| 0` de volta, este teste CAI: status sairia
    // undefined e total viraria 0.
    h.respostas[0] = { count: null, error: { message: "HTTP 500" } };
    h.respostas[1] = { count: null, error: { message: "HTTP 500" } };

    const resultado = await chamar();

    expect(resultado.status).toBe("error");
    if (resultado.status === "error") {
      expect((resultado.error as { message: string }).message).toBe("HTTP 500");
    }
    // O resultado de erro não carrega números vestindo fantasia de resposta:
    // nenhum campo do formato de sucesso pode aparecer junto.
    expect("total" in resultado).toBe(false);
    expect("rate" in resultado).toBe(false);
  });

  it("CASO 1b — bastando UMA consulta falhar (a de pendentes), já é erro", async () => {
    h.respostas[0] = { count: 7, error: null };
    h.respostas[1] = { count: null, error: { message: "timeout" } };

    const resultado = await chamar();

    // Metade dos dados bons não autoriza metade da mentira: sem os pendentes
    // não dá nem para calcular respondidas, que é total - pendentes.
    expect(resultado.status).toBe("error");
  });

  it("CASO 2 — loja com perguntas: números certos, conta igual à de antes", async () => {
    h.respostas[0] = { count: 12, error: null }; // total
    h.respostas[1] = { count: 5, error: null }; // pendentes

    const resultado = await chamar();

    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") {
      expect(resultado.total).toBe(12);
      expect(resultado.pending).toBe(5);
      expect(resultado.answered).toBe(7); // 12 - 5, como sempre foi
      expect(resultado.rate).toBe(58); // round(7 / 12 * 100), como sempre foi
    }
  });

  it("CASO 3 — loja legitimamente vazia: zero de verdade chega como 'ok', sem cara de erro", async () => {
    h.respostas[0] = { count: 0, error: null };
    h.respostas[1] = { count: 0, error: null };

    const resultado = await chamar();

    // Zero legítimo TEM de continuar sendo zero — e NÃO pode ser confundido
    // com falha, senão a tela troca uma mentira por outra.
    expect(resultado.status).toBe("ok");
    if (resultado.status === "ok") {
      expect(resultado.total).toBe(0);
      expect(resultado.pending).toBe(0);
      expect(resultado.answered).toBe(0);
      expect(resultado.rate).toBe(0);
    }
  });
});
