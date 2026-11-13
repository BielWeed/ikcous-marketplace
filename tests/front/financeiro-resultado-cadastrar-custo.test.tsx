// @vitest-environment jsdom
//
// Financeiro — Resultado: quando o lucro usa custo ESTIMADO, o aviso agora vem
// com o caminho para cadastrar os custos (a lista de produtos já filtrada em
// "sem custo"), o mesmo botão que o Início oferece. Só navegação: nenhum valor
// em reais muda, e sem `onNavigate` (ou sem estimativa) o botão não existe.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import type { IntervaloDeDatas } from "@/types/financeiro";
import { VISAO_SEM_CUSTO } from "@/utils/produtos-sem-custo";

const DRE = {
  receita_bruta: 200,
  receita_online: 200,
  receita_balcao: 0,
  deducoes: 0,
  receita_liquida: 200,
  cmv: 80,
  cmv_estimado: true,
  lucro_bruto: 120,
  custos_variaveis: 0,
  margem_contribuicao: 120,
  despesas_fixas: 50,
  resultado_operacional: 70,
  resultado_financeiro: 0,
  lucro_liquido: 70,
  linhas: [{ grupo: "despesa_fixa", categoria: "Aluguel", valor: 50 }],
};

const OUTUBRO: IntervaloDeDatas = { inicio: "2026-10-01", fim: "2026-10-31" };
const TEXTO_DO_BOTAO = "Cadastrar custo dos produtos";

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — Resultado: custo estimado leva ao cadastro de custos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: DRE, error: null });
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

  async function montar(onNavigate?: (view: never, id?: string) => void) {
    await act(async () => {
      raiz.render(
        <AbaDre
          ativo
          intervalo={OUTUBRO}
          versao={0}
          rotuloDoPeriodo="Outubro"
          onNavigate={onNavigate as never}
        />,
      );
    });
    await esperar();
  }

  const botao = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === TEXTO_DO_BOTAO,
    ) as HTMLButtonElement | undefined;

  it("com custo estimado e onNavigate, o botão aparece e abre a lista de produtos 'sem custo'", async () => {
    const onNavigate = vi.fn();
    await montar(onNavigate);

    const b = botao();
    expect(b).toBeDefined();
    expect(b?.className).toContain("min-h-11");
    expect(b?.className).toContain("font-bold");
    // Sem dourado no Financeiro (ordem do dono, 22/10/2026): texto neutro.
    expect(b?.className).toContain("text-white");
    expect(b?.className).not.toMatch(/admin-gold/);
    await act(async () => {
      b?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-products", VISAO_SEM_CUSTO);
  });

  it("o botão fica logo abaixo do aviso de estimativa", async () => {
    await montar(vi.fn());
    const aviso = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Inclui estimativa"),
    );
    expect(aviso).toBeDefined();
    expect(aviso?.nextElementSibling).toBe(botao());
  });

  it("sem custo estimado, o botão não aparece", async () => {
    rpcFalso.mockResolvedValue({
      data: { ...DRE, cmv_estimado: false },
      error: null,
    });
    await montar(vi.fn());
    expect(botao()).toBeUndefined();
  });

  it("sem onNavigate, o botão não aparece e o aviso segue igual", async () => {
    await montar(undefined);
    expect(botao()).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Inclui estimativa");
  });
});
