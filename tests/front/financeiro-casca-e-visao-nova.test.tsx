// @vitest-environment jsdom
//
// Financeiro — casca nova e aba Visão no desenho aprovado de 22/10/2026
// (docs/financeiro-visao-proposta.png): cabeçalho com os chips Contas e
// Ocultar, abas só com texto, período em chip, botão redondo "+" e a Visão em
// blocos (saldo em destaque, entradas/saídas, a pagar/a receber, faixa do
// caixa, saldo por conta, fluxo, formas de recebimento, app × loja).
//
// SÓ DESENHO: saldo, sinais, previsto × realizado e as janelas não mudam —
// os outros testes do financeiro seguem travando isso. jsdom confere classes e
// textos; ele NÃO mede pixel, sobreposição nem contraste (isso é do navegador).
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
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

import { AbaVisao } from "@/components/admin/financeiro/AbaVisao";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const RESUMO_BASE = {
  periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
  saldo_total: 453.88,
  contas: [
    { id: "c1", nome: "Caixa da loja", tipo: "caixa", saldo: 34.9 },
    { id: "c2", nome: "Conta bancária", tipo: "banco", saldo: 313.9 },
    { id: "c3", nome: "Mercado Pago", tipo: "mercado_pago", saldo: 105.08 },
  ],
  entradas: 453.88,
  saidas: 0,
  resultado: 453.88,
  a_receber: { total: 900, vencido: 100, proximos_7_dias: 300 },
  a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
  por_forma: [{ forma: "pix", valor: 100 }],
  por_canal: { online: 418.98, presencial: 34.9 },
  serie: [],
  caixa_aberto: null,
};

let resumoAtual: Record<string, unknown> = RESUMO_BASE;

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — casca nova e Visão no desenho aprovado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    resumoAtual = RESUMO_BASE;
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_resumo") return { data: resumoAtual, error: null };
      return { data: [], error: null };
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
  });

  async function montar(ativa = true) {
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={vi.fn()} active={ativa} />);
    });
    await esperar();
  }

  const botao = (rotulo: string | RegExp) =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      typeof rotulo === "string"
        ? normalizar(b.textContent) === rotulo
        : rotulo.test(normalizar(b.textContent)),
    );

  async function abrirAba(rotulo: string) {
    const aba = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((a) => normalizar(a.textContent) === rotulo)!;
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await esperar();
  }

  const secao = (rotulo: string) =>
    hospedeiro.querySelector<HTMLElement>(`section[aria-label="${rotulo}"]`)!;

  describe("cabeçalho", () => {
    it("título Financeiro e dois chips: Contas (neutro, sem pressionar) e Ocultar", async () => {
      await montar();
      const titulo = hospedeiro.querySelector("h1");
      expect(normalizar(titulo?.textContent)).toBe("Financeiro");

      const contas = botao("Contas")!;
      const ocultar = botao("Ocultar")!;
      expect(contas).toBeDefined();
      expect(ocultar).toBeDefined();
      // Chip, não cartão: pílula de 44px, com moldura sólida (o index.css zera
      // a borda de todo botão) e sem dourado.
      for (const chip of [contas, ocultar]) {
        expect([...chip.classList]).toEqual(
          expect.arrayContaining([
            "min-h-11",
            "rounded-full",
            "border",
            "border-solid",
          ]),
        );
        expect(chip.className).not.toContain("admin-gold");
      }
      expect(contas.getAttribute("aria-pressed")).toBe("false");
      expect(ocultar.getAttribute("aria-pressed")).toBe("false");
      expect(ocultar.getAttribute("aria-label")).toBe("Ocultar valores");
    });

    it("Contas abre a visão de contas, fica selecionado em neutro e nenhuma aba fica ativa; tocar de novo volta à Visão", async () => {
      await montar();
      const contas = botao("Contas")!;
      await act(async () => {
        contas.click();
      });
      await esperar();

      expect(contas.getAttribute("aria-pressed")).toBe("true");
      // Selecionado = neutro (borda forte + fundo elevado), nunca cor de marca.
      expect([...contas.classList]).toEqual(
        expect.arrayContaining(["border-foreground", "bg-admin-hover"]),
      );
      expect(contas.className).not.toContain("admin-gold");
      expect(
        hospedeiro.querySelector('[role="tab"][data-state="active"]'),
      ).toBeNull();
      // Conteúdo de hoje da aba "Contas e categorias", inalterado.
      expect(hospedeiro.textContent).toContain("Cadastros da loja");
      expect(hospedeiro.textContent).toContain("Categorias");
      expect(botao("Nova conta")).toBeDefined();

      await act(async () => {
        contas.click();
      });
      await esperar();
      expect(contas.getAttribute("aria-pressed")).toBe("false");
      expect(
        hospedeiro.querySelector('[role="tab"][data-state="active"]')
          ?.textContent,
      ).toBe("Visão");
    });

    it("Ocultar esconde valores dos blocos NOVOS (herói, etiqueta, entradas, a pagar/receber, caixa e contas) e o chip diz Mostrar", async () => {
      resumoAtual = {
        ...RESUMO_BASE,
        caixa_aberto: {
          id: "s1",
          conta_id: "c1",
          aberto_em: "2026-10-23T12:00:00Z",
          valor_abertura: 77.77,
        },
      };
      await montar();
      const visivel = normalizar(hospedeiro.textContent);
      for (const numero of [
        "453,88", // herói, etiqueta e entradas
        "900,00", // a receber
        "100,00", // vencido
        "300,00", // próximos 7 dias
        "313,90", // saldo por conta
        "77,77", // troco da gaveta
        "418,98", // app
      ]) {
        expect(visivel, numero).toContain(numero);
      }

      await act(async () => {
        botao("Ocultar")!.click();
      });
      const oculto = normalizar(hospedeiro.textContent);
      for (const numero of [
        "453,88",
        "900,00",
        "100,00",
        "300,00",
        "313,90",
        "34,90",
        "105,08",
        "77,77",
        "418,98",
      ]) {
        expect(oculto, numero).not.toContain(numero);
      }
      expect(oculto).toContain("Valor oculto");
      expect(botao("Mostrar")?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("abas e período", () => {
    it("abas só com texto: cinco, sem ícone, sem Avançado, ≥44px e ativa com traço neutro", async () => {
      await montar();
      const lista = hospedeiro.querySelector(
        '[role="tablist"][aria-label="Abas do Financeiro"]',
      )!;
      const abas = [...lista.querySelectorAll<HTMLElement>('[role="tab"]')];
      expect(abas.map((a) => normalizar(a.textContent))).toEqual([
        "Visão",
        "Extrato",
        "Pagar e receber",
        "Caixa",
        "Resultado",
      ]);
      for (const aba of abas) {
        expect(aba.querySelector("svg"), aba.textContent ?? "").toBeNull();
        expect(aba.classList.contains("min-h-11")).toBe(true);
        expect(aba.className).not.toMatch(/admin-gold|amber|yellow|#F9D65B/);
      }
      expect(lista.textContent).not.toContain("Avançado");
      // Faixa sticky, e a ativa é a Visão.
      expect(lista.parentElement?.classList.contains("sticky")).toBe(true);
      expect(abas[0].getAttribute("data-state")).toBe("active");
    });

    it("período em chip compacto (abre a mesma folha); nas abas sem período vira só uma linha de texto", async () => {
      await montar();
      const chip = hospedeiro.querySelector<HTMLButtonElement>(
        'button[aria-label^="Período: "]',
      )!;
      expect(chip).not.toBeNull();
      expect([...chip.classList]).toEqual(
        expect.arrayContaining(["rounded-full", "w-fit", "min-h-11"]),
      );
      // Não é mais o cartão grande com ícone colorido.
      expect(chip.classList.contains("bg-admin-raised")).toBe(true);
      expect(chip.querySelector("svg.text-blue-300")).toBeNull();
      await act(async () => {
        chip.click();
      });
      expect(
        document.querySelector('[data-slot="sheet-content"]')?.textContent,
      ).toContain("Mês atual");

      // Abas sem período: uma linha fina, sem cartão e sem ícone.
      await act(async () => {
        document.querySelector<HTMLElement>('[aria-label="Fechar"]')?.click();
      });
      await abrirAba("Pagar e receber");
      const linha = [...hospedeiro.querySelectorAll("p")].find(
        (p) => normalizar(p.textContent) === "Todos os vencimentos",
      )!;
      expect(linha).toBeDefined();
      expect(linha.querySelector("svg")).toBeNull();
      expect(linha.classList.contains("bg-admin-raised")).toBe(false);
      expect(
        hospedeiro.querySelector('button[aria-label^="Período: "]'),
      ).toBeNull();
      await abrirAba("Caixa");
      expect(hospedeiro.textContent).toContain("Sessão atual");
    });
  });

  describe("botão redondo Novo lançamento", () => {
    it("aparece fora da aba Caixa, some na Caixa, com a folha aberta e com a tela inativa", async () => {
      await montar();
      const fab = () =>
        hospedeiro.querySelector<HTMLElement>('[aria-label="Novo lançamento"]');
      expect(fab()).not.toBeNull();
      for (const aba of ["Extrato", "Pagar e receber", "Resultado"]) {
        await abrirAba(aba);
        expect(fab(), aba).not.toBeNull();
      }
      await abrirAba("Caixa");
      // Na Caixa a aba renderiza o botão dela (na pílula): nunca o redondo.
      expect(fab()?.classList.contains("fixed") ?? false).toBe(false);

      await abrirAba("Visão");
      await act(async () => {
        fab()!.click();
      });
      await esperar();
      // Folha aberta: o botão some (não dá para abrir outra por cima).
      expect(fab()).toBeNull();
      expect(
        document.querySelector('[data-slot="sheet-content"]'),
      ).not.toBeNull();
    });

    it("tela mantida em memória (inativa) não deixa o botão flutuando", async () => {
      await montar(false);
      expect(
        hospedeiro.querySelector('[aria-label="Novo lançamento"]'),
      ).toBeNull();
    });
  });

  describe("Visão", () => {
    const resumoComResultado = (resultado: number, extra = {}) => ({
      ...RESUMO_BASE,
      resultado,
      ...extra,
    });

    it("cartão do saldo: rótulo, valor grande neutro, subtexto e etiqueta com o resultado (verde, com seta)", async () => {
      await montar();
      const saldo = secao("Saldo total");
      expect(normalizar(saldo.textContent)).toContain("Saldo total · hoje");
      expect(normalizar(saldo.textContent)).toContain("R$ 453,88");
      expect(normalizar(saldo.textContent)).toContain(
        "Soma de todas as contas da loja, hoje",
      );
      const valor = saldo.querySelector(".tabular-nums")!;
      expect(valor.className).toContain("text-white");
      expect(valor.className).not.toContain("emerald");
      expect(valor.className).toMatch(/text-\[clamp\(/);

      const etiqueta = saldo.querySelector<HTMLElement>(
        "[data-resultado-do-periodo]",
      )!;
      expect(etiqueta.getAttribute("data-resultado-do-periodo")).toBe(
        "positivo",
      );
      expect(normalizar(etiqueta.textContent)).toBe("+R$ 453,88 no período");
      expect([...etiqueta.classList]).toEqual(
        expect.arrayContaining(["text-emerald-400", "bg-emerald-400/10"]),
      );
      expect(etiqueta.querySelector("svg")).not.toBeNull();
    });

    it("etiqueta do resultado por sinal: negativo vermelho com −, zero cinza sem sinal", async () => {
      resumoAtual = resumoComResultado(-120.5, {
        entradas: 0,
        saidas: 120.5,
        saldo_total: -50,
      });
      await montar();
      let etiqueta = secao("Saldo total").querySelector<HTMLElement>(
        "[data-resultado-do-periodo]",
      )!;
      expect(etiqueta.getAttribute("data-resultado-do-periodo")).toBe(
        "negativo",
      );
      expect(normalizar(etiqueta.textContent)).toBe("−R$ 120,50 no período");
      expect([...etiqueta.classList]).toEqual(
        expect.arrayContaining(["text-red-400", "bg-red-400/10"]),
      );
      // Saldo NEGATIVO é o único caso em que o valor grande leva cor (vermelho).
      expect(
        secao("Saldo total").querySelector(".tabular-nums")!.className,
      ).toContain("text-red-400");

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      resumoAtual = resumoComResultado(0, { entradas: 0, saidas: 0 });
      await montar();
      etiqueta = secao("Saldo total").querySelector<HTMLElement>(
        "[data-resultado-do-periodo]",
      )!;
      expect(etiqueta.getAttribute("data-resultado-do-periodo")).toBe("neutro");
      expect(normalizar(etiqueta.textContent)).toBe("R$ 0,00 no período");
      expect(etiqueta.classList.contains("text-zinc-400")).toBe(true);
      expect(etiqueta.className).not.toMatch(/emerald|red-/);
    });

    it("Entradas | Saídas: entrada verde com +, saída vermelha só se > 0 (zero fica cinza, sem sinal)", async () => {
      await montar();
      const dd = (rotulo: string) =>
        [...hospedeiro.querySelectorAll("dt")].find(
          (el) => normalizar(el.textContent) === rotulo,
        )!.nextElementSibling!;
      expect(normalizar(dd("Entradas").textContent)).toBe("+R$ 453,88");
      expect(dd("Entradas").querySelector(".text-emerald-400")).not.toBeNull();
      expect(normalizar(dd("Saídas").textContent)).toBe("R$ 0,00");
      expect(dd("Saídas").querySelector(".text-red-400")).toBeNull();
      expect(dd("Saídas").querySelector(".text-zinc-300")).not.toBeNull();

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      resumoAtual = { ...RESUMO_BASE, entradas: 0, saidas: 1200 };
      await montar();
      expect(normalizar(dd("Entradas").textContent)).toBe("R$ 0,00");
      expect(dd("Entradas").querySelector(".text-emerald-400")).toBeNull();
      expect(normalizar(dd("Saídas").textContent)).toBe("−R$ 1.200,00");
      expect(dd("Saídas").querySelector(".text-red-400")).not.toBeNull();
    });

    it("A pagar | A receber: vencido em etiqueta vermelha, 'Nada vencido' no zero, próximos 7 dias sempre à vista e toque leva ao lado certo", async () => {
      resumoAtual = {
        ...RESUMO_BASE,
        a_pagar: { total: 700, vencido: 0, proximos_7_dias: 200 },
        a_receber: { total: 900, vencido: 100, proximos_7_dias: 300 },
      };
      await montar();
      const pagar = secao("A pagar");
      const receber = secao("A receber");
      expect(normalizar(pagar.textContent)).toContain("Nada vencido");
      expect(pagar.querySelector("[data-vencido]")).toBeNull();
      expect(normalizar(pagar.textContent)).toContain(
        "Próximos 7 dias R$ 200,00",
      );
      expect(normalizar(receber.textContent)).toContain(
        "Próximos 7 dias R$ 300,00",
      );
      expect(
        normalizar(receber.querySelector("[data-vencido]")?.textContent),
      ).toBe("Vencido R$ 100,00");
      expect(receber.textContent).not.toContain("Nada vencido");
      // Alvo de toque ≥ 44px: o cartão inteiro é o botão.
      expect(pagar.querySelector("button")!.className).toContain(
        "min-h-[7.5rem]",
      );

      // Toque em A receber → aba Pagar e receber já no lado "A receber".
      await act(async () => {
        receber.querySelector<HTMLButtonElement>("button")!.click();
      });
      await esperar();
      expect(
        hospedeiro.querySelector('[role="tab"][data-state="active"]')
          ?.textContent,
      ).toBe("Pagar e receber");
      const lado = [
        ...hospedeiro.querySelectorAll<HTMLButtonElement>(
          "button[aria-pressed]",
        ),
      ].find((b) => normalizar(b.textContent) === "A receber")!;
      expect(lado.getAttribute("aria-pressed")).toBe("true");
    });

    it("A pagar | A receber: toque chama verPrevistos com o lado certo (saída / entrada)", async () => {
      const verPrevistos = vi.fn();
      await act(async () => {
        raiz.render(
          <AbaVisao
            ativo
            intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
            hoje="2026-10-23"
            versao={0}
            contas={[]}
            irParaAba={vi.fn()}
            verPrevistos={verPrevistos}
          />,
        );
      });
      await esperar();
      await act(async () => {
        secao("A pagar").querySelector("button")!.click();
      });
      await act(async () => {
        secao("A receber").querySelector("button")!.click();
      });
      expect(verPrevistos.mock.calls).toEqual([["saida"], ["entrada"]]);
    });

    it("faixa do Caixa: fechado → ponto cinza + 'Abrir caixa'; aberto → ponto verde, hora, troco e 'Ver o caixa'; os dois levam à aba Caixa", async () => {
      await montar();
      let faixa = secao("Caixa");
      expect(faixa.getAttribute("data-faixa-do-caixa")).toBe("fechado");
      expect(normalizar(faixa.textContent)).toContain("Caixa fechado");
      expect(faixa.querySelector(".bg-zinc-400")).not.toBeNull();
      const abrir = faixa.querySelector("button")!;
      expect(normalizar(abrir.textContent)).toBe("Abrir caixa");
      // Segundo "Abrir o caixa" (duplicado) e atalho "Ver saldos…" saíram.
      expect(hospedeiro.textContent).not.toContain("Abrir o caixa");
      expect(hospedeiro.textContent).not.toContain(
        "Ver saldos e análises da Visão",
      );
      expect(hospedeiro.querySelector("#fin-saldos-e-analises")).toBeNull();

      await act(async () => {
        abrir.click();
      });
      await esperar();
      expect(
        hospedeiro.querySelector('[role="tab"][data-state="active"]')
          ?.textContent,
      ).toBe("Caixa");

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      resumoAtual = {
        ...RESUMO_BASE,
        caixa_aberto: {
          id: "s1",
          conta_id: "c1",
          aberto_em: "2026-10-23T12:30:00Z",
          valor_abertura: 150,
        },
      };
      await montar();
      faixa = secao("Caixa");
      expect(faixa.getAttribute("data-faixa-do-caixa")).toBe("aberto");
      expect(normalizar(faixa.textContent)).toContain("Caixa aberto desde");
      expect(normalizar(faixa.textContent)).toContain("com R$ 150,00 de troco");
      expect(faixa.querySelector(".bg-emerald-400")).not.toBeNull();
      expect(normalizar(faixa.querySelector("button")!.textContent)).toBe(
        "Ver o caixa",
      );
      // Botão pequeno claro: neutro de alto contraste, alvo de 44px.
      expect([...faixa.querySelector("button")!.classList]).toEqual(
        expect.arrayContaining([
          "bg-foreground",
          "text-background",
          "min-h-11",
        ]),
      );
    });

    it("saldo por conta: lista compacta nome ↔ valor; sem contas, só o estado vazio com o botão que leva a Contas", async () => {
      await montar();
      const lista = hospedeiro.querySelector(
        'ul[aria-label="Saldo por conta"]',
      )!;
      // Cada linha: nome à esquerda, valor à direita (e o tipo só para leitor de tela).
      expect(
        [...lista.querySelectorAll("li")].map((li) => [
          normalizar(li.children[0].textContent),
          normalizar(li.children[1].textContent),
        ]),
      ).toEqual([
        ["Caixa da loja", "R$ 34,90"],
        ["Conta bancária", "R$ 313,90"],
        ["Mercado Pago", "R$ 105,08"],
      ]);

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      resumoAtual = { ...RESUMO_BASE, contas: [], saldo_total: 0 };
      await montar();
      expect(
        hospedeiro.querySelector('ul[aria-label="Saldo por conta"]'),
      ).toBeNull();
      // "Nenhuma conta ainda" aparece UMA vez (antes aparecia duas).
      expect(
        (hospedeiro.textContent ?? "").match(/Nenhuma conta ainda/g),
      ).toHaveLength(1);
      await act(async () => {
        botao("Contas e categorias")!.click();
      });
      await esperar();
      expect(botao("Contas")?.getAttribute("aria-pressed")).toBe("true");
    });

    it("App × loja: UMA barra dividida com legenda (valor · %) e cores de ponto iguais às do trecho", async () => {
      await montar();
      const cartao = secao("App × loja física");
      const trechos = cartao.querySelectorAll<HTMLElement>(
        "[data-trecho-do-canal]",
      );
      expect(trechos).toHaveLength(2);
      const legenda = cartao.querySelector("[data-canais-lado-a-lado]")!;
      expect(legenda.children).toHaveLength(2);
      const [app, loja] = [...legenda.children];
      expect(normalizar(app.querySelector("dt")?.textContent)).toBe("App");
      expect(normalizar(app.querySelector("dd")?.textContent)).toBe(
        "R$ 418,98 · 92,3%",
      );
      expect(normalizar(loja.querySelector("dt")?.textContent)).toBe(
        "Loja física",
      );
      expect(normalizar(loja.querySelector("dd")?.textContent)).toBe(
        "R$ 34,90 · 7,7%",
      );
      const pontos = [
        ...legenda.querySelectorAll<HTMLElement>("[data-ponto-do-canal]"),
      ];
      expect(pontos.map((p) => p.style.background)).toEqual(
        [...trechos].map((t) => t.style.background),
      );
    });

    it("blocos novos na ordem do desenho e o rodapé explicativo no fim", async () => {
      await montar();
      const ordem = [
        secao("Saldo total"),
        secao("Movimentos do período"),
        secao("A pagar"),
        secao("A receber"),
        secao("Caixa"),
        secao("Saldo por conta"),
        secao("Fluxo de caixa · últimos 30 dias"),
        secao("Recebimentos por forma"),
        secao("App × loja física"),
      ];
      // Cada bloco existe e vem antes do seguinte (pares vizinhos).
      for (const [bloco, proximo] of ordem
        .slice(0, -1)
        .map((b, i) => [b, ordem.slice(1).at(i)!] as const)) {
        expect(bloco).not.toBeNull();
        expect(
          bloco.compareDocumentPosition(proximo) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          bloco.getAttribute("aria-label") ?? "",
        ).toBeTruthy();
      }
      const rodape = [...hospedeiro.querySelectorAll("p")].at(-1)!;
      expect(normalizar(rodape.textContent)).toBe(
        "Vendas entram no dia em que o pagamento foi recebido (horário de Brasília).",
      );
    });

    it("carregando: esqueleto sem salto de layout; erro na 1ª busca: 'Tentar de novo' refaz a consulta", async () => {
      rpcFalso.mockImplementation(() => new Promise(() => {}));
      await montar();
      const carregando = hospedeiro.querySelector('[aria-busy="true"]');
      expect(carregando).not.toBeNull();
      expect(carregando?.textContent).toContain("Carregando");
      expect(
        hospedeiro.querySelector('section[aria-label="Saldo total"]'),
      ).toBeNull();

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      rpcFalso.mockImplementation(async (nome: string) =>
        nome === "fin_resumo"
          ? { data: null, error: { message: "Failed to fetch" } }
          : { data: [], error: null },
      );
      await montar();
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
      const antes = rpcFalso.mock.calls.filter(
        ([n]) => n === "fin_resumo",
      ).length;
      rpcFalso.mockImplementation(async (nome: string) => ({
        data: nome === "fin_resumo" ? RESUMO_BASE : [],
        error: null,
      }));
      await act(async () => {
        botao(/Tentar de novo/)!.click();
      });
      await esperar();
      expect(
        rpcFalso.mock.calls.filter(([n]) => n === "fin_resumo").length,
      ).toBeGreaterThan(antes);
      expect(secao("Saldo total")).not.toBeNull();
    });
  });
});
