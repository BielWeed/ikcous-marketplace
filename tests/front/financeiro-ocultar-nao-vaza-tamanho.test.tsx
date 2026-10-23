// @vitest-environment jsdom
//
// Financeiro — com "Ocultar" ligado o TAMANHO da letra do valor não pode
// contar quantos dígitos o valor real tem (achado da revisão do redesenho:
// R$ 50,00 saía em 22px e R$ 12.345,67 em 15px, e quem olhava por cima do
// ombro adivinhava a ordem de grandeza mesmo com a máscara na tela).
//
// Para cada superfície com valor grande (Visão: saldo, Entradas, A pagar;
// Extrato: cartão do topo; Caixa: esperado; Resultado: Lucro líquido) o teste
// monta a tela com dois valores de ordem de grandeza bem diferente:
//  - Ocultar LIGADO: a classe de tamanho do elemento do valor é IDÊNTICA;
//  - Ocultar DESLIGADO: continua diferente (o encolhimento segue valendo).
// jsdom não mede pixel: aqui se prova a classe, não o encaixe da máscara.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import { AbaExtrato } from "@/components/admin/financeiro/AbaExtrato";
import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import { CONTA_BANCARIA } from "@/types/financeiro";

const CURTO = 50;
const GIGANTE = 1234567.89;

/** Valor em reais que cada RPC devolve agora (o teste troca entre as rodadas). */
let valor = CURTO;

const resumo = () => ({
  periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
  saldo_total: valor,
  contas: [],
  entradas: valor,
  saidas: 0,
  resultado: valor,
  a_receber: { total: valor, vencido: 0, proximos_7_dias: 0 },
  a_pagar: { total: valor, vencido: 0, proximos_7_dias: 0 },
  por_forma: [],
  por_canal: { online: 0, presencial: 0 },
  serie: [],
  caixa_aberto: null,
});

const caixaAberto = () => ({
  id: "sessao-1",
  conta_id: "conta-caixa",
  conta_nome: "Caixa da loja",
  aberto_em: "2026-10-23T11:12:00Z",
  valor_abertura: 0,
  vendas_dinheiro: valor,
  devolucoes_dinheiro: 0,
  estornos_externos_dinheiro: 0,
  entradas_manuais: 0,
  saidas_manuais: 0,
  esperado: valor,
  movimentos: [],
});

const dre = () => ({
  receita_bruta: 10000,
  receita_online: 6000,
  receita_balcao: 4000,
  deducoes: 500,
  receita_liquida: 9500,
  cmv: 3800,
  cmv_estimado: false,
  lucro_bruto: 5700,
  custos_variaveis: 950,
  margem_contribuicao: 4750,
  despesas_fixas: 2850,
  resultado_operacional: 1900,
  resultado_financeiro: -95,
  lucro_liquido: valor,
  linhas: [],
});

const extrato = () => [
  {
    id: "v1",
    origem: "manual",
    tipo: "entrada",
    status: "realizado",
    valor,
    data: "2026-10-23",
    conta_id: CONTA_BANCARIA,
    conta_nome: "Conta bancária",
    categoria_nome: "Vendas",
    descricao: "Lançamento",
    editavel: false,
  },
];

const noop = () => {};

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Só as classes de TAMANHO de letra (cor e peso ficam de fora da comparação). */
function tamanhoDe(el: Element): string {
  const tamanhos = [...el.classList].filter((c) =>
    /^text-(xs|sm|base|lg|xl|\d*xl|\[\d+px\]|\[clamp\(.*\)\])$/.test(c),
  );
  expect(tamanhos.length, `classe de tamanho em "${el.className}"`).toBe(1);
  return tamanhos[0] as string;
}

const numeros = (raiz: ParentNode) => [
  ...raiz.querySelectorAll<HTMLElement>(".tabular-nums"),
];

interface Superficie {
  readonly nome: string;
  readonly render: () => React.ReactNode;
  /** O elemento (do `<Dinheiro>`) cujo tamanho de letra está sob teste. */
  readonly achar: (hospedeiro: HTMLElement) => Element;
}

const SUPERFICIES: readonly Superficie[] = [
  {
    nome: "Visão — saldo total (herói)",
    render: () => (
      <AbaVisao
        ativo
        intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
        hoje="2026-10-23"
        versao={0}
        contas={[]}
        irParaAba={noop}
        verPrevistos={noop}
      />
    ),
    achar: (h) =>
      numeros(
        h.querySelector('section[aria-label="Saldo total"]') as HTMLElement,
      )[0] as Element,
  },
  {
    nome: "Visão — Entradas",
    render: () => (
      <AbaVisao
        ativo
        intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
        hoje="2026-10-23"
        versao={0}
        contas={[]}
        irParaAba={noop}
        verPrevistos={noop}
      />
    ),
    achar: (h) => {
      const dt = [...h.querySelectorAll("dt")].find(
        (e) => e.textContent === "Entradas",
      ) as Element;
      return numeros(dt.nextElementSibling as HTMLElement)[0] as Element;
    },
  },
  {
    nome: "Visão — A pagar",
    render: () => (
      <AbaVisao
        ativo
        intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
        hoje="2026-10-23"
        versao={0}
        contas={[]}
        irParaAba={noop}
        verPrevistos={noop}
      />
    ),
    achar: (h) =>
      numeros(
        h.querySelector('section[aria-label="A pagar"]') as HTMLElement,
      )[0] as Element,
  },
  {
    nome: "Extrato — cartão do topo",
    render: () => (
      <AbaExtrato
        ativo
        intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
        hoje="2026-10-23"
        versao={0}
        contas={[]}
        rotuloDoPeriodo="Outubro de 2026"
        abrirFolha={noop}
        aoNovoLancamento={noop}
      />
    ),
    achar: (h) =>
      numeros(
        h.querySelector(
          'section[aria-label="Resultado do período"]',
        ) as HTMLElement,
      )[0] as Element,
  },
  {
    nome: "Caixa — esperado na gaveta",
    render: () => (
      <AbaCaixa
        ativo
        versao={0}
        abrirFolha={noop}
        aoNovoLancamento={noop}
        mostrarAcaoFixa
      />
    ),
    achar: (h) =>
      numeros(
        h.querySelector(
          'section[aria-label="Esperado na gaveta"]',
        ) as HTMLElement,
      )[0] as Element,
  },
  {
    nome: "Resultado — quadro Lucro líquido",
    render: () => (
      <AbaDre
        ativo
        intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
        versao={0}
        rotuloDoPeriodo="Outubro de 2026"
      />
    ),
    achar: (h) => {
      const quadro = [
        ...h.querySelectorAll<HTMLElement>("[data-quadro-do-resultado]"),
      ].find(
        (q) =>
          q.querySelector("[data-rotulo-do-kpi]")?.textContent ===
          "Lucro líquido",
      ) as HTMLElement;
      return numeros(quadro)[0] as Element;
    },
  },
];

describe("Financeiro — Ocultar não vaza o tamanho do valor", () => {
  let raiz: Root | null = null;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T13:00:00Z"));
    valor = CURTO;
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      switch (nome) {
        case "fin_resumo":
          return { data: resumo(), error: null };
        case "fin_caixa_atual":
          return { data: caixaAberto(), error: null };
        case "fin_caixa_historico":
          return { data: [], error: null };
        case "fin_dre":
        case "fin_dre_mensal":
          return { data: dre(), error: null };
        case "fin_extrato":
          return { data: extrato(), error: null };
        default:
          return { data: [], error: null };
      }
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
  });

  afterEach(() => {
    if (raiz) {
      const atual = raiz;
      act(() => {
        atual.unmount();
      });
    }
    raiz = null;
    hospedeiro.remove();
    vi.useRealTimers();
  });

  /** Monta a superfície com o valor e o Ocultar dados; devolve o tamanho. */
  async function tamanhoCom(
    superficie: Superficie,
    reais: number,
    ocultos: boolean,
  ): Promise<{ tamanho: string; texto: string }> {
    valor = reais;
    raiz = createRoot(hospedeiro);
    const atual = raiz;
    await act(async () => {
      atual.render(
        <ContextoValoresOcultos.Provider value={ocultos}>
          {superficie.render()}
        </ContextoValoresOcultos.Provider>,
      );
    });
    await esperar();
    const el = superficie.achar(hospedeiro);
    const resultado = {
      tamanho: tamanhoDe(el),
      texto: el.textContent ?? "",
    };
    act(() => {
      atual.unmount();
    });
    raiz = null;
    return resultado;
  }

  describe.each(SUPERFICIES)("$nome", (superficie) => {
    it("Ocultar LIGADO: valor curto e gigante têm a MESMA classe de tamanho", async () => {
      const curto = await tamanhoCom(superficie, CURTO, true);
      const gigante = await tamanhoCom(superficie, GIGANTE, true);
      // Controle: de fato é a máscara, não o número, que está na tela.
      expect(curto.texto).toContain("Valor oculto");
      expect(gigante.texto).toContain("Valor oculto");
      expect(curto.texto).not.toMatch(/\d/);
      expect(gigante.texto).not.toMatch(/\d/);
      expect(gigante.tamanho).toBe(curto.tamanho);
    });

    it("Ocultar DESLIGADO: o encolhimento segue valendo (tamanhos diferentes)", async () => {
      const curto = await tamanhoCom(superficie, CURTO, false);
      const gigante = await tamanhoCom(superficie, GIGANTE, false);
      expect(curto.texto).toMatch(/\d/);
      expect(gigante.texto).toMatch(/\d/);
      expect(gigante.tamanho).not.toBe(curto.tamanho);
    });
  });
});
