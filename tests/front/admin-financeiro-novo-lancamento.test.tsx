// @vitest-environment jsdom
//
// Financeiro — folha "Novo lançamento": valida ANTES de chamar
// `fin_lancamento_salvar` (nada vai ao banco com campo faltando), manda o
// corpo do contrato do plano (valor em reais lido do "1.234,56" pt-BR,
// previsto com vencimento e parcelas) e mostra a recusa do servidor na
// própria folha, sem fechar.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-09-26";

const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_CAIXA_DA_LOJA,
    nome: "Caixa da loja",
    tipo: "caixa",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 300,
  },
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 5000,
  },
];

const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: "cat-aluguel",
    nome: "Aluguel",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
  {
    id: "cat-sucata",
    nome: "Venda de sucata",
    natureza: "receita",
    grupoDre: "receita",
    ativa: true,
    sistema: false,
  },
];

function folha(): HTMLElement {
  const el = document.querySelector('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não abriu");
  return el as HTMLElement;
}

const texto = () => (folha().textContent ?? "").replace(/\s+/g, " ");

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...folha().querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!achado) throw new Error(`botão "${rotulo}" não existe`);
  return achado as HTMLButtonElement;
}

/** Digita num LocalBufferedInput e sai do campo (o blur descarrega o valor). */
async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const prototipo =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function escolher(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function mudarData(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Financeiro — Novo lançamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoSalvar: Mock<(mensagem: string) => void>;
  let aoMudarSujo: Mock<(sujo: boolean) => void>;

  beforeEach(async () => {
    rpcFalso.mockReset();
    aoSalvar = vi.fn<(mensagem: string) => void>();
    aoMudarSujo = vi.fn<(sujo: boolean) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <NovoLancamentoFolha
          hoje={HOJE}
          contas={CONTAS}
          categorias={CATEGORIAS}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={aoMudarSujo}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("não chama o banco com campo faltando e diz o que falta", async () => {
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).not.toHaveBeenCalled();
    expect(texto()).toContain("Informe um valor maior que zero.");
    expect(texto()).toContain("Descreva o lançamento.");
    expect(texto()).toContain("Escolha a categoria");
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("despesa a pagar em 3× manda o corpo do contrato e fecha com a mensagem", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["a", "b", "c"] }, error: null });

    // A categoria só lista as da natureza do tipo (despesa).
    const opcoes = [
      ...(document.getElementById("fin-lanc-categoria") as HTMLSelectElement)
        .options,
    ].map((o) => o.textContent);
    expect(opcoes).toEqual(["Escolha…", "Aluguel"]);

    await digitar("fin-lanc-valor", "123456");
    expect(
      (document.getElementById("fin-lanc-valor") as HTMLInputElement).value,
    ).toBe("1.234,56");
    expect(aoMudarSujo).toHaveBeenLastCalledWith(true);
    await digitar("fin-lanc-descricao", "Aluguel de outubro");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await clicar(botao("A pagar"));
    await mudarData("fin-lanc-vencimento", "2026-10-05");
    await escolher("fin-lanc-parcelas", "3");

    expect(texto()).toMatch(/3× de R\$ 411,52/);

    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
      p: {
        tipo: "saida",
        valor: 1234.56,
        conta_id: CONTA_BANCARIA,
        categoria_id: "cat-aluguel",
        descricao: "Aluguel de outubro",
        data_competencia: HOJE,
        status: "previsto",
        data_vencimento: "2026-10-05",
        parcelas: 3,
      },
    });
    expect(aoSalvar).toHaveBeenCalledWith("3 parcelas lançadas.");
  });

  it("receita já recebida vai como realizado, com a forma de pagamento", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });

    await clicar(botao("Receita"));
    await digitar("fin-lanc-valor", "5000");
    await digitar("fin-lanc-descricao", "Sucata de papelão");
    await escolher("fin-lanc-categoria", "cat-sucata");
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await escolher("fin-lanc-forma", "cash");
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_salvar", {
      p: {
        tipo: "entrada",
        valor: 50,
        conta_id: CONTA_CAIXA_DA_LOJA,
        categoria_id: "cat-sucata",
        descricao: "Sucata de papelão",
        forma_pagamento: "cash",
        data_competencia: HOJE,
        status: "realizado",
        data_realizacao: HOJE,
      },
    });
    expect(aoSalvar).toHaveBeenCalledWith("Lançamento salvo.");
  });

  it("transferência para a mesma conta é barrada antes do banco", async () => {
    await clicar(botao("Transferência"));
    await digitar("fin-lanc-valor", "10000");
    await digitar("fin-lanc-descricao", "Depósito do caixa");
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await escolher("fin-lanc-conta-destino", CONTA_CAIXA_DA_LOJA);
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).not.toHaveBeenCalled();
    expect(texto()).toContain("A conta de destino precisa ser outra.");
    // Transferência não tem categoria nem situação (é sempre realizada).
    expect(document.getElementById("fin-lanc-categoria")).toBeNull();
  });

  it("a recusa do servidor aparece na folha e ela não fecha", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Conta inativa não recebe lançamento." },
    });

    await digitar("fin-lanc-valor", "990");
    await digitar("fin-lanc-descricao", "Internet");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await clicar(botao("Salvar lançamento"));

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(texto()).toContain("Conta inativa não recebe lançamento.");
    expect(aoSalvar).not.toHaveBeenCalled();
  });
});
