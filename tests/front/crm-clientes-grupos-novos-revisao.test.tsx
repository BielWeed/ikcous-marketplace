// @vitest-environment jsdom
//
// Achados da revisão de risco do FRONT (27/09/2026, migration 20261183000000
// "o CRM vê todo mundo") sobre a aba Clientes:
//
// 1 (BLOQUEIA) RPC antiga (banco na 78): `crm_visao` nunca manda as 2 linhas
//   novas de `segmentos` — sem a guarda, a faixa "Ainda não compraram"
//   desenhava "Pediu e não pagou · 0" e "Cadastrado, nunca comprou · 0",
//   inventando um dado que a RPC nunca mediu ("não sei" virando zero, contra
//   a regra do topo de `lib/crm.ts`). A prova abaixo usa o payload EXATO da
//   78 (só segmentos RFM com >= 1 cliente) e afirma que a faixa NÃO aparece.
// 2 (BLOQUEIA) Mutante "voltar a `formatarMoeda(cliente.receita)` na célula
//   de dinheiro": como `receita` é sempre 0 para `pediu_nao_pagou`, esse
//   mutante mostraria "R$ 0,00" em vez do valor em aberto de verdade — a
//   prova de baixo reprova se isso acontecer.
// 4: o crachá de `nunca_comprou` usa o rótulo CURTO ("Nunca comprou"), não o
//   rótulo longo da grade ("Cadastrado, nunca comprou") — senão espreme o
//   nome no celular e trunca até no desktop.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerVisaoDoCrm } from "@/lib/crm";
import type { ClienteDoCrm } from "@/types/crm";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto (crm-contraste-aa.test.tsx).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja" } }),
}));

/** Só o essencial de `ClienteDoCrm` para os testes abaixo. */
function montarCliente(sobrepor: Partial<ClienteDoCrm>): ClienteDoCrm {
  return {
    chave: "c-1",
    userId: null,
    nome: "Bruna Ferreira",
    whatsapp: null,
    email: null,
    pedidos: 1,
    receita: 0,
    ticketMedio: null,
    primeiraCompra: null,
    ultimaCompra: null,
    diasSemComprar: null,
    r: null,
    f: null,
    m: null,
    segmento: null,
    canalPreferido: null,
    valorEmAberto: null,
    cadastradoEm: null,
    ...sobrepor,
  };
}

const h = vi.hoisted(() => ({
  lista: { total: 0, clientes: [] as ClienteDoCrm[] } as {
    total: number;
    clientes: ClienteDoCrm[];
  } | null,
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: () => ({
    lista: h.lista,
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
}));

function texto(el: Element | null) {
  return (el?.textContent ?? "").replace(/\u00a0/g, " ");
}

/** A `<li>` da lista "Todos os clientes" que contém este nome — escopa a
 * asserção à LINHA do cliente, sem pegar o "R$ 0,00" legítimo dos blocos
 * RFM zerados na grade acima. */
function linhaDoCliente(hospedeiro: HTMLElement, nome: string): Element {
  const linha = Array.from(hospedeiro.querySelectorAll("li")).find((li) =>
    texto(li).includes(nome),
  );
  if (!linha) throw new Error(`não achei a linha do cliente "${nome}"`);
  return linha;
}

describe("RPC antiga (banco na 78): a faixa 'Ainda não compraram' não inventa zero", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.lista = { total: 0, clientes: [] };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderComSegmentos(
    segmentos: NonNullable<ReturnType<typeof lerVisaoDoCrm>>["segmentos"],
  ) {
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={segmentos}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
  }

  it("payload EXATO da 78 (só segmentos RFM com >= 1 cliente): a faixa não aparece", async () => {
    const visao = lerVisaoDoCrm({
      kpis: {},
      canais: [],
      formas: [],
      funil: { pedidos_criados: 13, pedidos_pagos: 0 },
      pipeline: [],
      segmentos: [{ segmento: "ativos", clientes: 1, receita: 3 }],
    });
    await renderComSegmentos(visao?.segmentos ?? []);

    const corpo = texto(hospedeiro);
    expect(corpo).not.toContain("Ainda não compraram");
    expect(corpo).not.toContain("Pediu e não pagou");
    expect(corpo).not.toContain("Cadastrado, nunca comprou");
    // As faixas RFM de sempre continuam de pé (sempre puderam ter 0).
    expect(corpo).toContain("Melhores");
    expect(corpo).toContain("Ativos");
  });

  it("RPC nova (migration 83): a faixa aparece com os números reais", async () => {
    const visao = lerVisaoDoCrm({
      kpis: {},
      canais: [],
      formas: [],
      funil: {},
      pipeline: [],
      segmentos: [
        { segmento: "ativos", clientes: 1, receita: 3 },
        { segmento: "pediu_nao_pagou", clientes: 5, receita: 612.3 },
        { segmento: "nunca_comprou", clientes: 8, receita: 0 },
      ],
    });
    await renderComSegmentos(visao?.segmentos ?? []);

    const corpo = texto(hospedeiro);
    expect(corpo).toContain("Ainda não compraram");
    expect(corpo).toContain("Pediu e não pagou");
    expect(corpo).toContain("Cadastrado, nunca comprou");
  });

  it("carregando (esqueleto): a faixa nova aparece mesmo sem dado nenhum ainda", async () => {
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    expect(texto(hospedeiro)).toContain("Ainda não compraram");
  });
});

describe("linha do cliente: célula de dinheiro (mutante 'voltar a formatarMoeda(cliente.receita)')", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("pediu_nao_pagou com valor_em_aberto: mostra o valor de verdade, NUNCA 'R$ 0,00' (receita é sempre 0 nesse grupo)", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Bruna Ferreira",
          segmento: "pediu_nao_pagou",
          receita: 0,
          valorEmAberto: 134.8,
          pedidos: 1,
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = texto(linhaDoCliente(hospedeiro, "Bruna Ferreira"));
    expect(linha).toMatch(/R\$\s?134,80/);
    // O mutante ("voltar a formatarMoeda(cliente.receita)") mostraria isto:
    expect(linha).not.toMatch(/R\$\s?0,00/);
    // O rótulo da célula muda para "Em aberto" (não "Receita").
    expect(linha).toContain("Em aberto");
  });

  it("nunca_comprou: o crachá usa o rótulo CURTO 'Nunca comprou', não o rótulo longo da grade", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Gustavo Rocha",
          segmento: "nunca_comprou",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    // Crachá da LINHA do cliente: rótulo curto.
    const crachasDaLinha = Array.from(
      hospedeiro.querySelectorAll("li span.rounded-full"),
    ).map((el) => texto(el));
    expect(crachasDaLinha.some((c) => c === "Nunca comprou")).toBe(true);
    expect(crachasDaLinha.some((c) => c === "Cadastrado, nunca comprou")).toBe(
      false,
    );
  });

  it("nunca_comprou: cartão enxuto no celular (sem repetir Pedidos/Receita/Última compra/Canal vazios) — mostra 'Cadastro em dd/mm/aaaa'", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Gustavo Rocha",
          segmento: "nunca_comprou",
          cadastradoEm: "2026-08-15",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Gustavo Rocha");
    expect(texto(linha)).toContain("Cadastro em 15/08/2026");
    // A linha enxuta só existe no celular — some a partir do desktop.
    const linhaEnxuta = Array.from(linha.querySelectorAll("p")).find((el) =>
      texto(el).startsWith("Cadastro em"),
    );
    expect(linhaEnxuta?.parentElement?.classList.contains("lg:hidden")).toBe(
      true,
    );
    // Os 4 campos de sempre (Pedidos/Receita/Última compra/Canal) continuam
    // existindo para o desktop — só ficam escondidos no celular.
    const blocoDesktop = Array.from(linha.children).find((el) =>
      el.className.includes("lg:contents"),
    );
    expect(blocoDesktop?.className).toContain("hidden");
    expect(texto(blocoDesktop ?? null)).toContain("Nunca");
  });

  it("comprador de sempre: mantém o cartão de 4 campos no celular (nada muda fora de nunca_comprou)", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Marcos Andrade",
          segmento: "campeoes",
          pedidos: 3,
          receita: 300,
          ultimaCompra: "2026-09-20",
          canalPreferido: "online",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Marcos Andrade");
    expect(texto(linha)).not.toContain("Cadastro em");
    expect(texto(linha)).toContain("Pedidos");
    expect(texto(linha)).toContain("20/09/2026");
  });

  it("pediu_nao_pagou com valor_em_aberto MEDIDO zero: texto discreto, nunca 'R$ 0,00' em destaque (font-bold text-white)", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Caio Ribeiro",
          segmento: "pediu_nao_pagou",
          receita: 0,
          valorEmAberto: 0,
          pedidos: 1,
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Caio Ribeiro");
    expect(texto(linha)).not.toMatch(/R\$\s?0,00/);
    const celulaReceita = Array.from(linha.querySelectorAll("p")).find(
      (el) => texto(el) === "Sem valor em aberto",
    );
    expect(celulaReceita).not.toBeUndefined();
    expect(celulaReceita?.classList.contains("text-white")).toBe(false);
  });
});

describe("ações da linha (WhatsApp/Ver cliente) entre lg e xl: alvo de toque, ícone de ficha e title (ressalvas R1/R2 da re-revisão de front)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("R1: os dois botões só-ícone (lg-xl) têm lg:min-w-11 — alvo de toque quadrado, não 36/38×44", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Marcos Andrade",
          userId: "user-1",
          whatsapp: "34988887777",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Marcos Andrade");
    const whatsappBtn = linha.querySelector("a");
    const verClienteBtn = linha.querySelector("button");
    expect(whatsappBtn?.className).toContain("lg:min-w-11");
    expect(verClienteBtn?.className).toContain("lg:min-w-11");
  });

  it("R2: 'Ver cliente' usa um ícone de ficha (UserRound) entre lg e xl, não o chevron sozinho", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Marcos Andrade",
          userId: "user-1",
          whatsapp: "34988887777",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Marcos Andrade");
    const verClienteBtn = linha.querySelector("button");
    const icones = Array.from(verClienteBtn?.querySelectorAll("svg") ?? []);
    // Ícone de ficha: visível SÓ entre lg e xl (some fora dessa faixa).
    const ficha = icones.find(
      (svg) =>
        svg.classList.contains("lg:inline") &&
        svg.classList.contains("xl:hidden"),
    );
    // Chevron: o inverso — escondido só entre lg e xl.
    const chevron = icones.find(
      (svg) =>
        svg.classList.contains("lg:hidden") &&
        svg.classList.contains("xl:inline"),
    );
    expect(ficha).not.toBeUndefined();
    expect(chevron).not.toBeUndefined();
  });

  it("R2: os dois botões só-ícone têm title (mouse/leitor não confiam só no ícone)", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Marcos Andrade",
          userId: "user-1",
          whatsapp: "34988887777",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Marcos Andrade");
    const whatsappBtn = linha.querySelector("a");
    const verClienteBtn = linha.querySelector("button");
    expect(whatsappBtn?.getAttribute("title")).toBeTruthy();
    expect(verClienteBtn?.getAttribute("title")).toBeTruthy();
  });

  it("R2: 'Ver cliente' tem borda visível (não border-white/10, quase invisível)", async () => {
    h.lista = {
      total: 1,
      clientes: [
        montarCliente({
          nome: "Marcos Andrade",
          userId: "user-1",
          whatsapp: "34988887777",
        }),
      ],
    };
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });
    const linha = linhaDoCliente(hospedeiro, "Marcos Andrade");
    const verClienteBtn = linha.querySelector("button");
    expect(verClienteBtn?.className).not.toContain("border-white/10");
  });
});
