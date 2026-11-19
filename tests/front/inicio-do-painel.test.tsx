// @vitest-environment jsdom
//
// Início do painel (rota `admin-dashboard`, 26/09/2026): o perfil da loja,
// o "Hoje", os quatro números do mês, o "Para fazer", a assinatura e os
// dois botões grandes (Dashboard CRM e Financeiro). Monta a tela de verdade
// com o Supabase dublado e prova:
//   - as duas RPCs do contrato (`painel_inicio` e `assinatura_da_loja_ler`)
//     são chamadas e os 4 KPIs do mês aparecem com os valores do banco;
//   - sem linha de assinatura, o card diz que o plano vai aparecer ali;
//   - os botões grandes e o "Para fazer" levam às telas certas;
//   - o tempo real escuta `marketplace_orders` e é desligado ao desmontar.
import { existsSync, readFileSync } from "node:fs";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  respostas: new Map<string, { data: unknown; error: unknown }>(),
  rpc: vi.fn(),
  canais: [] as { nome: string; tabelas: string[] }[],
  removidos: [] as string[],
  lojaCarregada: true,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      return Promise.resolve(
        h.respostas.get(nome) ?? { data: null, error: null },
      );
    },
    channel: (nome: string) => {
      const registro = { nome, tabelas: [] as string[] };
      h.canais.push(registro);
      const canal = {
        nome,
        on: (_evento: string, opcoes: { table?: string }) => {
          if (opcoes.table) registro.tabelas.push(opcoes.table);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: (canal: { nome: string }) => {
      h.removidos.push(canal.nome);
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "adm-1" } },
    profile: { full_name: "Gabriel Dono" },
    isAdmin: true,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja do Gabriel",
      storeCity: "Manaus",
      storeState: "AM",
      // Logo larga cadastrada (como a da Savy): o cartão tem de preferir o
      // ícone do app mesmo assim — o teste do ícone trava essa prioridade.
      logoUrl: "https://exemplo.test/logo-larga.png",
      originCep: "69000-000",
    },
    isLoaded: h.lojaCarregada,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAINEL = {
  hoje: {
    receita: 350,
    online: 200,
    presencial: 150,
    pedidos: 4,
    receita_semana_passada: 280,
  },
  mes: {
    receita: 12345.67,
    receita_mes_anterior: 10000,
    pedidos: 80,
    ticket_medio: 154.32,
    lucro_estimado: 4321.09,
  },
  saldo_total: 8765.43,
  a_receber_7d: 1200.5,
  a_pagar_7d: 300,
  contas_vencidas: 2,
  pendencias: {
    pedidos_para_preparar: 5,
    devolucoes_abertas: 1,
    caixa_aberto: false,
    estoque_baixo: 3,
  },
  serie_14d: [
    { dia: "2026-09-25", receita: 120 },
    { dia: "2026-09-26", receita: 350 },
  ],
};

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: não aconteceu em ${timeoutMs}ms — corpo: ${texto(document.body).slice(0, 400)}`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function botaoPorTexto(raiz: HTMLElement, alvo: string) {
  const botao = Array.from(raiz.querySelectorAll("button")).find((b) =>
    texto(b).includes(alvo),
  );
  if (!botao) throw new Error(`botão "${alvo}" não encontrado`);
  return botao;
}

describe("Início do painel", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onNavigate = vi.fn();

  beforeEach(() => {
    // O cache do Início é de módulo: cada teste começa com um módulo novo.
    vi.resetModules();
    h.respostas.clear();
    h.rpc.mockClear();
    h.canais.length = 0;
    h.removidos.length = 0;
    onNavigate.mockClear();
    h.lojaCarregada = true;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.head
      .querySelectorAll("[data-inicio-teste]")
      .forEach((no) => no.remove());
  });

  async function montar() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={onNavigate} />);
    });
    await esperarAte(() => h.rpc.mock.calls.length >= 2);
  }

  it("prejuízo mensal não pinta de vermelho as vendas do último dia", async () => {
    h.respostas.set("painel_inicio", {
      data: { ...PAINEL, mes: { ...PAINEL.mes, lucro_estimado: -1250 } },
      error: null,
    });
    await montar();
    await esperarAte(
      () =>
        hospedeiro.querySelectorAll('[data-testid="serie-14d-barra"]').length >
        0,
    );
    const barras = hospedeiro.querySelectorAll(
      '[data-testid="serie-14d-barra"]',
    );
    expect(barras[barras.length - 1].className).toContain("bg-emerald-400");
    expect(hospedeiro.querySelector("p.text-red-400")?.textContent).toContain(
      "1.250",
    );
  });

  it("chama as duas RPCs do contrato e mostra os 4 números do mês", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("R$ 12.345,67"));

    expect(h.rpc.mock.calls.map(([nome]) => nome).sort()).toEqual([
      "assinatura_da_loja_ler",
      "painel_inicio",
    ]);

    const pagina = texto(hospedeiro);
    for (const rotulo of [
      "Vendas pagas no mês",
      "Lucro estimado",
      "Saldo em contas",
      "A receber",
    ]) {
      expect(pagina).toContain(rotulo);
    }
    expect(pagina).toContain("R$ 4.321,09");
    expect(pagina).toContain("R$ 8.765,43");
    expect(pagina).toContain("R$ 1.200,50");
    const receber = hospedeiro.querySelector('[aria-label^="A receber —"]');
    expect(texto(receber)).toContain("Vencidas + próximos 7 dias");
    // Hoje: receita, divisão app × balcão e a variação vs. semana passada.
    expect(pagina).toContain("R$ 350,00");
    expect(pagina).toContain("App");
    expect(pagina).toContain("Balcão");
    // Variação em palavras, com a janela honesta (o banco compara o mesmo dia
    // da semana passada, não "ontem"): 350 / 280 = +25%.
    expect(pagina).toContain(
      "25% a mais que no mesmo dia da semana passada, até esta hora",
    );
    // Receita do mês +23,5% sobre os mesmos dias do mês anterior (12345,67 / 10000).
    expect(pagina).toContain(
      "23,5% a mais que nos mesmos dias do mês anterior",
    );
    // Identidade da loja vinda do config e do perfil.
    expect(pagina).toContain("Loja do Gabriel");
    expect(pagina).toContain("Manaus / AM");
    expect(pagina).toContain("Gabriel Dono");
  });

  it("sem linha de assinatura, o card diz que o plano vai aparecer ali", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    h.respostas.set("assinatura_da_loja_ler", { data: null, error: null });
    await montar();
    await esperarAte(() =>
      texto(hospedeiro).includes("Seu plano vai aparecer aqui"),
    );
    expect(hospedeiro.querySelector('a[href^="https://cobranca"]')).toBeNull();
  });

  it("com assinatura, mostra plano, status com texto e o link de gerenciar em nova aba", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    h.respostas.set("assinatura_da_loja_ler", {
      data: {
        plano: "Loja Pro",
        status: "atrasada",
        valor_mensal: 99.9,
        ciclo: "mensal",
        proxima_cobranca_em: "2026-10-01",
        recursos: ["PDV", "CRM"],
        gerenciar_url: "https://cobranca.exemplo.com/loja",
        suporte_whatsapp: "11987654321",
      },
      error: null,
    });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("Loja Pro"));

    const pagina = texto(hospedeiro);
    expect(pagina).toContain("Atrasada");
    expect(pagina).toContain("R$ 99,90/mês");
    // Atrasada: a data é a da mensalidade mais antiga em aberto.
    expect(pagina).toContain("Em aberto desde");
    expect(pagina).toContain("01/10/2026");
    const gerenciar = hospedeiro.querySelector(
      'a[href="https://cobranca.exemplo.com/loja"]',
    );
    expect(gerenciar?.getAttribute("target")).toBe("_blank");
    expect(gerenciar?.getAttribute("rel")).toContain("noopener");
    expect(
      hospedeiro.querySelector('a[href="https://wa.me/5511987654321"]'),
    ).not.toBeNull();
  });

  it("os botões grandes levam aos Relatórios e ao Financeiro", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();

    await act(async () => {
      botaoPorTexto(hospedeiro, "Relatórios").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-crm");

    await act(async () => {
      botaoPorTexto(hospedeiro, "Caixa e contas").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-financeiro");
    // "Vender" saiu do Início (27/09/2026): já vive na barra de baixo — ver
    // atalhos-do-inicio-so-dois-botoes-grandes.test.tsx.
  });

  it("o 'Para fazer' mostra as contagens e cada linha abre a tela que resolve", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("pendências"));

    // Lote 224: "contas vencidas" abre direto em "Pagar e receber" (2º argumento).
    const destinos: [string, ...string[]][] = [
      ["Ver pedidos em aberto", "admin-orders"],
      ["1 devolução aberta", "admin-devolucoes"],
      ["2 contas vencidas", "admin-financeiro", "previstos"],
      ["3 produtos com estoque baixo", "admin-products", "estoque-baixo"],
    ];
    for (const [rotulo, ...destino] of destinos) {
      await act(async () => {
        botaoPorTexto(hospedeiro, rotulo).click();
      });
      expect(onNavigate.mock.lastCall).toEqual(destino);
    }
    // A contagem dos pedidos mora na linha âmbar acima do botão do destaque.
    expect(texto(hospedeiro)).toContain("5 pedidos esperando para preparar");
    // 3 pendências na lista: devolução, vencidas, estoque. Os pedidos para
    // preparar ficam no cartão de cima e não entram nesta contagem.
    expect(texto(hospedeiro)).toContain("3 pendências");
  });

  it("caixa fechado não promete exigência: o balcão vende sem abrir o caixa", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("pendências"));
    const emDia = botaoPorTexto(hospedeiro, "Caixa fechado");
    expect(emDia.textContent).not.toContain("vender no balcão");
    expect(emDia.textContent).toContain(
      "Abra para conferir o dinheiro da gaveta · Financeiro",
    );
  });

  it("o destaque é um botão branco (sem dourado) e as linhas têm tile neutro com o glifo na cor", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("pendências"));
    const preparar = botaoPorTexto(hospedeiro, "Ver pedidos em aberto");
    for (const classe of ["rounded-2xl", "min-h-14", "bg-white"]) {
      expect(preparar.classList.contains(classe)).toBe(true);
    }
    expect(preparar.className).not.toMatch(/gold|yellow|amber/);
    expect(preparar.querySelector("svg.lucide-package")).not.toBeNull();

    const paraFazer = hospedeiro.querySelector<HTMLElement>(
      '[aria-labelledby="inicio-para-fazer-titulo"]',
    );
    expect(paraFazer).not.toBeNull();
    const vencida = botaoPorTexto(paraFazer!, "2 contas vencidas");
    const emDia = botaoPorTexto(paraFazer!, "Caixa fechado");
    for (const classe of ["rounded-2xl", "min-h-11", "text-left"]) {
      expect(emDia.classList.contains(classe)).toBe(true);
    }
    // Vencida = vermelho: a contagem à direita e o subtítulo.
    expect(vencida.querySelectorAll("span.text-red-400")).toHaveLength(2);
    // O tile é neutro (nunca pintado); só o glifo carrega a cor.
    const selo = emDia.querySelector("span.size-10");
    expect(selo).not.toBeNull();
    expect(selo?.className).toContain("bg-admin-raised");
    expect(selo?.className).not.toMatch(/bg-(teal|sky|blue|orange|amber|red)/);
    const glifo = selo?.querySelector("svg.lucide-wallet");
    expect(glifo).not.toBeNull();
    expect(glifo?.getAttribute("class")).toContain("text-zinc-400");
    // O glifo da vencida é vermelho; o do estoque, âmbar.
    expect(
      vencida
        .querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")
        ?.getAttribute("class"),
    ).toContain("text-red-400");
    expect(
      botaoPorTexto(paraFazer!, "3 produtos com estoque baixo")
        .querySelector("svg.lucide-package")
        ?.getAttribute("class"),
    ).toContain("text-amber-400");
    expect(
      emDia.querySelector("svg.lucide-chevron-right.size-5"),
    ).not.toBeNull();
    expect(emDia.className).not.toContain("rounded-xl");
    // O preparo está no destaque do dia: o "Para fazer" não o repete.
    expect(paraFazer?.textContent).not.toContain("pedidos para preparar");
  });

  it("preserva a ordem móvel e as três pilhas originais", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    const ids = Array.from(
      hospedeiro.querySelectorAll(
        'section[aria-labelledby^="inicio-"], [role="group"][aria-label="Atalhos do painel"]',
      ),
    ).map((secao) => secao.getAttribute("aria-labelledby") ?? "atalhos");
    expect(ids).toEqual([
      "inicio-hoje-titulo",
      "inicio-para-fazer-titulo",
      "atalhos",
      "inicio-mes-titulo",
      "inicio-serie-titulo",
      "inicio-contas-titulo",
      "inicio-sua-loja-titulo",
      "inicio-assinatura-titulo",
      "inicio-checklist-titulo",
    ]);
    expect(hospedeiro.querySelector(".inicio-colunas")?.children).toHaveLength(
      3,
    );
  });

  // jsdom não resolve @media nem geometria: aplica só as regras de desktop
  // do CSS REAL à árvore REAL. Isto prova a fiação da grade, não pixels.
  function aplicarCssDoInicio(largura: number) {
    const css = existsSync("src/components/admin/inicio/inicio-desktop.css")
      ? readFileSync("src/components/admin/inicio/inicio-desktop.css", "utf8")
      : "";
    const folha = postcss.parse(css);
    const estilo = document.createElement("style");
    estilo.dataset.inicioTeste = "true";
    // Utilitários de base que jsdom não recebe do Tailwind. Vêm DEPOIS do
    // CSS real, para exigir especificidade suficiente, sem depender da ordem.
    const base = `
      .whitespace-nowrap { white-space: nowrap; }
      .space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 24px; }
      .space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 16px; }
    `;
    estilo.textContent =
      folha.nodes
        .map((no) => {
          if (no.type === "rule") return no.toString();
          if (no.type !== "atrule" || no.name !== "media") return "";
          expect(no.params).toBe("(width >= 1280px)");
          return largura >= 1280 ? no.nodes?.map(String).join("\n") : "";
        })
        .join("\n") + base;
    document.head
      .querySelectorAll("[data-inicio-teste]")
      .forEach((no) => no.remove());
    document.head.appendChild(estilo);
    return estilo;
  }

  it("zera o espaço das pilhas ao compor a grade, mesmo com Tailwind depois", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    for (const largura of [1280, 1440, 1920]) {
      const estilo = aplicarCssDoInicio(largura);
      for (const seletor of [
        ".inicio-tarefas",
        ".inicio-resultados",
        ".inicio-sua-loja",
      ]) {
        const elemento = hospedeiro.querySelector<HTMLElement>(seletor)!;
        expect(getComputedStyle(elemento).marginTop, seletor).toBe("0px");
      }
      estilo.remove();
    }
    const estilo = aplicarCssDoInicio(390);
    expect(
      getComputedStyle(hospedeiro.querySelector(".inicio-tarefas")!).marginTop,
    ).toBe("24px");
    estilo.remove();
  });

  it("alinha o gráfico no topo e conserva as margens internas do resumo mensal", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    for (const largura of [1280, 1440, 1920]) {
      const estilo = aplicarCssDoInicio(largura);
      expect(
        getComputedStyle(hospedeiro.querySelector(".inicio-serie")!).marginTop,
      ).toBe("0px");
      for (const seletor of [".inicio-mes-volume", ".inicio-mes-explicacao"]) {
        expect(
          getComputedStyle(hospedeiro.querySelector(seletor)!).marginTop,
          seletor,
        ).toBe("20px");
      }
      expect(
        getComputedStyle(hospedeiro.querySelector(".inicio-mes-explicacao")!)
          .marginBottom,
      ).toBe("20px");
      estilo.remove();
    }
    const estilo = aplicarCssDoInicio(390);
    expect(
      getComputedStyle(hospedeiro.querySelector(".inicio-serie")!).marginTop,
    ).toBe("16px");
    estilo.remove();
  });

  it("compõe operação primeiro e série 2/3 + resumo 1/3 só no desktop, sem perder as pontes", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    const pagina = hospedeiro.firstElementChild as HTMLElement;
    const porTitulo = (id: string) =>
      hospedeiro.querySelector<HTMLElement>(`[aria-labelledby="${id}"]`)!;
    const hoje = porTitulo("inicio-hoje-titulo");
    const tarefas = porTitulo("inicio-para-fazer-titulo");
    const contas = porTitulo("inicio-contas-titulo");
    const mes = porTitulo("inicio-mes-titulo");
    const serie = porTitulo("inicio-serie-titulo");
    const loja = porTitulo("inicio-sua-loja-titulo");
    const atalhos = hospedeiro.querySelector<HTMLElement>(
      '[aria-label="Atalhos do painel"]',
    )!;

    let estilo = aplicarCssDoInicio(1279);
    expect(getComputedStyle(pagina).display).not.toBe("grid");
    estilo.remove();
    for (const largura of [1280, 1440, 1920]) {
      estilo = aplicarCssDoInicio(largura);
      expect(estilo.textContent).toContain(".inicio-desktop");
      expect(pagina.classList.contains("inicio-desktop")).toBe(true);
      expect(getComputedStyle(pagina).display).toBe("grid");
      expect(getComputedStyle(pagina).gridTemplateColumns).toBe(
        "repeat(6, minmax(0, 1fr))",
      );
      for (const [secao, coluna] of [
        [hoje, "1 / 3"],
        [tarefas, "3 / 5"],
        [contas, "5 / 7"],
      ] as const) {
        const vaga = secao.parentElement!;
        expect(getComputedStyle(vaga).gridColumn).toBe(coluna);
        expect(getComputedStyle(vaga).order).toBe("2");
        // Não basta ter uma classe: cada ponte até a grade precisa se achatar.
        let ponte = vaga.parentElement!;
        while (ponte !== pagina) {
          expect(getComputedStyle(ponte).display).toBe("contents");
          ponte = ponte.parentElement!;
        }
      }
      expect(getComputedStyle(atalhos).gridColumn).toBe("3 / 6");
      expect(getComputedStyle(atalhos).order).toBe("0");
      expect(getComputedStyle(atalhos).gridRow).toBe("1");
      expect(
        getComputedStyle(hospedeiro.querySelector(".inicio-titulo")!).gridRow,
      ).toBe("1");
      expect(
        getComputedStyle(hospedeiro.querySelector(".inicio-estado")!).gridRow,
      ).toBe("1");
      expect(getComputedStyle(atalhos).position).toBe("static");
      expect(getComputedStyle(atalhos).backgroundColor).toBe(
        "rgba(0, 0, 0, 0)",
      );
      expect(getComputedStyle(mes.parentElement!).order).toBe("3");
      expect(getComputedStyle(serie.parentElement!).gridColumn).toBe("1 / 5");
      expect(getComputedStyle(mes.firstElementChild!).gridColumn).toBe("5 / 7");
      expect(getComputedStyle(loja).order).toBe("4");
      expect(getComputedStyle(loja).gridColumn).toBe("1 / -1");
      expect(getComputedStyle(loja.lastElementChild!).display).toBe("grid");
      estilo.remove();
    }
  });

  it("boas-vindas que retorna null não reserva faixa nem respiro antes de Hoje", async () => {
    h.lojaCarregada = false;
    h.respostas.set("painel_inicio", {
      data: {
        ...PAINEL,
        hoje: { ...PAINEL.hoje, pedidos: 0 },
        mes: { ...PAINEL.mes, pedidos: 0, receita_mes_anterior: 0 },
        pendencias: { ...PAINEL.pendencias, pedidos_para_preparar: 0 },
        serie_14d: [],
      },
      error: null,
    });
    await montar();
    const boasVindas = hospedeiro.querySelector<HTMLElement>(
      ".inicio-boas-vindas",
    )!;
    const hoje = hospedeiro.querySelector<HTMLElement>(".inicio-hoje")!;
    // O componente real está conferindo o cadastro e devolve null.
    expect(boasVindas).not.toBeNull();
    expect(boasVindas.childNodes).toHaveLength(0);
    expect(boasVindas.nextElementSibling).toBe(hoje);
    for (const largura of [390, 1279, 1280, 1920]) {
      const estilo = aplicarCssDoInicio(largura);
      expect(getComputedStyle(boasVindas).display).toBe("none");
      expect(getComputedStyle(hoje).marginTop).toBe("0px");
      estilo.remove();
    }
  });

  it("moedas grandes do mês podem quebrar por inteiro só no desktop", async () => {
    h.respostas.set("painel_inicio", {
      data: {
        ...PAINEL,
        mes: {
          ...PAINEL.mes,
          receita: 999999999.99,
          lucro_estimado: -999999999.99,
        },
      },
      error: null,
    });
    await montar();
    const vendas = hospedeiro.querySelector<HTMLElement>(
      ".inicio-mes-vendas > p.whitespace-nowrap",
    )!;
    const lucro = hospedeiro.querySelector<HTMLElement>(
      ".inicio-mes-lucro > p.whitespace-nowrap",
    )!;
    expect(texto(vendas)).toBe("R$ 999.999.999,99");
    expect(texto(lucro)).toBe("-R$ 999.999.999,99");
    for (const largura of [390, 1279, 1280, 1920]) {
      const estilo = aplicarCssDoInicio(largura);
      for (const valor of [vendas, lucro]) {
        expect(getComputedStyle(valor).whiteSpace).toBe(
          largura < 1280 ? "nowrap" : "normal",
        );
        if (largura >= 1280) {
          expect(getComputedStyle(valor).overflowWrap).toBe("anywhere");
        }
      }
      estilo.remove();
    }
  });

  it("mantém série, tabela, lucro e atalhos únicos ao mudar a largura", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    const serie = hospedeiro.querySelector<HTMLElement>(
      '[aria-labelledby="inicio-serie-titulo"]',
    )!;
    const anterior = serie.querySelector<HTMLButtonElement>(
      '[aria-label="Dia anterior"]',
    )!;
    act(() => anterior.click());
    act(() => botaoPorTexto(serie, "Ver os 14 dias em tabela").click());
    act(() => botaoPorTexto(hospedeiro, "Como é calculado o lucro").click());
    const tabela = serie.querySelector("table");
    const selecionado = serie.querySelector(
      '[aria-live="polite"]',
    )?.textContent;
    const explicacao = hospedeiro.querySelector(
      '[aria-expanded="true"][aria-controls]',
    )!;

    for (const largura of [390, 1280, 1920, 390]) {
      const estilo = aplicarCssDoInicio(largura);
      act(() => window.dispatchEvent(new Event("resize")));
      expect(
        hospedeiro.querySelectorAll('[aria-labelledby="inicio-serie-titulo"]'),
      ).toHaveLength(1);
      expect(
        hospedeiro.querySelector('[aria-labelledby="inicio-serie-titulo"]'),
      ).toBe(serie);
      expect(serie.querySelector("table")).toBe(tabela);
      expect(serie.querySelector('[aria-live="polite"]')?.textContent).toBe(
        selecionado,
      );
      expect(
        hospedeiro.querySelectorAll('[aria-label="Atalhos do painel"]'),
      ).toHaveLength(1);
      expect(
        hospedeiro.querySelectorAll('[aria-labelledby="inicio-mes-titulo"]'),
      ).toHaveLength(1);
      expect(hospedeiro.contains(explicacao)).toBe(true);
      const ids = [...hospedeiro.querySelectorAll("[id]")].map((no) => no.id);
      expect(new Set(ids).size).toBe(ids.length);
      estilo.remove();
    }
    expect(h.rpc.mock.calls.map(([nome]) => nome).sort()).toEqual([
      "assinatura_da_loja_ler",
      "painel_inicio",
    ]);
    const mes = hospedeiro.querySelector(
      '[aria-labelledby="inicio-mes-titulo"]',
    )!;
    expect(texto(mes)).toContain("R$ 4.321,09");
    expect(texto(mes)).toContain(
      "Desconta estornos, devoluções, custos e despesas, mesmo não pagas.",
    );
  });

  it("o cartão da loja mostra o ícone do app (quadrado), não a logo larga", async () => {
    // Pedido do dono (28/09): na Savy a logo-palavra "SAVY", transparente e
    // escura, sumia no quadrado escuro do cartão. O ícone do app (papel
    // `icon_192`, o mesmo do pin do mapa e da tela inicial do celular) vem
    // quadrado e com fundo próprio, por loja, da ficha que o porteiro escreve.
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    const { buildIdentity } = await import("@/config/buildIdentity");
    await montar();
    const imagem = hospedeiro.querySelector<HTMLImageElement>(
      'section[aria-labelledby="inicio-sua-loja-titulo"] img',
    );
    expect(imagem?.getAttribute("src")).toBe(buildIdentity.localUrls.icon_192);
    expect(imagem?.getAttribute("src")).not.toBe(
      "https://exemplo.test/logo-larga.png",
    );
  });

  it("sem vendas e com cadastro incompleto mostra o próximo passo como ação principal", async () => {
    h.respostas.set("painel_inicio", {
      data: {
        ...PAINEL,
        hoje: { ...PAINEL.hoje, pedidos: 0 },
        // Loja nova de verdade: sem pedidos, sem receita no mês passado e
        // sem receita nos últimos 14 dias (senão conta como loja que já vendeu).
        mes: { ...PAINEL.mes, pedidos: 0, receita_mes_anterior: 0 },
        pendencias: { ...PAINEL.pendencias, pedidos_para_preparar: 0 },
        serie_14d: [],
      },
      error: null,
    });
    await montar();
    await esperarAte(() =>
      texto(hospedeiro).includes("Próximo passo da sua loja"),
    );
    const boasVindas = hospedeiro.querySelector(
      'section[aria-label="Boas-vindas"]',
    );
    const proximo = boasVindas?.querySelector("button");
    expect(proximo).not.toBeNull();
    expect(proximo?.className).toContain("min-h-11");
    expect(proximo?.classList.contains("bg-white")).toBe(false);
    expect(texto(boasVindas)).toContain("Próximo passo");
    // Controle positivo: esconder o wrapper inteiro apagaria uma ação válida.
    for (const largura of [390, 1280]) {
      const estilo = aplicarCssDoInicio(largura);
      expect(getComputedStyle(boasVindas!.parentElement!).display).not.toBe(
        "none",
      );
      estilo.remove();
    }
    act(() => proximo?.click());
    expect(onNavigate).toHaveBeenLastCalledWith("admin-about-store");
    expect(texto(hospedeiro)).not.toContain("Preparar 0 pedidos");
  });

  it("função ainda não criada no banco vira aviso honesto, não número zero", async () => {
    h.respostas.set("painel_inicio", {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await montar();
    await esperarAte(() =>
      texto(hospedeiro).includes("ainda não foram ativados"),
    );
    expect(texto(hospedeiro)).not.toContain("R$ 0,00");
  });

  it("o tempo real escuta marketplace_orders e o canal é removido ao desmontar", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();

    const canal = h.canais.find((c) => c.nome === "admin-inicio-pedidos");
    expect(canal?.tabelas).toEqual(["marketplace_orders"]);

    act(() => raiz.unmount());
    expect(h.removidos).toContain("admin-inicio-pedidos");
    // afterEach desmonta de novo: uma raiz nova evita o erro de raiz morta.
    raiz = createRoot(hospedeiro);
  });

  it("tela inativa (atrás de outra aba) não chama o banco nem abre canal", async () => {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(
        <AdminDashboardView active={false} onNavigate={onNavigate} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.canais).toEqual([]);
  });
});
