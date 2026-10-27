// @vitest-environment jsdom
//
// Financeiro — o Caixa "na frente" (desenho aprovado de 24/10/2026): a aba
// Caixa é a 2ª, com um ponto de estado; a Visão abre com o cartão-herói
// "Caixa de hoje" (Abrir caixa ABRE A FOLHA na hora, Fechar caixa idem); o
// atalho "Caixa" do Início cai direto na aba Caixa.
//
// SÓ APRESENTAÇÃO E NAVEGAÇÃO: nenhuma RPC nova e nenhuma regra de dinheiro.
// Os testes abaixo travam também o que NÃO pode acontecer: o cartão nunca
// grava nada sozinho, nunca diz "fechado" sem saber, e a tela faz UMA leitura
// do caixa (cartão, ponto da aba e aba Caixa leem a mesma).
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso, servidor } = vi.hoisted(() => ({
  rpcFalso: vi.fn(),
  servidor: {
    caixa: null as Record<string, unknown> | null,
    falhasLeituraCaixa: [] as unknown[],
    leituraPendurada: false,
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { ParaFazer } from "@/components/admin/inicio/ParaFazer";
import type { PainelInicio } from "@/types/painel";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const RESUMO = {
  periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
  saldo_total: 453.88,
  contas: [{ id: "c1", nome: "Caixa da loja", tipo: "caixa", saldo: 34.9 }],
  entradas: 453.88,
  saidas: 0,
  resultado: 453.88,
  a_receber: { total: 0, vencido: 0, proximos_7_dias: 0 },
  a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
  por_forma: [],
  por_canal: { online: 0, presencial: 0 },
  serie: [],
  caixa_aberto: null,
};

const CAIXA_ABERTO = {
  id: "sessao-1",
  conta_id: "c1",
  conta_nome: "Caixa da loja",
  aberto_em: "2026-10-24T11:30:00Z",
  valor_abertura: 150,
  vendas_dinheiro: 330.5,
  devolucoes_dinheiro: 0,
  entradas_manuais: 0,
  saidas_manuais: 0,
  esperado: 480.5,
  movimentos: [],
};

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-content"]');

const leiturasDoCaixa = () =>
  rpcFalso.mock.calls.filter(([nome]) => nome === "fin_caixa_atual").length;

describe("Financeiro — o Caixa na frente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    servidor.caixa = null;
    servidor.falhasLeituraCaixa = [];
    servidor.leituraPendurada = false;
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      switch (nome) {
        case "fin_resumo":
          return { data: RESUMO, error: null };
        case "fin_caixa_atual":
          if (servidor.leituraPendurada) return new Promise(() => {});
          return {
            data: servidor.caixa,
            error: servidor.falhasLeituraCaixa.shift() ?? null,
          };
        case "fin_caixa_abrir":
          servidor.caixa = CAIXA_ABERTO;
          return { data: { id: "sessao-1" }, error: null };
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
    localStorage.clear();
    vi.useRealTimers();
  });

  async function montar(abaInicial?: string | null) {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          abaInicial={abaInicial}
        />,
      );
    });
    await esperar();
  }

  const botao = (rotulo: string) =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => normalizar(b.textContent) === rotulo,
    );
  const abas = () => [
    ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];
  const abaAtiva = () =>
    normalizar(
      hospedeiro.querySelector('[role="tab"][data-state="active"]')
        ?.textContent,
    );
  const heroi = () =>
    hospedeiro.querySelector<HTMLElement>('section[aria-label="Caixa"]');

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await esperar();
  }

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

  describe("as abas", () => {
    it("a ordem é Visão, Caixa, Extrato, Pagar e receber, Resultado", async () => {
      await montar();
      expect(abas().map((a) => normalizar(a.textContent))).toEqual([
        "Visão",
        "Caixa",
        "Extrato",
        "Pagar e receber",
        "Resultado",
      ]);
    });

    it("a Caixa é a 2ª e a lista não obriga rolar até ela (cabem as 3 primeiras em 280px)", async () => {
      await montar();
      const [visao, caixa] = abas();
      expect(normalizar(visao.textContent)).toBe("Visão");
      expect(normalizar(caixa.textContent)).toBe("Caixa");
      // Largura: sem ícone, texto curto, `flex-none` (não encolhe) e colada na Visão.
      expect(caixa.classList.contains("flex-none")).toBe(true);
      expect(visao.nextElementSibling).toBe(caixa);
    });

    it("caixa fechado: a aba não tem ponto; aberto: ponto verde decorativo e o nome acessível diz 'aberto'", async () => {
      await montar();
      const ponto = () =>
        abas()[1].querySelector<HTMLElement>("[data-ponto-do-caixa]");
      expect(ponto()).toBeNull();
      expect(abas()[1].getAttribute("aria-label")).toBeNull();

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      servidor.caixa = CAIXA_ABERTO;
      await montar();
      expect(ponto()).not.toBeNull();
      expect(ponto()?.getAttribute("aria-hidden")).toBe("true");
      expect(ponto()?.className).toContain("bg-emerald-");
      expect(abas()[1].getAttribute("aria-label")).toBe("Caixa, aberto");
      // O texto da aba continua sendo só "Caixa" (nada de texto escondido).
      expect(normalizar(abas()[1].textContent)).toBe("Caixa");
    });

    it("sem saber o estado (lendo ou com erro) a aba não tem ponto: cor só com significado", async () => {
      servidor.leituraPendurada = true;
      await montar();
      expect(abas()[1].querySelector("[data-ponto-do-caixa]")).toBeNull();
    });
  });

  describe("o cartão Caixa de hoje na Visão", () => {
    it("fica no TOPO da Visão (antes do saldo), em tinta, e diz Caixa de hoje + Fechado", async () => {
      await montar();
      const cartao = heroi()!;
      expect(cartao).not.toBeNull();
      expect(cartao.getAttribute("data-faixa-do-caixa")).toBe("fechado");
      expect([...cartao.classList]).toEqual(
        expect.arrayContaining([
          "bg-foreground",
          "text-background",
          "rounded-[20px]",
        ]),
      );
      const texto = normalizar(cartao.textContent);
      expect(texto).toContain("Caixa de hoje");
      expect(texto).toContain("Fechado");
      expect(texto).toContain("Caixa fechado");
      const saldo = hospedeiro.querySelector(
        'section[aria-label="Saldo total"]',
      );
      expect(
        cartao.compareDocumentPosition(saldo!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("fechado: 'Abrir caixa' ABRE A FOLHA NA HORA (1 toque), sem trocar de aba e sem gravar nada", async () => {
      await montar();
      expect(abaAtiva()).toBe("Visão");
      await clicar(botao("Abrir caixa")!);
      expect(folha()).not.toBeNull();
      expect(folha()?.textContent).toContain("Dinheiro na gaveta (R$)");
      expect(abaAtiva()).toBe("Visão");
      // Abrir a folha não é abrir o caixa: nenhuma escrita sem confirmar.
      expect(
        rpcFalso.mock.calls.some(([nome]) => nome === "fin_caixa_abrir"),
      ).toBe(false);
    });

    it("fechado: 'Ver caixa' leva à aba Caixa", async () => {
      await montar();
      await clicar(botao("Ver caixa")!);
      expect(abaAtiva()).toBe("Caixa");
      expect(folha()).toBeNull();
    });

    it("aberto: valor grande = esperado na gaveta agora (o mesmo da aba Caixa), Aberto, desde quando e troco", async () => {
      servidor.caixa = CAIXA_ABERTO;
      await montar();
      const cartao = heroi()!;
      expect(cartao.getAttribute("data-faixa-do-caixa")).toBe("aberto");
      const texto = normalizar(cartao.textContent);
      expect(texto).toContain("R$ 480,50");
      expect(texto).toContain("esperado na gaveta agora");
      expect(texto).toContain("Aberto");
      expect(texto).toContain("troco R$ 150,00");
      const valor = [...cartao.querySelectorAll("span")].find(
        (s) => normalizar(s.textContent) === "R$ 480,50",
      )!;
      // Dinheiro nunca quebra no meio e é tabular.
      expect(valor.className).toContain("whitespace-nowrap");
      expect(valor.className).toContain("tabular-nums");

      // A aba Caixa mostra o MESMO esperado (uma só fonte).
      await clicar(abas()[1]);
      expect(normalizar(hospedeiro.textContent)).toContain("R$ 480,50");
    });

    it("aberto: 'Fechar caixa' abre a folha de fechamento existente e 'Ver caixa' leva à aba", async () => {
      servidor.caixa = CAIXA_ABERTO;
      await montar();
      await clicar(botao("Fechar caixa")!);
      expect(folha()).not.toBeNull();
      expect(normalizar(folha()?.textContent)).toContain("Quebra de caixa");
      expect(abaAtiva()).toBe("Visão");
      expect(
        rpcFalso.mock.calls.some(
          ([nome]) => nome === "fin_caixa_fechar_sessao",
        ),
      ).toBe(false);
    });

    it("aberto em OUTRO dia mostra a data junto; aberto hoje mostra só a hora", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T15:00:00Z"));
      servidor.caixa = { ...CAIXA_ABERTO, aberto_em: "2026-10-22T20:00:00Z" };
      await montar();
      expect(normalizar(heroi()?.textContent)).toContain("desde 22/10, 17:00");

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      servidor.caixa = { ...CAIXA_ABERTO, aberto_em: "2026-10-24T11:30:00Z" };
      await montar();
      const texto = normalizar(heroi()?.textContent);
      expect(texto).toContain("desde 08:30");
      expect(texto).not.toMatch(/\d\d\/\d\d/);
    });

    it("Ocultar esconde o esperado e o troco do cartão (e a máscara tem sempre o mesmo tamanho)", async () => {
      servidor.caixa = CAIXA_ABERTO;
      await montar();
      expect(normalizar(heroi()?.textContent)).toContain("480,50");
      await clicar(botao("Ocultar")!);
      const texto = normalizar(heroi()?.textContent);
      expect(texto).not.toContain("480,50");
      expect(texto).not.toContain("150,00");
      expect(texto).toContain("Valor oculto");
      // Os botões continuam à mão com o valor oculto.
      expect(botao("Fechar caixa")).toBeDefined();
    });

    it("carregando o caixa: esqueleto, e NUNCA 'Caixa fechado' nem o botão Abrir caixa (não se sabe ainda)", async () => {
      servidor.leituraPendurada = true;
      await montar();
      expect(heroi()).toBeNull();
      const lendo = hospedeiro.querySelector(
        '[data-caixa-lendo][aria-busy="true"]',
      );
      expect(lendo).not.toBeNull();
      expect(hospedeiro.textContent).not.toContain("Caixa fechado");
      expect(botao("Abrir caixa")).toBeUndefined();
      // O resto da Visão não espera pelo caixa.
      expect(
        hospedeiro.querySelector('section[aria-label="Saldo total"]'),
      ).not.toBeNull();
    });

    it("erro ao ler o caixa: mensagem com 'Tentar de novo', e NUNCA oferece Abrir caixa (pode estar aberto)", async () => {
      servidor.falhasLeituraCaixa = [{ message: "Failed to fetch" }];
      await montar();
      expect(heroi()).toBeNull();
      expect(botao("Abrir caixa")).toBeUndefined();
      const alerta = hospedeiro.querySelector('[role="alert"]');
      expect(alerta).not.toBeNull();

      await clicar(botao("Tentar de novo")!);
      expect(heroi()?.getAttribute("data-faixa-do-caixa")).toBe("fechado");
      expect(botao("Abrir caixa")).toBeDefined();
    });

    it("abrir pelo cartão: a folha confirma, o cartão vira Aberto e a aba ganha o ponto (mesma leitura)", async () => {
      await montar();
      await clicar(botao("Abrir caixa")!);
      await digitar("fin-caixa-abertura", "15000");
      const dentro = [
        ...(folha() as HTMLElement).querySelectorAll<HTMLButtonElement>(
          "button",
        ),
      ].find((b) => normalizar(b.textContent) === "Abrir caixa")!;
      await clicar(dentro);

      expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_abrir", {
        p_valor_abertura: 150,
        p_conta_id: expect.any(String),
      });
      expect(folha()).toBeNull();
      expect(heroi()?.getAttribute("data-faixa-do-caixa")).toBe("aberto");
      expect(normalizar(heroi()?.textContent)).toContain("R$ 480,50");
      expect(abas()[1].querySelector("[data-ponto-do-caixa]")).not.toBeNull();
    });

    it("uma leitura só do caixa: cartão, ponto e aba Caixa compartilham (nem a troca de aba refaz)", async () => {
      servidor.caixa = CAIXA_ABERTO;
      await montar();
      expect(leiturasDoCaixa()).toBe(1);
      await clicar(abas()[1]);
      await clicar(abas()[0]);
      expect(leiturasDoCaixa()).toBe(1);
    });
  });

  describe("a aba com que a tela abre (vinda do Início)", () => {
    it.each([
      ["caixa", "Caixa"],
      ["extrato", "Extrato"],
      ["previstos", "Pagar e receber"],
      ["dre", "Resultado"],
    ])("abaInicial=%s abre em %s", async (valor, rotulo) => {
      await montar(valor);
      expect(abaAtiva()).toBe(rotulo);
    });

    it.each([undefined, null, "", "contas", "CAIXA", "lixo", "../caixa"])(
      "abaInicial=%j é ignorado e abre na Visão",
      async (valor) => {
        await montar(valor);
        expect(abaAtiva()).toBe("Visão");
      },
    );
  });

  describe("o topo", () => {
    it("Contas e Ocultar são chips de 36px, cantos de 12px e letra de 13px, com toque de 44px; o título tem 28px", async () => {
      await montar();
      for (const rotulo of ["Contas", "Ocultar"]) {
        const chip = botao(rotulo)!;
        expect([...chip.classList]).toEqual(
          expect.arrayContaining([
            "h-9",
            "rounded-[12px]",
            "text-[13px]",
            "border-solid",
          ]),
        );
        // O alvo de toque de 44px vem da área extra, não de engordar o chip.
        expect(chip.className).toContain("before:-inset-y-1");
      }
      const cabecalho = hospedeiro.querySelector("h1")!.parentElement!;
      expect(cabecalho.className).toContain("[&_h1]:text-[28px]");
      expect(cabecalho.className).toContain("[&_h1]:font-bold");
    });
  });
});

describe("Início → atalho Caixa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const painel = {
    pendencias: {
      pedidosParaPreparar: 0,
      devolucoesAbertas: 0,
      estoqueBaixo: 0,
      caixaAberto: true,
    },
    contasVencidas: 2,
  } as unknown as PainelInicio;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const linha = (comeco: string) =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith(comeco),
    )!;

  it("a linha Caixa (aberto ou fechado) leva à aba Caixa; as outras linhas do Financeiro seguem indo à Visão", async () => {
    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <ParaFazer
          painel={painel}
          carregando={false}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      linha("Caixa:").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-financeiro", "caixa");

    await act(async () => {
      linha("Contas vencidas:").click();
    });
    // Lote 224: conta vencida abre direto em "Pagar e receber".
    expect(onNavigate.mock.lastCall).toEqual(["admin-financeiro", "previstos"]);

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    const fechado = {
      ...painel,
      pendencias: { ...painel.pendencias, caixaAberto: false },
    } as PainelInicio;
    await act(async () => {
      raiz.render(
        <ParaFazer
          painel={fechado}
          carregando={false}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      linha("Caixa:").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-financeiro", "caixa");
  });
});
