// @vitest-environment jsdom
//
// Financeiro — rede que conecta e NÃO responde. Antes, toda leitura (`fin_*`)
// ficava pendurada para sempre: o esqueleto girava sem erro e sem "Tentar de
// novo", e o saldo/"esperado na gaveta" de antes continuava na tela como se
// fosse de agora. Agora a leitura estoura em 20 s: vira erro (com o botão que
// as abas já têm) e, havendo valor antigo, a tela marca "Valor de antes".
// É só leitura: nada de gravação aqui, e nenhum cálculo de saldo mudou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import {
  type ConsultaFinanceira,
  ContextoDoCacheFinanceiro,
  useCaixaAtual,
  useCategoriasFinanceiras,
  useContasFinanceiras,
  useDreFinanceira,
  useDreMensal,
  useExtratoFinanceiro,
  useHistoricoDoCaixa,
  usePrevistosFinanceiros,
  useResumoFinanceiro,
} from "@/hooks/useFinanceiro";
import { MENSAGEM_CONEXAO_LENTA } from "@/lib/prazo-da-requisicao";

const PRAZO = 20_000;
const INTERVALO = { inicio: "2026-10-01", fim: "2026-10-31" } as const;
const MESES = [
  { inicio: "2026-09-01", fim: "2026-09-30" },
  { inicio: "2026-10-01", fim: "2026-10-31" },
] as const;

// Nomes `useSonda…` para o lint de hooks: cada uma chama UM hook de leitura.
const useSondaResumo = (v: number) =>
  useResumoFinanceiro(INTERVALO, true, v) as ConsultaFinanceira<unknown>;
const useSondaExtrato = (v: number) =>
  useExtratoFinanceiro(INTERVALO, null, true, v) as ConsultaFinanceira<unknown>;
const useSondaPrevistos = (v: number) =>
  usePrevistosFinanceiros("entrada", true, v) as ConsultaFinanceira<unknown>;
const useSondaDre = (v: number) =>
  useDreFinanceira(INTERVALO, true, v) as ConsultaFinanceira<unknown>;
const useSondaDreMensal = (v: number) =>
  useDreMensal(MESES, true, v) as ConsultaFinanceira<unknown>;
const useSondaContas = (v: number) =>
  useContasFinanceiras(true, v) as ConsultaFinanceira<unknown>;
const useSondaCategorias = (v: number) =>
  useCategoriasFinanceiras(true, v) as ConsultaFinanceira<unknown>;
const useSondaCaixa = (v: number) =>
  useCaixaAtual(true, v) as ConsultaFinanceira<unknown>;
const useSondaHistorico = (v: number) =>
  useHistoricoDoCaixa(true, v) as ConsultaFinanceira<unknown>;

const LEITURAS: ReadonlyArray<
  readonly [string, (versao: number) => ConsultaFinanceira<unknown>]
> = [
  ["fin_resumo", useSondaResumo],
  ["fin_extrato", useSondaExtrato],
  ["fin_previstos", useSondaPrevistos],
  ["fin_dre", useSondaDre],
  ["fin_dre (por mês)", useSondaDreMensal],
  ["fin_contas_listar", useSondaContas],
  ["fin_categorias_listar", useSondaCategorias],
  ["fin_caixa_atual", useSondaCaixa],
  ["fin_caixa_historico", useSondaHistorico],
];

function Sonda({
  usar,
  versao,
}: {
  readonly usar: (versao: number) => ConsultaFinanceira<unknown>;
  readonly versao: number;
}) {
  const c = usar(versao);
  return (
    <div
      data-sonda=""
      data-carregando={String(c.carregando)}
      data-erro={c.erro ?? ""}
      data-dados={c.dados === null ? "" : JSON.stringify(c.dados)}
    >
      <button type="button" onClick={c.recarregar}>
        Tentar de novo
      </button>
    </div>
  );
}

const sondaNaTela = () =>
  document.querySelector<HTMLElement>("[data-sonda]") as HTMLElement;
const botao = (rotulo: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.textContent ?? "").replace(/\s+/g, " ").trim() === rotulo,
  );

const caixaDoServidor = (esperado: number) => ({
  id: "sessao-1",
  conta_id: "caixa-da-loja",
  conta_nome: "Caixa da loja",
  aberto_em: "2026-11-08T11:12:00Z",
  valor_abertura: 100,
  vendas_dinheiro: 0,
  devolucoes_dinheiro: 0,
  estornos_externos_dinheiro: 0,
  entradas_manuais: 0,
  saidas_manuais: 0,
  esperado,
  movimentos: [],
});

let host: HTMLDivElement;
let root: Root;

const nuncaResponde = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const avancar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function montar(
  usar: (versao: number) => ConsultaFinanceira<unknown>,
  versao = 0,
  cache: Map<string, unknown> | null = null,
) {
  await act(async () =>
    root.render(
      <ContextoDoCacheFinanceiro.Provider value={cache}>
        <Sonda usar={usar} versao={versao} />
      </ContextoDoCacheFinanceiro.Provider>,
    ),
  );
}

describe("Financeiro — leituras que não respondem estouram em 20 s", () => {
  it.each(LEITURAS)(
    "%s: gira até 20 s e então vira erro com frase de conexão lenta",
    async (_nome, usar) => {
      rpc.mockImplementation(nuncaResponde);
      await montar(usar);

      expect(sondaNaTela().dataset.carregando).toBe("true");
      await avancar(PRAZO - 1);
      expect(sondaNaTela().dataset.carregando).toBe("true");
      expect(sondaNaTela().dataset.erro).toBe("");

      await avancar(1);
      expect(sondaNaTela().dataset.carregando).toBe("false");
      expect(sondaNaTela().dataset.erro).toBe(MENSAGEM_CONEXAO_LENTA);
      expect(sondaNaTela().dataset.dados).toBe("");
    },
  );

  it("resposta que chega a tempo não vira erro depois (o relógio é desarmado)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await montar(useSondaContas);
    await avancar(0);
    expect(sondaNaTela().dataset.carregando).toBe("false");
    expect(sondaNaTela().dataset.dados).toBe("[]");

    await avancar(PRAZO * 2);
    expect(sondaNaTela().dataset.erro).toBe("");
    expect(sondaNaTela().dataset.dados).toBe("[]");
  });

  it("erro de verdade do servidor continua com a frase de sempre (não vira 'conexão lenta')", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    await montar(useSondaContas);
    await avancar(0);
    expect(sondaNaTela().dataset.erro).toContain("administrador");
    expect(sondaNaTela().dataset.erro).not.toBe(MENSAGEM_CONEXAO_LENTA);
  });

  it("Tentar de novo depois do estouro lê de novo e limpa o erro", async () => {
    rpc.mockImplementationOnce(nuncaResponde);
    await montar(useSondaContas);
    await avancar(PRAZO);
    expect(sondaNaTela().dataset.erro).toBe(MENSAGEM_CONEXAO_LENTA);

    rpc.mockResolvedValue({ data: [], error: null });
    await act(async () => botao("Tentar de novo")!.click());
    await avancar(0);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sondaNaTela().dataset.erro).toBe("");
    expect(sondaNaTela().dataset.carregando).toBe("false");
    expect(sondaNaTela().dataset.dados).toBe("[]");
  });

  it("releitura que trava mantém o valor de antes na tela e acusa o erro", async () => {
    const cache = new Map<string, unknown>();
    rpc.mockResolvedValueOnce({ data: caixaDoServidor(100), error: null });
    await montar(useSondaCaixa, 0, cache);
    await avancar(0);
    expect(sondaNaTela().dataset.dados).toContain('"esperado":100');
    expect(sondaNaTela().dataset.erro).toBe("");

    // Depois de uma escrita a view sobe a versão e a leitura trava.
    rpc.mockImplementation(nuncaResponde);
    await montar(useSondaCaixa, 1, cache);
    expect(sondaNaTela().dataset.carregando).toBe("true");
    await avancar(PRAZO);

    expect(sondaNaTela().dataset.carregando).toBe("false");
    expect(sondaNaTela().dataset.erro).toBe(MENSAGEM_CONEXAO_LENTA);
    expect(sondaNaTela().dataset.dados).toContain('"esperado":100');
  });

  it("resposta que chega DEPOIS do estouro não apaga o aviso nem troca o valor sozinha", async () => {
    let entregar: (v: unknown) => void = () => {};
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          entregar = resolve;
        }),
    );
    await montar(useSondaCaixa);
    await avancar(PRAZO);
    expect(sondaNaTela().dataset.erro).toBe(MENSAGEM_CONEXAO_LENTA);

    await act(async () => {
      entregar({ data: caixaDoServidor(999), error: null });
      await Promise.resolve();
    });
    await avancar(0);

    expect(sondaNaTela().dataset.erro).toBe(MENSAGEM_CONEXAO_LENTA);
    expect(sondaNaTela().dataset.dados).toBe("");
  });

  it("sair da tela com a leitura pendurada não gera erro nem aviso no console", async () => {
    const erroNoConsole = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    rpc.mockImplementation(nuncaResponde);
    await montar(useSondaResumo);
    await act(async () => root.render(<div />));
    await avancar(PRAZO * 2);
    expect(erroNoConsole).not.toHaveBeenCalled();
  });
});

describe("aba Caixa — o esperado de antes vem marcado quando a leitura trava", () => {
  it("com o valor de antes no cache: marca 'pode estar desatualizado' e o Tentar de novo corrige", async () => {
    const cache = new Map<string, unknown>();
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "fin_caixa_historico") return { data: [], error: null };
      return { data: caixaDoServidor(100), error: null };
    });
    const tela = (versao: number) => (
      <ContextoDoCacheFinanceiro.Provider value={cache}>
        <AbaCaixa ativo versao={versao} abrirFolha={vi.fn()} />
      </ContextoDoCacheFinanceiro.Provider>
    );
    await act(async () => root.render(tela(0)));
    await avancar(0);
    const cartao = () =>
      document.querySelector<HTMLElement>(
        'section[aria-label="Esperado na gaveta"]',
      );
    expect(cartao()).not.toBeNull();
    expect(cartao()!.dataset.valorDesatualizado).toBeUndefined();

    rpc.mockImplementation(async (nome: string) => {
      if (nome === "fin_caixa_historico") return { data: [], error: null };
      return nuncaResponde();
    });
    await act(async () => root.render(tela(1)));
    await avancar(PRAZO - 1);
    expect(cartao()!.dataset.valorDesatualizado).toBeUndefined();
    await avancar(1);

    expect(cartao()!.dataset.valorDesatualizado).toBe("true");
    expect(cartao()!.textContent).toMatch(/Valor de antes/);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      MENSAGEM_CONEXAO_LENTA,
    );

    rpc.mockImplementation(async (nome: string) => {
      if (nome === "fin_caixa_historico") return { data: [], error: null };
      return { data: caixaDoServidor(250), error: null };
    });
    await act(async () => botao("Tentar de novo")!.click());
    await avancar(0);

    expect(cartao()!.dataset.valorDesatualizado).toBeUndefined();
    expect(cartao()!.textContent).toMatch(/250/);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
