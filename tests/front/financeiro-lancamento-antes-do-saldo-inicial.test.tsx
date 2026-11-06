// @vitest-environment jsdom
//
// Financeiro — "Novo lançamento" com data ANTES do saldo inicial da conta:
// o banco só soma ao saldo o que tem data a partir do saldo inicial (regra
// intencional, `fin__saldos`), então o lançamento antigo aparece no extrato e
// no resultado mas não mexe no saldo. A folha avisa — sem travar o salvar.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  type DataIso,
} from "@/types/financeiro";

const HOJE = "2026-09-26";
const SALDO_INICIAL_DO_BANCO = "2026-09-20";

function contas(
  banco: DataIso | null,
  caixa: DataIso | null = "2026-01-01",
): ContaFinanceira[] {
  return [
    {
      id: CONTA_CAIXA_DA_LOJA,
      nome: "Caixa da loja",
      tipo: "caixa",
      saldoInicial: 0,
      saldoInicialEm: caixa,
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
      saldoInicialEm: banco,
      ativa: true,
      ordem: 2,
      sistema: true,
      saldo: 5000,
    },
  ];
}

const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: "cat-aluguel",
    nome: "Aluguel",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
];

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

const CHAVE = "anterior ao saldo inicial";
const avisos = () =>
  [...folha().querySelectorAll('[role="status"]')].filter((el) =>
    (el.textContent ?? "").includes(CHAVE),
  );
const frase = (el: Element | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("Financeiro — lançamento antes do saldo inicial da conta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrir(lista: ContaFinanceira[]) {
    await act(async () => {
      raiz.render(
        <NovoLancamentoFolha
          hoje={HOJE}
          contas={lista}
          categorias={CATEGORIAS}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
  }

  beforeEach(() => {
    rpcFalso.mockReset();
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

  it("despesa já paga com data anterior ao saldo inicial da conta: avisa com a data do saldo", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO));
    // A conta sugerida é o banco.
    expect(avisos()).toHaveLength(0);
    await mudarData("fin-lanc-realizacao", "2026-09-10");

    expect(avisos()).toHaveLength(1);
    expect(frase(avisos().at(0))).toBe(
      "Esta data é anterior ao saldo inicial da conta (20/09/2026). O lançamento aparece no extrato e no resultado, mas não muda o saldo da conta. Para o saldo contar, ajuste a data do saldo inicial em Contas.",
    );
  });

  it("usa o saldo inicial da conta ESCOLHIDA, não o de outra", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO));
    await mudarData("fin-lanc-realizacao", "2026-09-10");
    expect(avisos()).toHaveLength(1);

    // O Caixa tem saldo inicial em janeiro: 10/09 é depois dele.
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    expect(avisos()).toHaveLength(0);
  });

  it("vale também para receita já recebida", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO));
    await clicar(botao("Receita"));
    await mudarData("fin-lanc-realizacao", "2026-09-19");

    expect(avisos()).toHaveLength(1);
  });

  it("não avisa com a data igual ao saldo inicial nem com data posterior", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO));
    await mudarData("fin-lanc-realizacao", SALDO_INICIAL_DO_BANCO);
    expect(avisos()).toHaveLength(0);

    await mudarData("fin-lanc-realizacao", "2026-09-22");
    expect(avisos()).toHaveLength(0);

    await mudarData("fin-lanc-realizacao", HOJE);
    expect(avisos()).toHaveLength(0);
  });

  it("não avisa com a situação 'a pagar' e some ao trocar de 'já pago'", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO));
    await mudarData("fin-lanc-realizacao", "2026-09-10");
    expect(avisos()).toHaveLength(1);

    await clicar(botao("A pagar"));
    expect(avisos()).toHaveLength(0);
  });

  it("não avisa com a data apagada nem com conta sem saldo inicial datado", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO));
    await mudarData("fin-lanc-realizacao", "");
    expect(avisos()).toHaveLength(0);

    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await abrir(contas(null));
    await mudarData("fin-lanc-realizacao", "2020-01-01");
    expect(avisos()).toHaveLength(0);
  });

  it("não trava o salvar: manda a data antiga igual ao de antes", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });
    await abrir(contas(SALDO_INICIAL_DO_BANCO));

    await digitar("fin-lanc-valor", "2500");
    await digitar("fin-lanc-descricao", "Aluguel de agosto");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await mudarData("fin-lanc-realizacao", "2026-09-10");
    expect(avisos()).toHaveLength(1);

    const salvar = botao("Salvar lançamento");
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(rpcFalso).toHaveBeenCalledWith(
      "fin_lancamento_salvar",
      expect.objectContaining({
        p: expect.objectContaining({
          conta_id: CONTA_BANCARIA,
          status: "realizado",
          data_realizacao: "2026-09-10",
        }),
      }),
    );
  });

  it("convive com o aviso da conferência do caixa: dois avisos, cada um com a sua frase", async () => {
    await abrir(contas(SALDO_INICIAL_DO_BANCO, "2026-09-20"));
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", "2026-09-10");

    expect(avisos()).toHaveLength(1);
    const conferencia = [...folha().querySelectorAll('[role="status"]')].filter(
      (el) => (el.textContent ?? "").includes("conferência do caixa aberto"),
    );
    expect(conferencia).toHaveLength(1);
  });

  describe("transferência", () => {
    async function transferir(origem: string, destino: string, data: string) {
      await clicar(botao("Transferência"));
      await escolher("fin-lanc-conta", origem);
      await escolher("fin-lanc-conta-destino", destino);
      await mudarData("fin-lanc-realizacao", data);
    }

    it("avisa quando só a ponta de destino tem saldo inicial depois da data", async () => {
      await abrir(contas(SALDO_INICIAL_DO_BANCO));
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, "2026-09-10");

      expect(avisos()).toHaveLength(1);
      expect(frase(avisos().at(0))).toBe(
        "Esta data é anterior ao saldo inicial da conta Conta bancária (20/09/2026). A transferência aparece no extrato, mas não muda o saldo dessa conta. Para o saldo contar, ajuste a data do saldo inicial em Contas.",
      );
    });

    it("avisa quando só a ponta de origem tem saldo inicial depois da data", async () => {
      await abrir(contas(SALDO_INICIAL_DO_BANCO));
      await transferir(CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA, "2026-09-10");

      expect(avisos()).toHaveLength(1);
    });

    it("com as duas pontas antes do saldo inicial, cita a data que resolve as duas (a mais tardia)", async () => {
      await abrir(contas("2026-09-20", "2026-09-24"));
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, "2026-09-10");

      expect(avisos()).toHaveLength(1);
      expect(frase(avisos().at(0))).toContain(
        "da conta Caixa da loja (24/09/2026)",
      );
    });

    it("não avisa com a data igual ou posterior ao saldo inicial das duas pontas", async () => {
      await abrir(contas(SALDO_INICIAL_DO_BANCO));
      await transferir(
        CONTA_CAIXA_DA_LOJA,
        CONTA_BANCARIA,
        SALDO_INICIAL_DO_BANCO,
      );

      expect(avisos()).toHaveLength(0);
    });

    it("não avisa com a data apagada", async () => {
      await abrir(contas(SALDO_INICIAL_DO_BANCO));
      await transferir(CONTA_CAIXA_DA_LOJA, CONTA_BANCARIA, "");

      expect(avisos()).toHaveLength(0);
    });
  });
});
