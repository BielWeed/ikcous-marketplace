// @vitest-environment jsdom
//
// Financeiro — Extrato, dia ANTES do saldo inicial da conta (defeito
// financeiro-2). O saldo de hoje da conta só soma movimento a partir de
// `saldo_inicial_em`; o extrato devolve também as vendas anteriores. Antes
// do conserto o app reconstruía o saldo para trás por cima delas e mostrava
// "Saldo −R$ …" em dias em que a conta tinha dinheiro. Agora o dia sem saldo
// mostra um traço neutro — nunca R$ 0,00 nem número reconstruído.
//
// A conta (lib) está em `financeiro-lib`; aqui se prova o que a PESSOA vê.
// jsdom confere texto e classe; ele NÃO mede pixel nem contraste dos temas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { CONTA_BANCARIA, CONTA_MERCADO_PAGO } from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const conta = (parcial: Record<string, unknown>) => ({
  tipo: "banco",
  ativa: true,
  ordem: 1,
  sistema: true,
  saldo_inicial: 0,
  ...parcial,
});

let contas: unknown[] = [];

const linha = (parcial: Record<string, unknown>) => ({
  origem: "venda_online",
  tipo: "entrada",
  status: "realizado",
  valor: 10,
  data: "2026-10-23",
  conta_id: CONTA_MERCADO_PAGO,
  conta_nome: "Mercado Pago",
  categoria_nome: "Vendas",
  descricao: "Pedido",
  editavel: false,
  ...parcial,
});

// Hoje = 23/10/2026. A conta tem saldo inicial em 22/10: o dia 21 é ANTES.
const EXTRATO = [
  linha({ id: "v1", valor: 100, data: "2026-10-23", descricao: "Pedido A" }),
  linha({ id: "v2", valor: 75.9, data: "2026-10-22", descricao: "Pedido B" }),
  linha({ id: "v3", valor: 300, data: "2026-10-21", descricao: "Pedido C" }),
  linha({ id: "v4", valor: 40, data: "2026-10-20", descricao: "Pedido D" }),
];

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — Extrato: dia antes do saldo inicial não mostra saldo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
    contas = [
      conta({
        id: CONTA_BANCARIA,
        nome: "Conta bancária",
        saldo: 900,
        saldo_inicial_em: "2026-10-01",
      }),
      conta({
        id: CONTA_MERCADO_PAGO,
        nome: "Mercado Pago",
        tipo: "mercado_pago",
        ordem: 2,
        saldo: 150,
        saldo_inicial_em: "2026-10-22",
      }),
    ];
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      switch (nome) {
        case "fin_contas_listar":
          return { data: contas, error: null };
        case "fin_extrato":
          return { data: EXTRATO, error: null };
        default:
          return { data: [], error: null };
      }
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function abrirExtratoDaConta(id: string) {
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    });
    await esperar();
    const gatilho = [...hospedeiro.querySelectorAll('[role="tab"]')].find(
      (t) => t.textContent === "Extrato",
    ) as HTMLElement;
    await act(async () => {
      gatilho.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
    const seletor = document.getElementById(
      "fin-extrato-conta",
    ) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set?.call(seletor, id);
      seletor.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
  }

  const dia = (rotulo: RegExp) => {
    const s = [...hospedeiro.querySelectorAll("section[aria-label]")].find(
      (el) => rotulo.test(el.getAttribute("aria-label") ?? ""),
    );
    if (!s) throw new Error(`dia ${String(rotulo)} não existe`);
    return normalizar(s.querySelector("h3")?.parentElement?.textContent);
  };

  it("do saldo inicial em diante o saldo aparece; antes dele vira traço, sem número", async () => {
    await abrirExtratoDaConta(CONTA_MERCADO_PAGO);
    // Hoje e o dia do saldo inicial (22) continuam com número: 150 e 150 − 100.
    expect(dia(/23 de outubro/)).toContain("Saldo R$ 150,00");
    expect(dia(/22 de outubro/)).toContain("Saldo R$ 50,00");
    // Antes do saldo inicial: traço; nada de R$, nada de negativo.
    for (const d of [/21 de outubro/, /20 de outubro/]) {
      const cabecalho = dia(d);
      expect(cabecalho).toContain("Saldo —");
      expect(cabecalho).not.toMatch(/Saldo R\$|Saldo −/);
    }
    // O "Dia ±R$" (entradas − saídas do dia) segue no lugar.
    expect(dia(/21 de outubro/)).toContain("Dia +R$ 300,00");
  });

  it("sem saldo inicial conhecido (conta velha/dado ausente) nada é cortado, como antes", async () => {
    contas = [
      conta({
        id: CONTA_MERCADO_PAGO,
        nome: "Mercado Pago",
        tipo: "mercado_pago",
        saldo: 150,
        saldo_inicial_em: null,
      }),
    ];
    await abrirExtratoDaConta(CONTA_MERCADO_PAGO);
    expect(dia(/23 de outubro/)).toContain("Saldo R$ 150,00");
    // 150 − 100 − 75,90 = 25,90 (sem corte, como sempre foi).
    expect(dia(/21 de outubro/)).not.toContain("Saldo —");
    expect(dia(/21 de outubro/)).toContain("Saldo −R$ 25,90");
  });

  it("sem conta escolhida o saldo por dia não aparece em dia nenhum (nem o traço)", async () => {
    await abrirExtratoDaConta("");
    for (const d of [/23 de outubro/, /21 de outubro/]) {
      expect(dia(d)).not.toContain("Saldo");
    }
  });

  it("Ocultar: o saldo some atrás da máscara e o traço não vira canal (nenhum dígito, mesma frase)", async () => {
    await abrirExtratoDaConta(CONTA_MERCADO_PAGO);
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => normalizar(b.textContent) === "Ocultar",
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await esperar();
    // Só o trecho do saldo (o título do dia carrega a data, que é número).
    const saldo = (d: RegExp) => {
      const texto = dia(d);
      return texto.slice(texto.indexOf("Saldo"));
    };
    expect(saldo(/22 de outubro/)).toContain("Saldo R$ ••••••");
    expect(saldo(/22 de outubro/)).not.toMatch(/\d/);
    expect(saldo(/21 de outubro/)).toContain("Saldo —");
    expect(saldo(/21 de outubro/)).not.toMatch(/\d/);
    // O traço é idêntico em qualquer dia sem saldo: não carrega valor.
    expect(saldo(/20 de outubro/)).toBe(saldo(/21 de outubro/));
  });
});
