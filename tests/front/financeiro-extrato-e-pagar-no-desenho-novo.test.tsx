// @vitest-environment jsdom
//
// Financeiro — abas Extrato e Pagar e receber no desenho aprovado de
// 23/10/2026 (docs/financeiro-extrato-proposta.png e
// docs/financeiro-pagar-e-receber-proposta.png).
//
// SÓ DESENHO: o que entra no total (só o realizado), o sinal, a janela de 7
// dias e as consultas `fin_*` não mudam — `admin-financeiro-extrato-e-
// previstos` e `financeiro-lib` seguem travando isso. jsdom confere texto e
// classe; ele NÃO mede pixel, quebra de linha a 360px, sobreposição nem
// contraste nos 3 temas (isso é do navegador).
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

const CONTAS = [
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 900,
  },
  {
    id: CONTA_MERCADO_PAGO,
    nome: "Mercado Pago",
    tipo: "mercado_pago",
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 150,
  },
];

const linha = (parcial: Record<string, unknown>) => ({
  origem: "manual",
  tipo: "entrada",
  status: "realizado",
  valor: 10,
  data: "2026-10-23",
  conta_id: CONTA_BANCARIA,
  conta_nome: "Conta bancária",
  categoria_nome: "Vendas",
  descricao: "Lançamento",
  editavel: false,
  ...parcial,
});

// Hoje = 23/10/2026 (relógio falso abaixo); ontem = 22/10.
const EXTRATO = [
  linha({
    id: "v1",
    origem: "venda_online",
    valor: 100,
    conta_id: CONTA_MERCADO_PAGO,
    conta_nome: "Mercado Pago",
    descricao: "Pedido #3884BE",
  }),
  linha({
    id: "v2",
    origem: "venda_balcao",
    valor: 50,
    descricao: "Pedido #5F21AA",
  }),
  linha({
    id: "m2",
    tipo: "saida",
    status: "previsto",
    valor: 800,
    categoria_nome: "Despesa fixa",
    descricao: "Aluguel",
    vencimento: "2026-10-23",
    editavel: true,
  }),
  linha({
    id: "v3",
    origem: "venda_online",
    valor: 75.9,
    data: "2026-10-22",
    conta_id: CONTA_MERCADO_PAGO,
    conta_nome: "Mercado Pago",
    descricao: "Pedido #A91C02",
  }),
  linha({
    id: "m1",
    tipo: "saida",
    valor: 20,
    data: "2026-10-22",
    categoria_nome: "Internet",
    descricao: "Internet de outubro",
    editavel: true,
  }),
];

const prev = (parcial: Record<string, unknown>) => ({
  vencido: false,
  conta_id: CONTA_BANCARIA,
  conta_nome: "Conta bancária",
  categoria_nome: "Despesa fixa",
  parcela: null,
  parcelas: null,
  origem: "manual",
  ...parcial,
});

const A_PAGAR = [
  prev({
    id: "p1",
    descricao: "Aluguel",
    valor: 300,
    vencimento: "2026-10-20",
    vencido: true,
  }),
  prev({
    id: "p2",
    descricao: "Fornecedor Alfa",
    valor: 150,
    vencimento: "2026-10-23",
    parcela: 1,
    parcelas: 3,
    categoria_nome: "Fornecedores",
  }),
  prev({
    id: "p3",
    descricao: "Taxa do Mercado Pago",
    valor: 150,
    vencimento: "2026-10-24",
    origem: "taxa_gateway",
    pedido_id: "11111111-2222-3333-4444-5555553884be",
    categoria_nome: "Taxas",
  }),
  prev({
    id: "p4",
    descricao: "Contador",
    valor: 350,
    vencimento: "2026-11-04",
    categoria_nome: "Serviços",
  }),
];

let extratoAtual: unknown = EXTRATO;
let previstosAtuais: Record<string, unknown[]> = {
  saida: A_PAGAR,
  entrada: [],
};
let extratoPendente: Promise<unknown> | null = null;
let extratoComErro = false;

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — Extrato e Pagar e receber no desenho novo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
    extratoAtual = EXTRATO;
    previstosAtuais = { saida: A_PAGAR, entrada: [] };
    extratoPendente = null;
    extratoComErro = false;
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(
      async (nome: string, args?: Record<string, unknown>) => {
        switch (nome) {
          case "fin_contas_listar":
            return { data: CONTAS, error: null };
          case "fin_extrato":
            if (extratoPendente) return extratoPendente;
            if (extratoComErro) {
              return { data: null, error: { message: "falhou" } };
            }
            return { data: extratoAtual, error: null };
          case "fin_previstos":
            return {
              data: previstosAtuais[String(args?.p_tipo)] ?? [],
              error: null,
            };
          default:
            return { data: [], error: null };
        }
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    });
    await esperar();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    // "Ocultar" grava a escolha no navegador (e deve gravar); sem limpar, o
    // teste que a liga deixaria os valores ocultos para os testes seguintes.
    try {
      globalThis.localStorage?.clear();
    } catch {
      // Sem armazenamento no ambiente de teste: nada a limpar.
    }
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

  const botao = (rotulo: string | RegExp, raiz: ParentNode = hospedeiro) => {
    const achado = [...raiz.querySelectorAll("button")].find((b) => {
      const t = normalizar(b.textContent);
      return typeof rotulo === "string" ? t === rotulo : rotulo.test(t);
    });
    if (!achado) throw new Error(`botão ${String(rotulo)} não existe`);
    return achado as HTMLButtonElement;
  };

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await esperar();
  }

  const secao = (rotulo: string | RegExp) => {
    const s = [...hospedeiro.querySelectorAll("section[aria-label]")].find(
      (el) => {
        const r = el.getAttribute("aria-label") ?? "";
        return typeof rotulo === "string" ? r === rotulo : rotulo.test(r);
      },
    );
    if (!s) throw new Error(`seção ${String(rotulo)} não existe`);
    return s as HTMLElement;
  };
  const classes = (el: Element | null | undefined) => [
    ...(el?.classList ?? []),
  ];

  /** Elemento mais interno cujo texto é exatamente `texto`. */
  const valor = (raiz: ParentNode, texto: string) => {
    const achado = [...raiz.querySelectorAll("span, dd, p")].find(
      (el) => normalizar(el.textContent) === texto && el.children.length === 0,
    );
    if (!achado) throw new Error(`valor ${texto} não existe`);
    return achado as HTMLElement;
  };

  describe("Extrato", () => {
    beforeEach(async () => {
      await irPara("Extrato");
    });

    it("cartão do período: só o realizado, resultado grande com sinal e Entrou/Saiu em uma linha", () => {
      const heroi = secao("Resultado do período");
      expect(normalizar(heroi.textContent)).toContain(
        "Outubro de 2026 · só o realizado",
      );
      // O previsto (aluguel de 800) NÃO entra: 100 + 50 + 75,90 − 20.
      const resultado = valor(heroi, "+R$ 205,90");
      expect(classes(resultado)).toEqual(
        expect.arrayContaining([
          "whitespace-nowrap",
          "text-emerald-400",
          "text-[clamp(2rem,10vw,2.75rem)]",
        ]),
      );
      const entrou = valor(heroi, "+R$ 225,90");
      const saiu = valor(heroi, "−R$ 20,00");
      expect(classes(entrou)).toContain("text-emerald-400");
      expect(classes(saiu)).toContain("text-red-400");
      expect(classes(entrou)).toContain("whitespace-nowrap");
      expect(normalizar(heroi.textContent)).toMatch(/Entrou.*Saiu/);
    });

    it("zero é cinza e sem sinal: nada saiu → 'R$ 0,00' neutro, não vermelho", async () => {
      extratoAtual = [EXTRATO[0]];
      // Recarrega pela troca de conta (nova consulta).
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_MERCADO_PAGO);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      const heroi = secao("Resultado do período");
      const saiu = valor(heroi, "R$ 0,00");
      expect(classes(saiu)).not.toContain("text-red-400");
      expect(classes(saiu)).not.toContain("text-emerald-400");
      expect(classes(valor(heroi, "+R$ 100,00"))).toContain("text-emerald-400");
    });

    it("cada dia é um cartão com 'Hoje · 23 de outubro' / 'Ontem · 22 de outubro' e o total do dia", () => {
      const hoje = secao(/23 de outubro/);
      expect(normalizar(hoje.querySelector("h3")?.textContent)).toBe(
        "Hoje · 23 de outubro",
      );
      // Dia = só o realizado (100 + 50); o aluguel previsto não entra.
      expect(normalizar(hoje.textContent)).toContain("Dia +R$ 150,00");
      expect(classes(hoje)).toEqual(
        expect.arrayContaining(["rounded-3xl", "bg-admin-surface"]),
      );
      const ontem = secao(/22 de outubro/);
      expect(normalizar(ontem.querySelector("h3")?.textContent)).toBe(
        "Ontem · 22 de outubro",
      );
      expect(normalizar(ontem.textContent)).toContain("Dia +R$ 55,90");
    });

    it("linha: título, categoria · conta embaixo, valor à direita sem quebrar; previsto fica cinza e diz que não entra no total", () => {
      const hoje = secao(/23 de outubro/);
      const itens = [...hoje.querySelectorAll("li")];
      expect(itens).toHaveLength(3);
      for (const li of itens) {
        // Divisória fina entre as linhas, na <li> (o <button> não leva borda).
        expect(classes(li)).toEqual(
          expect.arrayContaining(["border-t", "border-solid"]),
        );
        const b = li.querySelector("button") as HTMLButtonElement;
        expect(classes(b)).toContain("min-h-14");
      }
      const venda = itens[0] as HTMLElement;
      expect(normalizar(venda.textContent)).toContain("Pedido #3884BE");
      expect(normalizar(venda.textContent)).toContain("Vendas · Mercado Pago");
      const valorDaVenda = valor(venda, "+R$ 100,00");
      expect(classes(valorDaVenda)).toEqual(
        expect.arrayContaining(["whitespace-nowrap", "text-emerald-400"]),
      );
      const aluguel = itens.at(-1) as HTMLElement;
      const textoAluguel = normalizar(aluguel.textContent);
      expect(textoAluguel).toContain("Aluguel");
      expect(textoAluguel).toContain("Previsto");
      expect(textoAluguel).toContain("não entra no total");
      expect(classes(valor(aluguel, "−R$ 800,00"))).toContain("text-zinc-400");
    });

    it("valor comprido nunca quebra: encolhe a letra em vez de quebrar a linha", async () => {
      extratoAtual = [
        linha({
          id: "g1",
          valor: 1234567.89,
          descricao: "Venda enorme",
        }),
        linha({ id: "g2", valor: 5, descricao: "Venda pequena" }),
      ];
      // Nova consulta pela troca de conta.
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_BANCARIA);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      const grande = valor(hospedeiro, "+R$ 1.234.567,89");
      expect(classes(grande)).toContain("whitespace-nowrap");
      expect(classes(grande)).toContain("text-sm");
      const pequeno = valor(hospedeiro, "+R$ 5,00");
      expect(classes(pequeno)).toContain("whitespace-nowrap");
      expect(classes(pequeno)).toContain("text-[18px]");
      // Herói também encolhe quando o texto é muito longo.
      const heroi = secao("Resultado do período");
      expect(classes(valor(heroi, "+R$ 1.234.572,89"))).toContain(
        "text-[clamp(1.5rem,7vw,2rem)]",
      );
    });

    it("conta é um chip 'Todas as contas' com o seletor de verdade dentro (mesmo id, mesma consulta)", async () => {
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      expect(seletor).not.toBeNull();
      expect(seletor.getAttribute("aria-label")).toBe("Conta");
      const chip = seletor.closest("label") as HTMLElement;
      expect(normalizar(chip.textContent)).toContain("Todas as contas");
      expect(classes(chip)).toEqual(
        expect.arrayContaining(["rounded-full", "border-solid", "min-h-11"]),
      );
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_MERCADO_PAGO);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      expect(rpcFalso).toHaveBeenCalledWith(
        "fin_extrato",
        expect.objectContaining({ p_conta_id: CONTA_MERCADO_PAGO }),
      );
      expect(
        normalizar(
          (document.getElementById("fin-extrato-conta") as HTMLElement).closest(
            "label",
          )?.textContent,
        ),
      ).toContain("Mercado Pago");
    });

    it("filtros Tudo / Entradas / Saídas / Previstos seguem funcionando e o aviso só aparece com filtro", async () => {
      const texto = () => normalizar(hospedeiro.textContent);
      expect(texto()).not.toContain("não mudam ao filtrar");
      await clicar(botao("Entradas"));
      expect(texto()).toContain("Pedido #3884BE");
      expect(texto()).not.toContain("Internet de outubro");
      expect(texto()).toContain("não mudam ao filtrar");
      await clicar(botao("Saídas"));
      expect(texto()).toContain("Internet de outubro");
      expect(texto()).not.toContain("Pedido #3884BE");
      await clicar(botao("Previstos"));
      expect(texto()).toContain("Aluguel");
      expect(texto()).not.toContain("Internet de outubro");
      // O resultado do período não muda ao filtrar.
      expect(normalizar(secao("Resultado do período").textContent)).toContain(
        "+R$ 205,90",
      );
      await clicar(botao("Tudo"));
      expect(texto()).not.toContain("não mudam ao filtrar");
    });

    it("cancelado e transferência: cancelado riscado e fora do total; transferência neutra, sem cor de entrada nem de saída", async () => {
      extratoAtual = [
        linha({
          id: "c1",
          tipo: "saida",
          status: "cancelado",
          valor: 40,
          descricao: "Compra errada",
          categoria_nome: "Mercadoria",
          editavel: true,
        }),
        linha({
          id: "t1",
          tipo: "transferencia",
          valor: 300,
          descricao: "Do caixa para o banco",
          conta_id: CONTA_MERCADO_PAGO,
          conta_nome: "Mercado Pago",
          conta_destino_id: CONTA_BANCARIA,
          conta_destino_nome: "Conta bancária",
        }),
      ];
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      // Vai e volta de conta para forçar uma consulta nova sem filtro.
      for (const escolha of [CONTA_MERCADO_PAGO, ""]) {
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            "value",
          )?.set?.call(seletor, escolha);
          seletor.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await esperar();
      }
      const cancelada = [...hospedeiro.querySelectorAll("li")].find((li) =>
        normalizar(li.textContent).startsWith("Compra errada"),
      ) as HTMLElement;
      expect(normalizar(cancelada.textContent)).toContain("Cancelado");
      expect(normalizar(cancelada.textContent)).toContain("não entra no total");
      expect(classes(valor(cancelada, "−R$ 40,00"))).toEqual(
        expect.arrayContaining(["line-through", "text-zinc-400"]),
      );
      const transf = [...hospedeiro.querySelectorAll("li")].find((li) =>
        normalizar(li.textContent).startsWith("Do caixa para o banco"),
      ) as HTMLElement;
      expect(normalizar(transf.textContent)).toContain(
        "Transferência · Mercado Pago → Conta bancária",
      );
      const v = valor(transf, "R$ 300,00");
      expect(classes(v)).toContain("text-zinc-300");
      expect(classes(v)).not.toContain("text-emerald-400");
      expect(classes(v)).not.toContain("text-red-400");
      // Nem a cancelada nem a transferência mexem no resultado do período.
      expect(normalizar(secao("Resultado do período").textContent)).toContain(
        "R$ 0,00",
      );
      expect(normalizar(secao("Resultado do período").textContent)).not.toMatch(
        /[+−]R\$/,
      );
    });

    it("com uma conta escolhida e o período chegando até hoje, o dia mostra o saldo ao fim dele", async () => {
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_MERCADO_PAGO);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      const hoje = secao(/23 de outubro/);
      expect(normalizar(hoje.textContent)).toContain("Saldo R$ 150,00");
      // Sem conta escolhida não há saldo por dia.
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, "");
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      expect(normalizar(secao(/23 de outubro/).textContent)).not.toContain(
        "Saldo",
      );
    });

    it("tocar na linha abre o detalhe (folha) como antes", async () => {
      await clicar(botao(/^Internet de outubro/));
      const folha = document.querySelector('[data-slot="sheet-content"]');
      expect(folha).not.toBeNull();
    });

    it("Ocultar esconde TODOS os valores dos blocos novos", async () => {
      await clicar(botao("Ocultar"));
      const texto = normalizar(hospedeiro.textContent);
      expect(texto).not.toMatch(/R\$ \d/);
      expect(texto).toContain("R$ ••••••");
      expect(
        secao("Resultado do período").querySelectorAll(".sr-only").length,
      ).toBeGreaterThanOrEqual(3);
    });

    it("vazio: diz que não há lançamento e oferece 'Novo lançamento'", async () => {
      extratoAtual = [];
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_MERCADO_PAGO);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      expect(normalizar(hospedeiro.textContent)).toContain(
        "Nenhum lançamento no período",
      );
      expect(() => botao("Novo lançamento")).not.toThrow();
    });

    it("carregando: esqueleto no lugar do cartão e da lista, sem número inventado", async () => {
      extratoPendente = new Promise(() => {});
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_BANCARIA);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      expect(hospedeiro.querySelectorAll('[aria-busy="true"]').length).toBe(2);
      expect(() => secao("Resultado do período")).toThrow();
      expect(normalizar(hospedeiro.textContent)).not.toMatch(/R\$ 0,00/);
    });

    it("erro: mostra o aviso com 'Tentar de novo' e nenhum total", async () => {
      extratoComErro = true;
      const seletor = document.getElementById(
        "fin-extrato-conta",
      ) as HTMLSelectElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value",
        )?.set?.call(seletor, CONTA_BANCARIA);
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
      expect(() => botao("Tentar de novo")).not.toThrow();
      expect(() => secao("Resultado do período")).toThrow();
    });
  });

  describe("Pagar e receber", () => {
    beforeEach(async () => {
      await irPara("Pagar e receber");
    });

    it("cartão do total: rótulo, valor grande neutro e dois quadros (Vencido em vermelho, Próximos 7 dias)", () => {
      const heroi = secao("Total a pagar");
      expect(normalizar(heroi.textContent)).toContain("Total a pagar");
      // 300 + 150 + 150 + 350.
      const total = valor(heroi, "R$ 950,00");
      expect(classes(total)).toEqual(
        expect.arrayContaining(["whitespace-nowrap", "text-white"]),
      );
      expect(classes(total)).not.toContain("text-red-400");
      const quadros = [...heroi.querySelectorAll("dl > div")];
      expect(quadros).toHaveLength(2);
      const vencido = quadros[0] as HTMLElement;
      expect(normalizar(vencido.querySelector("dt")?.textContent)).toBe(
        "Vencido",
      );
      expect(classes(valor(vencido, "R$ 300,00"))).toEqual(
        expect.arrayContaining(["text-red-400", "whitespace-nowrap"]),
      );
      expect(classes(vencido)).toContain("bg-red-400/10");
      const proximos = quadros[1] as HTMLElement;
      // Hoje (150) + amanhã (150) entram nos próximos 7 dias.
      expect(normalizar(proximos.querySelector("dt")?.textContent)).toBe(
        "Próximos 7 dias",
      );
      expect(classes(valor(proximos, "R$ 300,00"))).toContain("text-white");
      expect(classes(proximos)).not.toContain("bg-red-400/10");
    });

    it("sem nada vencido o quadro fica neutro (cinza), não vermelho", async () => {
      previstosAtuais = {
        saida: [A_PAGAR[3] as Record<string, unknown>],
        entrada: [],
      };
      await clicar(botao("A receber"));
      await clicar(botao("A pagar"));
      const heroi = secao("Total a pagar");
      const vencido = heroi.querySelectorAll("dl > div")[0] as HTMLElement;
      expect(normalizar(vencido.querySelector("dt")?.textContent)).toBe(
        "Vencido",
      );
      expect(classes(vencido)).not.toContain("bg-red-400/10");
      expect(classes(valor(vencido, "R$ 0,00"))).not.toContain("text-red-400");
    });

    it("grupos por vencimento com o contador, e a data ao lado do 'vence em'", () => {
      const titulos = [...hospedeiro.querySelectorAll("h2")].map((h) =>
        normalizar(h.textContent),
      );
      expect(titulos).toEqual(
        expect.arrayContaining([
          "Vencidos · 1",
          "Vencem hoje · 1",
          "Próximos 7 dias · 1",
          "Mais adiante · 1",
        ]),
      );
      const vencidos = [...hospedeiro.querySelectorAll("h2")].find(
        (h) => normalizar(h.textContent) === "Vencidos · 1",
      );
      expect(classes(vencidos)).toContain("text-red-400");
      const texto = normalizar(hospedeiro.textContent);
      expect(texto).toContain("Venceu há 3 dias");
      expect(texto).toContain("Vence hoje");
      expect(texto).toContain("Vence amanhã");
      expect(texto).toContain("Fornecedor Alfa · 1/3");
    });

    it("cada conta é um cartão: título + valor à direita sem quebrar, categoria · conta, situação colorida pelo que significa", () => {
      const cartao = [...hospedeiro.querySelectorAll("li")].find((li) =>
        normalizar(li.textContent).startsWith("Aluguel"),
      ) as HTMLElement;
      expect(classes(cartao)).toEqual(
        expect.arrayContaining(["rounded-3xl", "bg-admin-surface", "p-4"]),
      );
      expect(normalizar(cartao.textContent)).toContain(
        "Despesa fixa · Conta bancária",
      );
      const v = valor(cartao, "R$ 300,00");
      expect(classes(v)).toEqual(
        expect.arrayContaining(["whitespace-nowrap", "shrink-0"]),
      );
      const situacao = [...cartao.querySelectorAll("p")].find((p) =>
        normalizar(p.textContent).startsWith("Venceu há"),
      );
      expect(classes(situacao)).toContain("text-red-400");
      const hoje = [...hospedeiro.querySelectorAll("li")].find((li) =>
        normalizar(li.textContent).startsWith("Fornecedor Alfa"),
      ) as HTMLElement;
      const situacaoHoje = [...hoje.querySelectorAll("p")].find((p) =>
        normalizar(p.textContent).startsWith("Vence hoje"),
      );
      expect(classes(situacaoHoje)).toContain("text-amber-400");
    });

    it("'Dar baixa' é o botão primário neutro e 'Cancelar' o secundário; ambos em pílula de 44px", async () => {
      const cartao = [...hospedeiro.querySelectorAll("li")].find((li) =>
        normalizar(li.textContent).startsWith("Aluguel"),
      ) as HTMLElement;
      const baixa = botao("Dar baixa", cartao);
      const cancelar = botao("Cancelar", cartao);
      for (const b of [baixa, cancelar]) {
        expect(classes(b)).toEqual(
          expect.arrayContaining(["min-h-11", "rounded-full", "border-solid"]),
        );
      }
      expect(classes(baixa)).toEqual(
        expect.arrayContaining(["bg-foreground", "text-background"]),
      );
      expect(classes(cancelar)).not.toContain("bg-foreground");
      expect(classes(cancelar)).not.toContain("text-red-300");
      // Não existe dourado nem degradê no primário.
      expect(baixa.className).not.toMatch(/gold|yellow|gradient/);
      await clicar(baixa);
      expect(
        normalizar(
          document.querySelector('[data-slot="sheet-content"]')?.textContent,
        ),
      ).toContain("Registrar pagamento");
    });

    it("o que vem do pedido não tem baixa nem cancelamento: só a nota e 'Abrir pedido'", () => {
      const taxa = [...hospedeiro.querySelectorAll("li")].find((li) =>
        normalizar(li.textContent).startsWith("Taxa do Mercado Pago"),
      ) as HTMLElement;
      expect(() => botao("Dar baixa", taxa)).toThrow();
      expect(() => botao("Cancelar", taxa)).toThrow();
      expect(normalizar(taxa.textContent)).toContain("vem do pedido");
      expect(() => botao(/^Abrir pedido #/, taxa)).not.toThrow();
    });

    it("A receber: mesmo desenho, rótulo e consulta do outro lado", async () => {
      previstosAtuais = {
        saida: A_PAGAR,
        entrada: [
          prev({
            id: "r1",
            descricao: "Aluguel do quiosque",
            valor: 1500,
            vencimento: "2026-10-30",
            categoria_nome: "Aluguéis recebidos",
          }),
        ],
      };
      await clicar(botao("A receber"));
      expect(rpcFalso).toHaveBeenCalledWith("fin_previstos", {
        p_tipo: "entrada",
      });
      const heroi = secao("Total a receber");
      // Total a receber também é neutro: ainda não entrou, então não é verde.
      expect(classes(valor(heroi, "R$ 1.500,00"))).toContain("text-white");
      expect(classes(valor(heroi, "R$ 1.500,00"))).toContain(
        "whitespace-nowrap",
      );
    });

    it("valor comprido encolhe a letra e nunca quebra", async () => {
      previstosAtuais = {
        saida: [
          prev({
            id: "g",
            descricao: "Compra grande",
            valor: 1234567.89,
            vencimento: "2026-11-30",
          }),
        ],
        entrada: [],
      };
      await clicar(botao("A receber"));
      await clicar(botao("A pagar"));
      const heroi = secao("Total a pagar");
      const grande = valor(heroi, "R$ 1.234.567,89");
      expect(classes(grande)).toContain("whitespace-nowrap");
      expect(classes(grande)).toContain("text-[clamp(1.5rem,7vw,2rem)]");
      const vencido = heroi.querySelectorAll("dl > div")[1] as HTMLElement;
      // 'R$ 0,00' (7 caracteres) cabe em letra grande.
      expect(
        classes(valor(vencido, "R$ 0,00")).some((c) => c.startsWith("text-[")),
      ).toBe(true);
    });

    it("Ocultar esconde o total, os quadros e cada conta", async () => {
      await clicar(botao("Ocultar"));
      const texto = normalizar(hospedeiro.textContent);
      expect(texto).not.toMatch(/R\$ \d/);
      expect(texto).toContain("R$ ••••••");
    });

    it("vazio: 'Nenhuma conta a pagar' com o botão de lançar, e o total zerado fica cinza", async () => {
      previstosAtuais = { saida: [], entrada: [] };
      await clicar(botao("A receber"));
      await clicar(botao("A pagar"));
      expect(normalizar(hospedeiro.textContent)).toContain(
        "Nenhuma conta a pagar",
      );
      expect(() => botao("Lançar conta a pagar")).not.toThrow();
      const heroi = secao("Total a pagar");
      const total = heroi.querySelector(".tabular-nums") as HTMLElement;
      expect(normalizar(total.textContent)).toBe("R$ 0,00");
      expect(classes(total)).toContain("text-zinc-400");
      expect(classes(total)).not.toContain("text-white");
    });

    it("erro na consulta: aviso com 'Tentar de novo' e nenhum total inventado", async () => {
      rpcFalso.mockImplementation(async (nome: string) =>
        nome === "fin_previstos"
          ? { data: null, error: { message: "falhou" } }
          : { data: [], error: null },
      );
      await clicar(botao("A receber"));
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
      expect(() => botao("Tentar de novo")).not.toThrow();
      expect(() => secao("Total a receber")).toThrow();
    });

    it("carregando: esqueleto no lugar do cartão e da lista", async () => {
      rpcFalso.mockImplementation(async (nome: string) =>
        nome === "fin_previstos"
          ? new Promise(() => {})
          : { data: [], error: null },
      );
      await clicar(botao("A receber"));
      expect(hospedeiro.querySelectorAll('[aria-busy="true"]').length).toBe(2);
      expect(() => secao("Total a receber")).toThrow();
    });
  });
});
