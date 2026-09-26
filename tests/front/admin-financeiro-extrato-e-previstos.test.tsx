// @vitest-environment jsdom
//
// Financeiro — Extrato e A pagar, pela tela inteira:
//  - o extrato agrupa por dia com o resultado realizado do dia (previsto não
//    entra) e o sinal escrito (+R$ / −R$);
//  - venda é linha DERIVADA do pedido: o detalhe leva ao pedido
//    (`onNavigate("admin-orders", id)`), sem ação de cancelar;
//  - lançamento manual cancela com MOTIVO (`fin_lancamento_cancelar`);
//  - "Dar baixa" no a pagar manda data e conta (`fin_lancamento_baixar`);
//    estorno em andamento aparece sem ação, com a explicação.
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import type { View } from "@/types";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  CONTA_MERCADO_PAGO,
} from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const PEDIDO = "11111111-2222-3333-4444-555555abc123";

const CONTAS = [
  {
    id: CONTA_CAIXA_DA_LOJA,
    nome: "Caixa da loja",
    tipo: "caixa",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 100,
  },
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 900,
  },
  {
    id: CONTA_MERCADO_PAGO,
    nome: "Mercado Pago",
    tipo: "mercado_pago",
    ativa: true,
    ordem: 3,
    sistema: true,
    saldo: 150,
  },
];

const EXTRATO = [
  {
    id: "v1",
    origem: "venda_online",
    tipo: "entrada",
    status: "realizado",
    valor: 150,
    data: "2026-09-20",
    conta_id: CONTA_MERCADO_PAGO,
    conta_nome: "Mercado Pago",
    categoria_nome: "Vendas",
    descricao: "Venda #abc123",
    forma_pagamento: "online",
    pedido_id: PEDIDO,
    editavel: false,
  },
  {
    id: "m1",
    origem: "manual",
    tipo: "saida",
    status: "realizado",
    valor: 80,
    data: "2026-09-20",
    conta_id: CONTA_BANCARIA,
    conta_nome: "Conta bancária",
    categoria_nome: "Internet",
    descricao: "Internet de setembro",
    editavel: true,
  },
  {
    id: "m2",
    origem: "manual",
    tipo: "saida",
    status: "previsto",
    valor: 1200,
    data: "2026-09-30",
    conta_id: CONTA_BANCARIA,
    conta_nome: "Conta bancária",
    categoria_nome: "Aluguel",
    descricao: "Aluguel",
    vencimento: "2026-09-30",
    editavel: true,
  },
];

const A_PAGAR = [
  {
    id: "p1",
    descricao: "Fornecedor de camisetas",
    valor: 500,
    vencimento: "2026-09-01",
    vencido: true,
    conta_id: CONTA_BANCARIA,
    conta_nome: "Conta bancária",
    categoria_nome: "Mercadoria",
    parcela: 1,
    parcelas: 2,
    origem: "manual",
  },
  {
    id: "e1",
    descricao: "Estorno do pedido #999xyz",
    valor: 60,
    vencimento: null,
    vencido: false,
    conta_id: CONTA_MERCADO_PAGO,
    conta_nome: "Mercado Pago",
    origem: "estorno",
    pedido_id: "99999999-0000-0000-0000-000000999xyz",
  },
];

rpcFalso.mockImplementation(
  async (nome: string, args?: Record<string, unknown>) => {
    switch (nome) {
      case "fin_contas_listar":
        return { data: CONTAS, error: null };
      case "fin_extrato":
        return { data: EXTRATO, error: null };
      case "fin_previstos":
        return { data: args?.p_tipo === "saida" ? A_PAGAR : [], error: null };
      case "fin_resumo":
        return { data: { saldo_total: 0 }, error: null };
      case "fin_lancamento_cancelar":
      case "fin_lancamento_baixar":
        return { data: { id: args?.p_id, status: "ok" }, error: null };
      default:
        return { data: [], error: null };
    }
  },
);

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function botaoEm(raiz: ParentNode, rotulo: string | RegExp): HTMLButtonElement {
  const achado = [...raiz.querySelectorAll("button")].find((b) => {
    const texto = normalizar(b.textContent).trim();
    return typeof rotulo === "string" ? texto === rotulo : rotulo.test(texto);
  });
  if (!achado) throw new Error(`botão ${String(rotulo)} não existe`);
  return achado as HTMLButtonElement;
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await esperar();
}

const folha = () =>
  document.querySelector('[data-slot="sheet-content"]') as HTMLElement | null;

describe("Financeiro — extrato e a pagar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: Mock<(view: View, id?: string) => void>;

  beforeEach(async () => {
    rpcFalso.mockClear();
    onNavigate = vi.fn<(view: View, id?: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={onNavigate} active />);
    });
    await esperar();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function irPara(aba: string) {
    const gatilho = [...hospedeiro.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === aba,
    ) as HTMLElement;
    await act(async () => {
      gatilho.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
  }

  it("extrato por dia: resultado só do realizado, sinal escrito, venda leva ao pedido", async () => {
    await irPara("Extrato");

    const dias = [...hospedeiro.querySelectorAll("section[aria-label] h3")].map(
      (h) => normalizar(h.textContent),
    );
    expect(dias).toHaveLength(2);
    expect(dias.at(0)).toContain("30 de setembro");
    expect(dias.at(1)).toContain("20 de setembro");

    const dia20 = [...hospedeiro.querySelectorAll("section[aria-label]")].find(
      (s) => (s.getAttribute("aria-label") ?? "").includes("20 de setembro"),
    ) as HTMLElement;
    const texto20 = normalizar(dia20.textContent);
    expect(texto20).toContain("Resultado +R$ 70,00");
    expect(texto20).toContain("+R$ 150,00");
    expect(texto20).toContain("−R$ 80,00");
    // O previsto do dia 30 não mexe no resultado dele.
    const dia30 = [...hospedeiro.querySelectorAll("section[aria-label]")].find(
      (s) => (s.getAttribute("aria-label") ?? "").includes("30 de setembro"),
    ) as HTMLElement;
    expect(normalizar(dia30.textContent)).toContain("Resultado R$ 0,00");
    expect(normalizar(dia30.textContent)).toContain("Previsto");

    await clicar(botaoEm(hospedeiro, /^Venda #abc123/));
    const detalhe = folha() as HTMLElement;
    expect(normalizar(detalhe.textContent)).toContain(
      "Este valor vem do pedido",
    );
    expect(() => botaoEm(detalhe, "Cancelar lançamento")).toThrow();

    await clicar(botaoEm(detalhe, "Abrir pedido #abc123"));
    expect(onNavigate).toHaveBeenCalledWith("admin-orders", PEDIDO);
    expect(folha()).toBeNull();
  });

  it("lançamento manual cancela com motivo", async () => {
    await irPara("Extrato");
    await clicar(botaoEm(hospedeiro, /^Internet de setembro/));
    await clicar(botaoEm(folha() as HTMLElement, "Cancelar lançamento"));

    const dialogo = document.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement;
    expect(dialogo).not.toBeNull();

    // Sem motivo não vai.
    await clicar(botaoEm(dialogo, "Cancelar lançamento"));
    expect(rpcFalso).not.toHaveBeenCalledWith(
      "fin_lancamento_cancelar",
      expect.anything(),
    );
    expect(normalizar(dialogo.textContent)).toContain(
      "por que está cancelando",
    );

    const campo = document.getElementById(
      "fin-cancelar-motivo",
    ) as HTMLTextAreaElement;
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo, "lançado em dobro");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await clicar(botaoEm(dialogo, "Cancelar lançamento"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_cancelar", {
      p_id: "m1",
      p_motivo: "lançado em dobro",
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("a pagar: vencido em destaque, baixa com data e conta, estorno sem ação", async () => {
    await irPara("A pagar e receber");

    const texto = normalizar(hospedeiro.textContent);
    expect(texto).toContain("Vencidos · 1");
    expect(texto).toMatch(/Venceu há \d+ dias/);
    expect(texto).toContain("1/2");
    expect(texto).toContain("Estorno em andamento");
    expect(rpcFalso).toHaveBeenCalledWith("fin_previstos", { p_tipo: "saida" });
    // Só o manual tem "Dar baixa".
    const baixas = [...hospedeiro.querySelectorAll("button")].filter(
      (b) => normalizar(b.textContent).trim() === "Dar baixa",
    );
    expect(baixas).toHaveLength(1);

    await clicar(baixas.at(0) as HTMLButtonElement);
    const baixa = folha() as HTMLElement;
    expect(normalizar(baixa.textContent)).toContain("Registrar pagamento");

    const data = document.getElementById("fin-baixa-data") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(data, "2026-09-20");
      data.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const conta = document.getElementById(
      "fin-baixa-conta",
    ) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set?.call(conta, CONTA_CAIXA_DA_LOJA);
      conta.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clicar(botaoEm(baixa, "Confirmar baixa"));

    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_baixar", {
      p_id: "p1",
      p_data: "2026-09-20",
      p_conta_id: CONTA_CAIXA_DA_LOJA,
    });
    expect(folha()).toBeNull();
  });
});
