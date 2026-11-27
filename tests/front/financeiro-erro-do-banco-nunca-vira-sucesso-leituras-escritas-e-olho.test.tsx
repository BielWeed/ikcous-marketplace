// @vitest-environment jsdom
// Financeiro é dinheiro: o que o banco RECUSOU nunca aparece como feito.
//  - cada gravação (lançamento, baixa, cancelamento, abrir/movimentar/fechar
//    caixa, conta, categoria) rejeita com o erro do banco; sem erro, resolve;
//  - cada leitura (resumo, DRE, DRE mensal, contas, categorias, caixa, histórico
//    do caixa) com erro do banco entrega erro e nenhum dado, mesmo que venha
//    resposta junto, e a frase é a do erro de verdade (não a de "formato");
//  - a conferência do caixa antes de reconciliar falha se QUALQUER das duas
//    leituras falhar; a conferência depois de um fechamento repetido também;
//  - o "olho" que esconde valores: armazenamento bloqueado mostra os valores
//    (nunca esconde sem saber), "1" esconde, outro valor mostra.
// Dados inventados.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(nome: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import {
  CHAVE_VALORES_OCULTOS,
  type ConsultaFinanceira,
  abrirCaixa,
  baixarLancamento,
  cancelarLancamento,
  conferirCaixaDepoisDoReplay,
  conferirCaixaParaReconciliar,
  fecharCaixa,
  movimentarCaixa,
  salvarCategoria,
  salvarConta,
  salvarLancamento,
  useCaixaAtual,
  useCategoriasFinanceiras,
  useContasFinanceiras,
  useDreFinanceira,
  useDreMensal,
  useHistoricoDoCaixa,
  useResumoFinanceiro,
  useValoresOcultos,
} from "@/hooks/useFinanceiro";
import { mensagemDeErroFinanceiro } from "@/lib/financeiro";
import type { IntervaloDeDatas } from "@/types/financeiro";

const ERRO_DE_PERMISSAO = { code: "42501", message: "permission denied" };
const FRASE_DE_PERMISSAO = mensagemDeErroFinanceiro(ERRO_DE_PERMISSAO);
const SETEMBRO: IntervaloDeDatas = { inicio: "2026-09-01", fim: "2026-09-30" };
const OUTUBRO: IntervaloDeDatas = { inicio: "2026-10-01", fim: "2026-10-31" };

describe("Financeiro — gravações: erro do banco rejeita, sem erro resolve", () => {
  type Gravacao = [
    string,
    () => Promise<unknown>,
    string,
    unknown, // resposta boa do banco
    unknown, // o que a função DEVOLVE com essa resposta (escrito à mão, não derivado)
  ];
  const gravacoes: Gravacao[] = [
    [
      "salvarLancamento",
      () => salvarLancamento({} as Parameters<typeof salvarLancamento>[0]),
      "fin_lancamento_salvar",
      { ids: ["lanc-1"] },
      ["lanc-1"],
    ],
    [
      "baixarLancamento",
      () => baixarLancamento({ id: "lanc-1", contaId: null }),
      "fin_lancamento_baixar",
      null,
      undefined,
    ],
    [
      "cancelarLancamento",
      () => cancelarLancamento({ id: "lanc-1", motivo: "engano" }),
      "fin_lancamento_cancelar",
      null,
      undefined,
    ],
    [
      "abrirCaixa",
      () => abrirCaixa({ valorAbertura: 50, contaId: null }),
      "fin_caixa_abrir",
      null,
      undefined,
    ],
    [
      "movimentarCaixa",
      () =>
        movimentarCaixa({
          sessaoId: "sessao-1",
          chave: "chave-1",
          tipo: "sangria",
          valor: 10,
          descricao: "troco",
          contaContrapartida: null,
        }),
      "fin_caixa_movimentar_com_chave",
      { id: "mov-1", replay: false, status: "ok" },
      { id: "mov-1", replay: false, status: "ok" },
    ],
    [
      "fecharCaixa",
      () =>
        fecharCaixa({
          sessaoId: "sessao-1",
          valorContado: 90,
          observacao: null,
        }),
      "fin_caixa_fechar_sessao",
      { id: "sessao-1", esperado: 100, contado: 90, diferenca: -10 },
      {
        id: "sessao-1",
        esperado: 100,
        contado: 90,
        diferenca: -10,
        replay: false,
      },
    ],
    ["salvarConta", () => salvarConta({}), "fin_conta_salvar", null, undefined],
    [
      "salvarCategoria",
      () => salvarCategoria({} as Parameters<typeof salvarCategoria>[0]),
      "fin_categoria_salvar",
      null,
      undefined,
    ],
  ];

  beforeEach(() => {
    rpc.mockReset();
  });

  it.each(gravacoes)(
    "%s: erro do banco rejeita com o erro de verdade",
    async (_n, gravar, nomeDaRpc, ruim) => {
      rpc.mockResolvedValue({ data: ruim, error: ERRO_DE_PERMISSAO });
      await expect(gravar()).rejects.toBe(ERRO_DE_PERMISSAO);
      expect(rpc.mock.calls[0]?.[0]).toBe(nomeDaRpc);
    },
  );

  it.each(gravacoes)(
    "%s: sem erro resolve com o que o banco devolveu (tratado), nunca com outra coisa",
    async (_n, gravar, nomeDaRpc, boa, esperado) => {
      rpc.mockResolvedValue({ data: boa, error: null });
      await expect(gravar()).resolves.toEqual(esperado);
      expect(rpc.mock.calls[0]?.[0]).toBe(nomeDaRpc);
    },
  );

  it("conferir o caixa antes de reconciliar: falha com erro de QUALQUER das duas leituras", async () => {
    rpc.mockImplementation((nome) =>
      Promise.resolve(
        nome === "fin_caixa_atual"
          ? { data: null, error: ERRO_DE_PERMISSAO }
          : { data: [], error: null },
      ),
    );
    await expect(conferirCaixaParaReconciliar()).rejects.toBe(
      ERRO_DE_PERMISSAO,
    );

    rpc.mockImplementation((nome) =>
      Promise.resolve(
        nome === "fin_caixa_historico"
          ? { data: null, error: ERRO_DE_PERMISSAO }
          : { data: null, error: null },
      ),
    );
    await expect(conferirCaixaParaReconciliar()).rejects.toBe(
      ERRO_DE_PERMISSAO,
    );

    rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    rpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: null }),
    );
    await expect(conferirCaixaParaReconciliar()).resolves.toBeUndefined();
  });

  it("conferir o caixa depois de um fechamento repetido: erro de QUALQUER leitura sobe, sem dado inventado", async () => {
    rpc.mockImplementation((nome) =>
      Promise.resolve(
        nome === "fin_caixa_atual"
          ? { data: { id: "sessao-2" }, error: ERRO_DE_PERMISSAO }
          : { data: [], error: null },
      ),
    );
    await expect(conferirCaixaDepoisDoReplay("sessao-1")).rejects.toBe(
      ERRO_DE_PERMISSAO,
    );

    rpc.mockImplementation((nome) =>
      Promise.resolve(
        nome === "fin_caixa_historico"
          ? { data: [], error: ERRO_DE_PERMISSAO }
          : { data: null, error: null },
      ),
    );
    await expect(conferirCaixaDepoisDoReplay("sessao-1")).rejects.toBe(
      ERRO_DE_PERMISSAO,
    );

    // Sem erro: o caixa aberto de agora e quando AQUELE caixa fechou.
    rpc.mockImplementation((nome) =>
      Promise.resolve(
        nome === "fin_caixa_atual"
          ? { data: { id: "sessao-2" }, error: null }
          : {
              data: [
                { id: "sessao-2", aberto_em: "2026-09-26T11:00:00Z" },
                {
                  id: "sessao-1",
                  aberto_em: "2026-09-25T12:00:00Z",
                  fechado_em: "2026-09-25T22:02:00Z",
                },
              ],
              error: null,
            },
      ),
    );
    await expect(conferirCaixaDepoisDoReplay("sessao-1")).resolves.toEqual({
      caixaAbertoId: "sessao-2",
      fechadoEm: "2026-09-25T22:02:00Z",
    });

    // Nenhum caixa aberto, e o fechado fora da lista: nada se inventa.
    rpc.mockImplementation((nome) =>
      Promise.resolve(
        nome === "fin_caixa_atual"
          ? { data: null, error: null }
          : { data: [], error: null },
      ),
    );
    await expect(conferirCaixaDepoisDoReplay("sessao-1")).resolves.toEqual({
      caixaAbertoId: null,
      fechadoEm: null,
    });
  });
});

describe("Financeiro — leituras: erro do banco vence a resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let visto: ConsultaFinanceira<unknown>;

  function Sonda({ usar }: { usar: () => ConsultaFinanceira<unknown> }) {
    const valor = usar();
    useEffect(() => {
      visto = valor;
    });
    return null;
  }
  async function ler(usar: () => ConsultaFinanceira<unknown>) {
    await act(async () => raiz.render(<Sonda usar={usar} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const leituras: Array<[string, () => ConsultaFinanceira<unknown>, unknown]> =
    [
      [
        "resumo",
        () => useResumoFinanceiro(SETEMBRO, true, 0),
        { saldo_total: 10, contas: [], serie: [] },
      ],
      ["DRE", () => useDreFinanceira(SETEMBRO, true, 0), { receita: 10 }],
      [
        "DRE mensal",
        () => useDreMensal([SETEMBRO, OUTUBRO], true, 0),
        { receita: 10 },
      ],
      [
        "contas",
        () => useContasFinanceiras(true, 0),
        [{ id: "c1", nome: "Caixa" }],
      ],
      [
        "categorias",
        () => useCategoriasFinanceiras(true, 0),
        [{ id: "k1", nome: "Aluguel" }],
      ],
      ["caixa atual", () => useCaixaAtual(true, 0), { id: "s1" }],
      [
        "histórico do caixa",
        () => useHistoricoDoCaixa(true, 0),
        [{ id: "s1", status: "fechado" }],
      ],
    ];

  it.each(leituras)(
    "%s: erro do banco com resposta junto => nenhum dado e a frase do erro",
    async (_n, usar, resposta) => {
      rpc.mockResolvedValue({ data: resposta, error: ERRO_DE_PERMISSAO });
      await ler(usar);
      expect(visto.dados).toBeNull();
      expect(visto.erro).toBe(FRASE_DE_PERMISSAO);
      expect(visto.carregando).toBe(false);
    },
  );

  it.each(leituras)(
    "%s: sem erro entrega dados e nenhum erro",
    async (_n, usar, resposta) => {
      rpc.mockResolvedValue({ data: resposta, error: null });
      await ler(usar);
      expect(visto.erro).toBeNull();
      expect(visto.dados).not.toBeNull();
    },
  );

  it("DRE mensal com um só mês não consulta (precisa de 2 ou mais)", async () => {
    await ler(() => useDreMensal([SETEMBRO], true, 0));
    expect(rpc).not.toHaveBeenCalled();
    await ler(() => useDreMensal([], true, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("DRE mensal: aba parada não consulta", async () => {
    await ler(() => useDreMensal([SETEMBRO, OUTUBRO], false, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("DRE mensal com 2 meses consulta a DRE de cada mês, na ordem", async () => {
    rpc.mockResolvedValue({ data: { receita: 10 }, error: null });
    await ler(() => useDreMensal([SETEMBRO, OUTUBRO], true, 0));
    expect(rpc.mock.calls).toEqual([
      ["fin_dre", { p_inicio: "2026-09-01", p_fim: "2026-09-30" }],
      ["fin_dre", { p_inicio: "2026-10-01", p_fim: "2026-10-31" }],
    ]);
  });
});

const ARMAZENAMENTO_BLOQUEADO = {
  getItem: () => {
    throw new Error("bloqueado");
  },
  setItem: () => {
    throw new Error("bloqueado");
  },
  removeItem: () => {
    throw new Error("bloqueado");
  },
};
const ARMAZENAMENTO_DE_VERDADE = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
/** Aparelho com o armazenamento bloqueado (aba anônima, política do navegador). */
const bloquearOArmazenamento = () =>
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: ARMAZENAMENTO_BLOQUEADO,
  });

describe("Financeiro — o olho que esconde os valores", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let estado: readonly [boolean, () => void];

  function Sonda() {
    const valor = useValoresOcultos();
    useEffect(() => {
      estado = valor;
    });
    return null;
  }

  beforeEach(() => {
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    if (ARMAZENAMENTO_DE_VERDADE) {
      Object.defineProperty(
        globalThis,
        "localStorage",
        ARMAZENAMENTO_DE_VERDADE,
      );
    }
    localStorage.clear();
  });

  it("armazenamento bloqueado: nasce mostrando os valores (não esconde sem saber)", async () => {
    bloquearOArmazenamento();
    await act(async () => raiz.render(<Sonda />));
    expect(estado[0]).toBe(false);
  });

  it("'1' guardado esconde; qualquer outro valor mostra", async () => {
    localStorage.setItem(CHAVE_VALORES_OCULTOS, "1");
    await act(async () => raiz.render(<Sonda />));
    expect(estado[0]).toBe(true);
    await act(async () => raiz.unmount());

    localStorage.setItem(CHAVE_VALORES_OCULTOS, "true");
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
    expect(estado[0]).toBe(false);
  });

  it("alternar esconde e lembra; alternar de novo mostra e esquece", async () => {
    await act(async () => raiz.render(<Sonda />));
    expect(estado[0]).toBe(false);
    await act(async () => estado[1]());
    expect(estado[0]).toBe(true);
    expect(localStorage.getItem(CHAVE_VALORES_OCULTOS)).toBe("1");
    await act(async () => estado[1]());
    expect(estado[0]).toBe(false);
    expect(localStorage.getItem(CHAVE_VALORES_OCULTOS)).toBeNull();
  });

  it("alternar com o armazenamento bloqueado vale só nesta visita, sem quebrar", async () => {
    bloquearOArmazenamento();
    await act(async () => raiz.render(<Sonda />));
    await act(async () => estado[1]());
    expect(estado[0]).toBe(true);
  });
});
