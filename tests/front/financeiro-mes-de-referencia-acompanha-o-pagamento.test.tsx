// @vitest-environment jsdom
//
// Financeiro — o "Mês de referência" (data_competencia) acompanha a data do
// dinheiro enquanto a lojista não mexe nele. O Extrato e a Visão contam pela
// data do pagamento; o Resultado conta pela competência. Antes ele nascia
// com HOJE e ficava parado: o aluguel de outubro, lançado em 27/11 com "Pago
// em" 05/10, caía no Resultado de novembro e o total não batia com o Extrato.
// No parcelado o banco soma um mês por parcela a partir da competência
// (20261246000000), então ela tem de partir do 1º vencimento.
//
// E o detalhe do lançamento não promete edição que a tela não tem.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { DetalheDoLancamentoFolha } from "@/components/admin/financeiro/FolhasDeLancamento";
import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  CONTA_BANCARIA,
  type CategoriaFinanceira,
  type ContaFinanceira,
  type LinhaDoExtrato,
} from "@/types/financeiro";
import { escolherNaLista } from "./helpers/lista-de-escolha";

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

async function montar(no: ReactNode) {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz?.render(no);
  });
}

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

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
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

async function escolher(id: string, valor: string) {
  await act(async () => {
    escolherNaLista(id, valor);
  });
}

const mesDeReferencia = () =>
  (document.getElementById("fin-lanc-competencia") as HTMLInputElement).value;

async function montarNovoLancamento() {
  await montar(
    <NovoLancamentoFolha
      autorId="dona-da-loja"
      hoje={HOJE}
      contas={CONTAS}
      categorias={CATEGORIAS}
      aoFechar={vi.fn()}
      aoSalvar={vi.fn()}
      aoMudarSujo={vi.fn()}
    />,
  );
}

/** Preenche o mínimo para o salvar ir ao banco e devolve o corpo enviado. */
async function salvarEPegarCorpo(categoria = "cat-aluguel") {
  rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });
  await digitar("fin-lanc-valor", "150000");
  await digitar("fin-lanc-descricao", "Aluguel de outubro");
  await escolher("fin-lanc-categoria", categoria);
  await clicar(botao("Salvar lançamento"));
  expect(rpcFalso).toHaveBeenCalledTimes(1);
  return rpcFalso.mock.calls[0]?.[1]?.p as Record<string, unknown>;
}

describe("Financeiro — o Mês de referência acompanha a data do dinheiro", () => {
  it("despesa paga: mudar o 'Pago em' leva o mês de referência junto", async () => {
    await montarNovoLancamento();
    await mudarData("fin-lanc-realizacao", "2026-10-05");

    expect(mesDeReferencia()).toBe("2026-10-05");
    const corpo = await salvarEPegarCorpo();
    expect(corpo).toMatchObject({
      status: "realizado",
      data_realizacao: "2026-10-05",
      data_competencia: "2026-10-05",
    });
  });

  it("receita recebida: o 'Recebido em' leva o mês de referência junto", async () => {
    await montarNovoLancamento();
    await clicar(botao("Receita"));
    await mudarData("fin-lanc-realizacao", "2026-10-20");

    expect(mesDeReferencia()).toBe("2026-10-20");
    const corpo = await salvarEPegarCorpo("cat-sucata");
    expect(corpo).toMatchObject({
      tipo: "entrada",
      data_realizacao: "2026-10-20",
      data_competencia: "2026-10-20",
    });
  });

  it("a pagar parcelado: o mês de referência parte do 1º vencimento", async () => {
    await montarNovoLancamento();
    await clicar(botao("A pagar"));
    await mudarData("fin-lanc-vencimento", "2026-12-10");
    await escolher("fin-lanc-parcelas", "3");

    expect(mesDeReferencia()).toBe("2026-12-10");
    const corpo = await salvarEPegarCorpo();
    expect(corpo).toMatchObject({
      status: "previsto",
      data_vencimento: "2026-12-10",
      parcelas: 3,
      data_competencia: "2026-12-10",
    });
  });

  it("trocar de 'Já pago' para 'A pagar' passa a seguir o vencimento", async () => {
    await montarNovoLancamento();
    await mudarData("fin-lanc-realizacao", "2026-10-05");
    await clicar(botao("A pagar"));
    await mudarData("fin-lanc-vencimento", "2026-12-10");
    expect(mesDeReferencia()).toBe("2026-12-10");

    // E voltar para "Já pago" volta a seguir o "Pago em".
    await clicar(botao("Já pago"));
    expect(mesDeReferencia()).toBe("2026-10-05");
  });

  it("depois que a lojista escolhe o mês de referência, ele não se mexe mais sozinho", async () => {
    await montarNovoLancamento();
    await mudarData("fin-lanc-competencia", "2026-09-01");
    await mudarData("fin-lanc-realizacao", "2026-10-05");

    expect(mesDeReferencia()).toBe("2026-09-01");
    const corpo = await salvarEPegarCorpo();
    expect(corpo).toMatchObject({
      data_realizacao: "2026-10-05",
      data_competencia: "2026-09-01",
    });
  });

  it("apagar a data do pagamento não apaga o mês de referência", async () => {
    await montarNovoLancamento();
    await mudarData("fin-lanc-realizacao", "2026-10-05");
    await mudarData("fin-lanc-realizacao", "");

    expect(mesDeReferencia()).toBe("2026-10-05");
  });
});

const LINHA: LinhaDoExtrato = {
  id: "lanc-1",
  origem: "manual",
  tipo: "saida",
  status: "previsto",
  valor: 1500,
  data: "2026-12-10",
  contaId: CONTA_BANCARIA,
  contaNome: "Conta bancária",
  contaDestinoId: null,
  contaDestinoNome: null,
  categoriaId: "cat-aluguel",
  categoriaNome: "Aluguel",
  descricao: "Aluguel de dezembro",
  formaPagamento: null,
  pedidoId: null,
  vencimento: "2026-12-10",
  editavel: true,
};

async function montarDetalhe(linha: LinhaDoExtrato) {
  await montar(
    <DetalheDoLancamentoFolha
      linha={linha}
      aoFechar={vi.fn()}
      aoCancelar={vi.fn()}
      aoBaixar={vi.fn()}
      aoAbrirPedido={vi.fn()}
    />,
  );
}

describe("Financeiro — o detalhe não promete edição", () => {
  it.each([
    ["previsto", { status: "previsto" as const }],
    ["realizado", { status: "realizado" as const, vencimento: null }],
  ])(
    "lançamento %s manual: para corrigir, cancele e lance de novo",
    async (_nome, mudanca) => {
      await montarDetalhe({ ...LINHA, ...mudanca });

      expect(texto()).toContain("Para corrigir, cancele e lance de novo.");
      expect(texto()).not.toMatch(/edi[çc][ãa]o|se edita|editar/i);
    },
  );

  it("cancelado não fala de edição", async () => {
    await montarDetalhe({ ...LINHA, status: "cancelado" });

    expect(texto()).toContain("O registro fica guardado");
    expect(texto()).not.toMatch(/edi[çc][ãa]o|se edita|editar/i);
    expect(texto()).not.toContain("cancele");
  });

  it("o que vem do pedido não manda cancelar aqui", async () => {
    await montarDetalhe({
      ...LINHA,
      origem: "venda_online",
      status: "realizado",
      editavel: false,
      pedidoId: "pedido-1",
    });

    expect(texto()).not.toContain("Para corrigir, cancele e lance de novo.");
  });
});
