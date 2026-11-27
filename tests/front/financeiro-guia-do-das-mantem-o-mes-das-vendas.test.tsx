// @vitest-environment jsdom
//
// Financeiro — a guia do DAS lançada pelo Caderno das guias guarda o mês das
// VENDAS como mês de referência, não o do vencimento. O "Novo lançamento"
// faz o mês de referência acompanhar o vencimento enquanto a lojista não
// mexe nele, MAS quando o formulário já abre com o mês pronto
// (`mesDeReferenciaVeioPronto`), esse mês é escolha de quem abriu e fica.
// O único chamador que abre assim é a guia do DAS: o DAS de novembro vence
// em dezembro, e se o mês seguisse o vencimento o imposto de novembro cairia
// no Resultado de dezembro.
//
// O `inicial` sai do mesmo `guiaDoMes` que o CadernoDeGuias usa.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import { guiaDoMes } from "@/lib/fiscal/guia-do-mes";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";
import {
  CONTA_BANCARIA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-11-27";

const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 5000,
  },
];

const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: CATEGORIA_DE_IMPOSTOS_ID,
    nome: "Impostos sobre vendas (DAS/Simples)",
    natureza: "despesa",
    grupoDre: "deducao",
    ativa: true,
    sistema: true,
  },
];

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    raiz?.unmount();
  });
  hospedeiro?.remove();
  raiz = null;
  hospedeiro = null;
  rpcFalso.mockReset();
});

function folha(): HTMLElement {
  const el = document.querySelector('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não abriu");
  return el as HTMLElement;
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...folha().querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!achado) throw new Error(`botão "${rotulo}" não existe`);
  return achado as HTMLButtonElement;
}

/** Digita num LocalBufferedInput e sai do campo (o blur descarrega o valor). */
async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const mesDeReferencia = () =>
  (document.getElementById("fin-lanc-competencia") as HTMLInputElement).value;

describe("Financeiro — a guia do DAS mantém o mês das vendas", () => {
  it("DAS de novembro, que vence em dezembro, vai ao banco com o mês de novembro", async () => {
    // Como o CadernoDeGuias monta: loja sem cadastro (valor vazio), mês das vendas 2026-11.
    const inicial = guiaDoMes(null, "2026-11", 2026);
    if (!inicial) throw new Error("guiaDoMes não montou a guia");
    expect(inicial).toMatchObject({
      situacao: "previsto",
      dataCompetencia: "2026-11-01",
    });
    expect(inicial.dataVencimento?.slice(0, 7)).toBe("2026-12");

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz?.render(
        <NovoLancamentoFolha
          autorId="dona-da-loja"
          hoje={HOJE}
          contas={CONTAS}
          categorias={CATEGORIAS}
          inicial={inicial}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      );
    });

    expect(mesDeReferencia()).toBe("2026-11-01");

    // A lojista só digita o valor da guia que recebeu e salva.
    rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });
    await digitar("fin-lanc-valor", "8205");
    await act(async () => {
      botao("Salvar lançamento").click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    const corpo = rpcFalso.mock.calls[0]?.[1]?.p as Record<string, unknown>;
    expect(corpo).toMatchObject({
      status: "previsto",
      categoria_id: CATEGORIA_DE_IMPOSTOS_ID,
      data_vencimento: inicial.dataVencimento,
      data_competencia: "2026-11-01",
    });
  });
});
