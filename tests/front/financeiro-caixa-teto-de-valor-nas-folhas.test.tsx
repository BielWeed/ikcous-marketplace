// @vitest-environment jsdom
//
// Teto de R$ 99.999.999,99 nas folhas do caixa (lote r130-c). O campo usa
// máscara de moeda sem `maxLength` e o banco só recusa acima de
// R$ 9.999.999.999,99: entre os dois, só a guarda da folha impede abrir caixa,
// registrar sangria/suprimento ou fechar com a contagem de R$ 100 milhões. A
// folha diz 'Valor acima do limite.' e NÃO chama abrirCaixa / movimentarCaixa /
// fecharCaixa. O teto exato (R$ 99.999.999,99) é o controle: grava normalmente.
// Sangria sem o esperado conhecido (`esperado={null}`): com o esperado na mão o
// botão já fica travado por "maior que o esperado", que é outra guarda.
import { type ReactElement, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { abrirCaixa, movimentarCaixa, fecharCaixa } = vi.hoisted(() => ({
  abrirCaixa: vi.fn(),
  movimentarCaixa: vi.fn(),
  fecharCaixa: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/hooks/useFinanceiro", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/hooks/useFinanceiro")>()),
  abrirCaixa,
  movimentarCaixa,
  fecharCaixa,
}));

import {
  AbrirCaixaFolha,
  FecharCaixaFolha,
  MovimentarCaixaFolha,
} from "@/components/admin/financeiro/FolhasDoCaixa";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CaixaAtual,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-10-16";
const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id, i) => ({
    id,
    nome: id === CONTA_BANCARIA ? "Banco" : "Caixa",
    tipo: id === CONTA_BANCARIA ? ("banco" as const) : ("caixa" as const),
    saldoInicial: 0,
    saldoInicialEm: HOJE,
    ativa: true,
    ordem: i + 1,
    sistema: true,
    saldo: 100,
  }),
);
const CAIXA: CaixaAtual = {
  id: "sessao-1",
  contaId: CONTA_CAIXA_DA_LOJA,
  contaNome: "Caixa",
  abertoEm: "2026-10-16T12:00:00Z",
  valorAbertura: 100,
  vendasDinheiro: 0,
  devolucoesDinheiro: 0,
  estornosExternosDinheiro: 0,
  entradasManuais: 0,
  saidasManuais: 0,
  esperado: 100,
  movimentos: [],
};

const ACIMA_DO_TETO = "100.000.000,00";
const NO_TETO = "99.999.999,99";

interface Caso {
  readonly nome: string;
  readonly campo: string;
  readonly rotulo: string;
  readonly gravou: (valor: number) => void;
  readonly montar: () => ReactElement;
}

const semEfeito = vi.fn();
const CASOS: Caso[] = [
  {
    nome: "abrir caixa",
    campo: "fin-caixa-abertura",
    rotulo: "Abrir caixa",
    gravou: (valor) =>
      expect(abrirCaixa).toHaveBeenCalledExactlyOnceWith({
        valorAbertura: valor,
        contaId: CONTA_CAIXA_DA_LOJA,
      }),
    montar: () => (
      <AbrirCaixaFolha
        contas={CONTAS}
        aoReconciliar={async () => {}}
        aoMudarEnviando={semEfeito}
        aoFechar={semEfeito}
        aoSalvar={semEfeito}
        aoMudarSujo={semEfeito}
      />
    ),
  },
  ...(["sangria", "suprimento"] as const).map(
    (movimento): Caso => ({
      nome: movimento,
      campo: "fin-caixa-mov-valor",
      rotulo:
        movimento === "sangria" ? "Registrar sangria" : "Registrar suprimento",
      gravou: (valor) => {
        expect(movimentarCaixa).toHaveBeenCalledTimes(1);
        expect(movimentarCaixa.mock.calls[0][0]).toMatchObject({
          tipo: movimento,
          valor,
        });
      },
      montar: () => (
        <MovimentarCaixaFolha
          autorId="autor-1"
          aoReconciliar={async () => {}}
          aoMudarEnviando={semEfeito}
          sessaoId="sessao-1"
          movimento={movimento}
          esperado={null}
          contas={CONTAS}
          contaDoCaixa={CONTA_CAIXA_DA_LOJA}
          aoFechar={semEfeito}
          aoSalvar={semEfeito}
          aoMudarSujo={semEfeito}
        />
      ),
    }),
  ),
  {
    nome: "contagem do fechamento",
    campo: "fin-caixa-contado",
    rotulo: "Fechar caixa",
    gravou: (valor) =>
      expect(fecharCaixa).toHaveBeenCalledExactlyOnceWith({
        sessaoId: "sessao-1",
        valorContado: valor,
        observacao: null,
      }),
    montar: () => (
      <FecharCaixaFolha
        aoReconciliar={async () => {}}
        aoMudarEnviando={semEfeito}
        caixa={CAIXA}
        aoFechar={semEfeito}
        aoFechado={semEfeito}
        aoMudarSujo={semEfeito}
      />
    ),
  },
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
  });
}
async function tocar(rotulo: string) {
  const el = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === rotulo,
  );
  if (!el) throw new Error(`Botão ${rotulo} não existe`);
  await act(async () => el.click());
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  abrirCaixa.mockReset().mockResolvedValue(undefined);
  movimentarCaixa
    .mockReset()
    .mockResolvedValue({ status: "realizado", replay: false });
  fecharCaixa.mockReset().mockResolvedValue({
    esperado: 100,
    contado: 99999999.99,
    diferenca: 99999899.99,
  });
  semEfeito.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe.each(CASOS)("teto de valor — $nome", (caso) => {
  it("R$ 100.000.000,00: diz 'Valor acima do limite.' e não grava nada", async () => {
    await act(async () => raiz.render(caso.montar()));
    await digitar(caso.campo, ACIMA_DO_TETO);
    await tocar(caso.rotulo);

    expect(abrirCaixa).not.toHaveBeenCalled();
    expect(movimentarCaixa).not.toHaveBeenCalled();
    expect(fecharCaixa).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Valor acima do limite.");
  });

  it("controle: R$ 99.999.999,99 (o teto exato) grava, sem aviso de limite", async () => {
    await act(async () => raiz.render(caso.montar()));
    await digitar(caso.campo, NO_TETO);
    await tocar(caso.rotulo);

    caso.gravou(99999999.99);
    expect(document.body.textContent).not.toContain("Valor acima do limite.");
  });
});
