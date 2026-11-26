// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — cartão "Caixa de hoje".
// O "esperado na gaveta" só fica VERMELHO quando é de fato negativo em centavos:
// zero (gaveta vazia, normal) e resíduo de meio centavo não são prejuízo.
// RISCO: dinheiro na tela. Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { CaixaDeHoje } from "@/components/admin/financeiro/CaixaDeHoje";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import { CONTA_CAIXA_DA_LOJA, type CaixaAtual } from "@/types/financeiro";

function sessao(esperado: number): CaixaAtual {
  return {
    id: "sessao-1",
    contaId: CONTA_CAIXA_DA_LOJA,
    contaNome: "Caixa da loja",
    abertoEm: "2026-10-23T11:12:00Z",
    valorAbertura: 100,
    vendasDinheiro: 0,
    devolucoesDinheiro: 0,
    estornosExternosDinheiro: 0,
    entradasManuais: 0,
    saidasManuais: 0,
    esperado,
    movimentos: [],
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function montar(esperado: number) {
  const consulta: ConsultaFinanceira<{ readonly sessao: CaixaAtual | null }> = {
    dados: { sessao: sessao(esperado) },
    carregando: false,
    erro: null,
    recarregar: vi.fn(),
  };
  act(() => {
    root.render(
      <CaixaDeHoje
        consulta={consulta}
        abrirFolha={vi.fn()}
        irParaAba={vi.fn()}
      />,
    );
  });
  return host.querySelector("section") as HTMLElement;
}

// O vermelho do esperado negativo (o verde do "Aberto" é outra classe).
const temVermelho = (el: HTMLElement) =>
  el.querySelector('[class*="text-red-700"]') !== null;

describe("CaixaDeHoje — quando o esperado fica vermelho", () => {
  it.each([[-5], [-0.01], [-1234.56]])(
    "esperado %s (negativo) fica vermelho",
    (esperado) => {
      expect(temVermelho(montar(esperado))).toBe(true);
    },
  );

  it.each([[0], [0.01], [100], [-0.004], [0.004]])(
    "esperado %s (zero em centavos ou positivo) NÃO fica vermelho",
    (esperado) => {
      expect(temVermelho(montar(esperado))).toBe(false);
    },
  );

  it("o estado 'Aberto' continua verde, mesmo com o esperado vermelho", () => {
    const secao = montar(-5);
    expect(secao.getAttribute("data-faixa-do-caixa")).toBe("aberto");
    expect(secao.querySelector('[class*="text-emerald-800"]')).not.toBeNull();
    expect(secao.textContent).toContain("Aberto");
  });
});
