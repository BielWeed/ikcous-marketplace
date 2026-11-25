// @vitest-environment jsdom
// O Financeiro nunca mostra como "lista" o que o banco recusou:
//  - extrato e previstos com ERRO do banco viram erro na tela e nenhum dado,
//    mesmo que a resposta traga linhas junto;
//  - sem erro, a lista chega parseada (e o previsto entra com o tipo pedido);
//  - aba parada (`ativo` falso) ou extrato sem período escolhido não vão ao banco.
// Dados inventados.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(nome: string, args: unknown) => Promise<unknown>>(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import {
  useExtratoFinanceiro,
  usePrevistosFinanceiros,
} from "@/hooks/useFinanceiro";
import type { IntervaloDeDatas } from "@/types/financeiro";

const SETEMBRO: IntervaloDeDatas = { inicio: "2026-09-01", fim: "2026-09-30" };

const LINHA_DO_EXTRATO = {
  id: "lanc-1",
  data: "2026-09-10",
  valor: 10,
  origem: "manual",
  tipo: "entrada",
  status: "realizado",
  descricao: "venda no balcao",
  editavel: false,
};
const LINHA_DO_PREVISTO = {
  id: "prev-1",
  descricao: "aluguel",
  valor: 800,
  vencimento: "2026-09-20",
  vencido: false,
  origem: "manual",
};

interface Visto {
  carregando: boolean;
  erro: string | null;
  dados: readonly unknown[] | null;
}
let visto: Visto;

function SondaDoExtrato({
  intervalo,
  ativo,
}: {
  readonly intervalo: IntervaloDeDatas | null;
  readonly ativo: boolean;
}) {
  const c = useExtratoFinanceiro(intervalo, null, ativo, 0);
  useEffect(() => {
    visto = { carregando: c.carregando, erro: c.erro, dados: c.dados };
  });
  return null;
}
function SondaDosPrevistos({
  tipo,
  ativo,
}: {
  readonly tipo: "entrada" | "saida";
  readonly ativo: boolean;
}) {
  const c = usePrevistosFinanceiros(tipo, ativo, 0);
  useEffect(() => {
    visto = { carregando: c.carregando, erro: c.erro, dados: c.dados };
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
async function montar(elemento: React.ReactElement) {
  await act(async () => raiz.render(elemento));
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

describe("Financeiro — extrato", () => {
  it("sem erro: entrega as linhas parseadas, sem erro", async () => {
    rpc.mockResolvedValue({ data: [LINHA_DO_EXTRATO], error: null });
    await montar(<SondaDoExtrato intervalo={SETEMBRO} ativo={true} />);
    expect(rpc).toHaveBeenCalledWith("fin_extrato", {
      p_inicio: "2026-09-01",
      p_fim: "2026-09-30",
      p_conta_id: null,
    });
    expect(visto.erro).toBeNull();
    expect(visto.dados).toEqual([
      expect.objectContaining({ id: "lanc-1", valor: 10, tipo: "entrada" }),
    ]);
  });

  it("erro do banco vence mesmo com linhas junto: nenhum dado e um erro para a tela", async () => {
    rpc.mockResolvedValue({
      data: [LINHA_DO_EXTRATO],
      error: { code: "42501", message: "permission denied" },
    });
    await montar(<SondaDoExtrato intervalo={SETEMBRO} ativo={true} />);
    expect(visto.dados).toBeNull();
    expect(visto.erro).toEqual(expect.any(String));
    expect(visto.erro).not.toBe("");
    expect(visto.carregando).toBe(false);
  });

  it("aba parada: não consulta", async () => {
    await montar(<SondaDoExtrato intervalo={SETEMBRO} ativo={false} />);
    expect(rpc).not.toHaveBeenCalled();
    expect(visto.carregando).toBe(false);
  });

  it("aba ativa sem período escolhido: não consulta", async () => {
    await montar(<SondaDoExtrato intervalo={null} ativo={true} />);
    expect(rpc).not.toHaveBeenCalled();
    expect(visto.carregando).toBe(false);
  });
});

describe("Financeiro — previstos", () => {
  it("sem erro: entrega os previstos do tipo pedido, com o valor sempre positivo", async () => {
    rpc.mockResolvedValue({
      data: [{ ...LINHA_DO_PREVISTO, valor: -800 }],
      error: null,
    });
    await montar(<SondaDosPrevistos tipo="saida" ativo={true} />);
    expect(rpc).toHaveBeenCalledWith("fin_previstos", { p_tipo: "saida" });
    expect(visto.erro).toBeNull();
    expect(visto.dados).toEqual([
      expect.objectContaining({ id: "prev-1", valor: 800, vencido: false }),
    ]);
  });

  it("erro do banco vence mesmo com linhas junto: nenhum dado e um erro para a tela", async () => {
    rpc.mockResolvedValue({
      data: [LINHA_DO_PREVISTO],
      error: { code: "42501", message: "permission denied" },
    });
    await montar(<SondaDosPrevistos tipo="entrada" ativo={true} />);
    expect(visto.dados).toBeNull();
    expect(visto.erro).toEqual(expect.any(String));
    expect(visto.erro).not.toBe("");
  });

  it("aba parada: não consulta", async () => {
    await montar(<SondaDosPrevistos tipo="entrada" ativo={false} />);
    expect(rpc).not.toHaveBeenCalled();
  });
});
