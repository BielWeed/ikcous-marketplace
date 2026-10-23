// @vitest-environment jsdom
//
// Financeiro — aba Caixa no desenho aprovado de 22/10/2026: cartão do esperado
// com pílula de situação e quatro ações, conta do esperado em linhas, movimentos
// em texto + valor, histórico em três colunas. O que o jsdom não prova (quebra
// de linha a 360px, contraste nos três temas) o orquestrador confere no
// navegador; aqui ficam a estrutura, as cores por significado e as classes que
// impedem o valor de quebrar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import {
  classeDoValorDaLinha,
  classeDoValorDoHeroi,
  classeDoValorNaColuna,
  periodoDaSessao,
  quandoCurto,
} from "@/components/admin/financeiro/partesDoCaixa";

const CAIXA = {
  id: "sessao-1",
  conta_id: "conta-caixa",
  conta_nome: "Caixa da loja",
  // 08:12 em Brasília.
  aberto_em: "2026-10-23T11:12:00Z",
  valor_abertura: 100,
  vendas_dinheiro: 94.9,
  devolucoes_dinheiro: 0,
  estornos_externos_dinheiro: 0,
  entradas_manuais: 20,
  saidas_manuais: 30,
  esperado: 184.9,
  movimentos: [
    {
      id: "m1",
      origem: "sangria",
      tipo: "saida",
      valor: 30,
      descricao: "Pagamento de frete",
      entra: false,
      em: "2026-10-23T17:40:00Z",
    },
    {
      id: "m2",
      origem: "suprimento",
      tipo: "entrada",
      valor: 20,
      descricao: "Troco extra",
      entra: true,
      em: "2026-10-23T14:05:00Z",
    },
  ],
};

const SESSOES = [
  {
    id: "h1",
    conta_nome: "Caixa da loja",
    aberto_em: "2026-10-21T11:00:00Z",
    fechado_em: "2026-10-21T21:30:00Z",
    esperado: 412.5,
    contado: 412.5,
    diferenca: 0,
    status: "fechado",
  },
  {
    id: "h2",
    conta_nome: "Caixa da loja",
    aberto_em: "2026-10-20T11:05:00Z",
    fechado_em: "2026-10-20T21:12:00Z",
    esperado: 305,
    contado: 300,
    diferenca: -5,
    status: "fechado",
  },
  {
    id: "h3",
    conta_nome: "Gaveta do balcão",
    aberto_em: "2026-10-19T11:00:00Z",
    fechado_em: "2026-10-20T05:10:00Z",
    esperado: 100,
    contado: 112.5,
    diferenca: 12.5,
    status: "fechado",
  },
];

let host: HTMLDivElement;
let root: Root;
let caixa: unknown;
let historico: unknown;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 23/10/2026 10:00 em Brasília.
  vi.setSystemTime(new Date("2026-10-23T13:00:00Z"));
  caixa = CAIXA;
  historico = SESSOES;
  rpc.mockReset().mockImplementation(async (nome: string) => {
    if (nome === "fin_caixa_atual") return { data: caixa, error: null };
    if (nome === "fin_caixa_historico") return { data: historico, error: null };
    return { data: [], error: null };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const noop = () => {};
const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

async function montar(
  props: Partial<Parameters<typeof AbaCaixa>[0]> = {},
  ocultos = false,
) {
  await act(async () =>
    root.render(
      <ContextoValoresOcultos.Provider value={ocultos}>
        <AbaCaixa
          ativo
          versao={0}
          abrirFolha={noop}
          aoNovoLancamento={noop}
          mostrarAcaoFixa
          {...props}
        />
      </ContextoValoresOcultos.Provider>,
    ),
  );
  for (let i = 0; i < 4; i += 1) await act(async () => Promise.resolve());
}

const botoes = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
const botao = (rotulo: string) =>
  botoes().find((b) => normalizar(b.textContent) === rotulo)!;
const secao = (rotulo: string) =>
  host.querySelector<HTMLElement>(`section[aria-label="${rotulo}"]`)!;
const dd = (raiz: ParentNode, rotulo: string) =>
  [...raiz.querySelectorAll("dt")].find((e) => e.textContent === rotulo)!
    .nextElementSibling as HTMLElement;

describe("Caixa aberto — o cartão do esperado", () => {
  it("mostra o esperado grande, a pílula Aberto em verde e desde que hora, sem quebrar o valor", async () => {
    await montar();
    const cartao = secao("Esperado na gaveta");
    expect(cartao.getAttribute("data-estado-do-caixa")).toBe("aberto");
    expect(normalizar(cartao.querySelector("h2")?.textContent)).toBe(
      "Esperado na gaveta agora",
    );
    const pilula = cartao.querySelector("[data-pilula]")!;
    expect(pilula.getAttribute("data-pilula")).toBe("positivo");
    expect(pilula.textContent).toBe("Aberto");
    expect(pilula.className).toContain("text-emerald-400");
    const valor = [...cartao.querySelectorAll(".tabular-nums")].find((e) =>
      e.textContent?.includes("184,90"),
    )!;
    expect(valor.className).toContain("whitespace-nowrap");
    expect(valor.className).toContain("text-white");
    expect(valor.className).toContain("text-[clamp(2rem,10vw,2.75rem)]");
    // Aberto hoje: só a hora; a conta vem depois do ponto.
    expect(normalizar(cartao.textContent)).toContain(
      "desde 08:12 · Caixa da loja",
    );
  });

  it("aberto em outro dia mostra a data junto da hora (o caixa pode passar da meia-noite)", async () => {
    caixa = { ...CAIXA, aberto_em: "2026-10-22T11:12:00Z" };
    await montar();
    expect(normalizar(secao("Esperado na gaveta").textContent)).toMatch(
      /desde 22\/10, 08:12 · Caixa da loja/,
    );
  });

  it("esperado negativo é o único caso em que o valor grande fica vermelho", async () => {
    caixa = { ...CAIXA, esperado: -12.5 };
    await montar();
    const valor = [
      ...secao("Esperado na gaveta").querySelectorAll(".tabular-nums"),
    ].find((e) => e.textContent?.includes("12,50"))!;
    expect(valor.className).toContain("text-red-400");
    expect(valor.className).not.toContain("text-white");
  });

  it("tem as quatro ações na ordem do desenho; Fechar caixa é o primário e todas têm borda sólida e 48px", async () => {
    const abrirFolha = vi.fn();
    const novo = vi.fn();
    await montar({ abrirFolha, aoNovoLancamento: novo });
    const grade = secao("Esperado na gaveta").querySelector(".grid-cols-2")!;
    const lista = [...grade.querySelectorAll("button")];
    expect(lista.map((b) => normalizar(b.textContent))).toEqual([
      "Sangria",
      "Suprimento",
      "Novo lançamento",
      "Fechar caixa",
    ]);
    for (const b of lista) expect(b.className).toContain("min-h-12");
    for (const b of lista.slice(0, 3)) {
      expect(b.className).toContain("border-solid");
      expect(b.className).not.toContain("bg-foreground");
    }
    const fechar = lista[3]!;
    expect(fechar.className).toContain("bg-foreground");
    expect(fechar.className).toContain("text-background");

    await act(async () => lista[0]!.click());
    expect(abrirFolha).toHaveBeenLastCalledWith({
      tipo: "caixa-movimentar",
      sessaoId: "sessao-1",
      movimento: "sangria",
      esperado: 184.9,
      contaDoCaixa: "conta-caixa",
    });
    await act(async () => lista[1]!.click());
    expect(abrirFolha).toHaveBeenLastCalledWith(
      expect.objectContaining({ movimento: "suprimento" }),
    );
    await act(async () => lista[2]!.click());
    expect(novo).toHaveBeenCalledOnce();
    await act(async () => fechar.click());
    expect(abrirFolha).toHaveBeenLastCalledWith(
      expect.objectContaining({ tipo: "caixa-fechar" }),
    );
  });

  it("sem 'Novo lançamento' o Fechar caixa ocupa a linha inteira", async () => {
    await montar({ aoNovoLancamento: undefined });
    expect(botao("Fechar caixa").className).toContain("col-span-2");
    expect(botao("Novo lançamento")).toBeUndefined();
  });

  it("não deixa ação solta na barra de baixo: as ações moram no cartão", async () => {
    await montar();
    expect(host.querySelector('[aria-label="Ações da tela"]')).toBeNull();
    expect(
      host.querySelectorAll('button[aria-label="Novo lançamento"]'),
    ).toHaveLength(1);
  });
});

describe("Caixa aberto — como o esperado é calculado", () => {
  it("lista as seis linhas na ordem do desenho e termina no Esperado", async () => {
    await montar();
    const cartao = host.querySelector("#fin-composicao-do-caixa")!;
    const rotulos = [...cartao.querySelectorAll("dt")].map(
      (e) => e.textContent,
    );
    expect(rotulos).toEqual([
      "Abertura (troco)",
      "Vendas em dinheiro",
      "Suprimentos e entradas",
      "Devoluções em dinheiro",
      "Estornos em dinheiro",
      "Sangrias e saídas",
      "Esperado",
    ]);
    const texto = (r: string) => normalizar(dd(cartao, r).textContent);
    expect(texto("Abertura (troco)")).toBe("R$ 100,00");
    expect(texto("Vendas em dinheiro")).toBe("+R$ 94,90");
    expect(texto("Sangrias e saídas")).toBe("−R$ 30,00");
    expect(texto("Esperado")).toBe("R$ 184,90");
  });

  it("cor por significado: troco e total neutros, entrou verde, saiu vermelho, zero cinza", async () => {
    await montar();
    const cartao = host.querySelector("#fin-composicao-do-caixa")!;
    expect(dd(cartao, "Abertura (troco)").className).toContain("text-white");
    expect(dd(cartao, "Esperado").className).toContain("text-white");
    expect(dd(cartao, "Esperado").className).toContain("font-bold");
    expect(dd(cartao, "Vendas em dinheiro").className).toContain(
      "text-emerald-400",
    );
    expect(dd(cartao, "Suprimentos e entradas").className).toContain(
      "text-emerald-400",
    );
    expect(dd(cartao, "Sangrias e saídas").className).toContain("text-red-400");
    // Devolução e estorno em zero: cinza, sem "−" falso.
    for (const zero of ["Devoluções em dinheiro", "Estornos em dinheiro"]) {
      expect(dd(cartao, zero).className).toContain("text-zinc-400");
      expect(dd(cartao, zero).className).not.toContain("text-red-400");
      expect(normalizar(dd(cartao, zero).textContent)).toBe("R$ 0,00");
    }
  });

  it("devolução com valor é vermelha e traz o sinal escrito", async () => {
    caixa = { ...CAIXA, devolucoes_dinheiro: 15 };
    await montar();
    const cartao = host.querySelector("#fin-composicao-do-caixa")!;
    expect(dd(cartao, "Devoluções em dinheiro").className).toContain(
      "text-red-400",
    );
    expect(normalizar(dd(cartao, "Devoluções em dinheiro").textContent)).toBe(
      "−R$ 15,00",
    );
  });

  it("valor longo nunca quebra: nowrap em todas as linhas e letra menor quando o texto passa de 11 caracteres", async () => {
    caixa = { ...CAIXA, vendas_dinheiro: 12345.67, esperado: 12445.67 };
    await montar();
    const cartao = host.querySelector("#fin-composicao-do-caixa")!;
    for (const d of cartao.querySelectorAll("dd")) {
      expect(d.className).toContain("whitespace-nowrap");
      expect(d.className).toContain("shrink-0");
      expect(d.querySelector(".tabular-nums")?.className).toContain(
        "whitespace-nowrap",
      );
    }
    expect(dd(cartao, "Vendas em dinheiro").className).toContain("text-sm");
    expect(dd(cartao, "Abertura (troco)").className).toContain("text-base");
  });
});

describe("Caixa aberto — movimentos desta sessão", () => {
  it("escreve 'Tipo · descrição' e a hora, com o valor assinado na cor do significado", async () => {
    await montar();
    const itens = [...secao("Movimentos desta sessão").querySelectorAll("li")];
    expect(itens).toHaveLength(2);
    expect(normalizar(itens[0]!.textContent)).toBe(
      "Sangria · Pagamento de frete14:40−R$ 30,00",
    );
    expect(normalizar(itens[1]!.textContent)).toBe(
      "Suprimento · Troco extra11:05+R$ 20,00",
    );
    expect(itens[0]!.querySelector(".text-red-400")).not.toBeNull();
    expect(itens[1]!.querySelector(".text-emerald-400")).not.toBeNull();
    expect(itens[0]!.querySelector("span.whitespace-nowrap")).not.toBeNull();
  });

  it("não repete o tipo quando a descrição já é o tipo, nem escreve 'Lançamento manual'", async () => {
    caixa = {
      ...CAIXA,
      movimentos: [
        {
          id: "a",
          origem: "sangria",
          tipo: "saida",
          valor: 5,
          descricao: "Sangria",
          em: "2026-10-23T12:00:00Z",
        },
        {
          id: "b",
          origem: "manual",
          tipo: "entrada",
          valor: 7,
          descricao: "Ajuste do troco",
          em: "2026-10-23T12:30:00Z",
        },
      ],
    };
    await montar();
    const itens = [
      ...secao("Movimentos desta sessão").querySelectorAll("li"),
    ].map((li) => li.querySelector("p")?.textContent);
    expect(itens).toEqual(["Sangria", "Ajuste do troco"]);
  });

  it("movimento sem data não escreve um traço solto embaixo da descrição", async () => {
    caixa = {
      ...CAIXA,
      movimentos: [
        {
          id: "z",
          origem: "sangria",
          tipo: "saida",
          valor: 9,
          descricao: "Gaveta",
        },
      ],
    };
    await montar();
    const li = secao("Movimentos desta sessão").querySelector("li")!;
    expect(li.querySelectorAll("p")).toHaveLength(1);
    expect(normalizar(li.textContent)).toBe("Sangria · Gaveta−R$ 9,00");
  });

  it("sem movimentos: a frase de sempre", async () => {
    caixa = { ...CAIXA, movimentos: [] };
    await montar();
    expect(normalizar(secao("Movimentos desta sessão").textContent)).toContain(
      "Nenhuma sangria ou suprimento. As vendas em dinheiro somam no esperado.",
    );
  });
});

describe("Caixa fechado", () => {
  beforeEach(() => {
    caixa = null;
  });

  it("diz que está fechado, com pílula cinza, e abre a folha de abertura", async () => {
    const abrirFolha = vi.fn();
    await montar({ abrirFolha });
    const cartao = secao("Caixa");
    expect(cartao.getAttribute("data-estado-do-caixa")).toBe("fechado");
    expect(normalizar(cartao.textContent)).toContain("Caixa fechado");
    expect(
      cartao.querySelector("[data-pilula]")?.getAttribute("data-pilula"),
    ).toBe("neutro");
    expect(botao("Abrir caixa").className).toContain("bg-foreground");
    await act(async () => botao("Abrir caixa").click());
    expect(abrirFolha).toHaveBeenCalledWith({ tipo: "caixa-abrir" });
  });

  it("'Novo lançamento' continua à mão, dentro do cartão e sem barra solta", async () => {
    const novo = vi.fn();
    await montar({ aoNovoLancamento: novo });
    expect(host.querySelector('[aria-label="Ações da tela"]')).toBeNull();
    const b = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Novo lançamento"]',
    )!;
    expect(b.className).toContain("border-solid");
    await act(async () => b.click());
    expect(novo).toHaveBeenCalledOnce();
  });
});

describe("Caixa — carregando e erro", () => {
  it("enquanto carrega, esqueleto ocupado e a ação 'Novo lançamento' na barra", async () => {
    rpc.mockImplementation((nome: string) =>
      nome === "fin_caixa_atual"
        ? new Promise(() => {})
        : Promise.resolve({ data: [], error: null }),
    );
    await montar();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Ações da tela"]')).not.toBeNull();
    expect(
      host.querySelector('button[aria-label="Novo lançamento"]'),
    ).not.toBeNull();
  });

  it("erro na leitura mostra o aviso com tentar de novo e mantém o histórico", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "fin_caixa_atual"
        ? { data: null, error: { message: "Failed to fetch" } }
        : { data: SESSOES, error: null },
    );
    await montar();
    const alerta = host.querySelector('[role="alert"]')!;
    expect(alerta).not.toBeNull();
    expect(
      botoes().some((b) => b.textContent?.includes("Tentar de novo")),
    ).toBe(true);
    expect(host.querySelectorAll("li").length).toBe(SESSOES.length);
  });
});

describe("Histórico do caixa", () => {
  it("escreve o período, a pílula de situação e as três colunas", async () => {
    await montar();
    const cartao = secao("Histórico do caixa");
    expect(normalizar(cartao.querySelector("h2 + p")?.textContent)).toBe(
      "Últimas 30 sessões",
    );
    const itens = [...cartao.querySelectorAll("li")];
    expect(itens).toHaveLength(3);
    expect(itens[0]!.querySelector("p")?.textContent).toBe(
      "21/10 · 08:00 – 18:30",
    );
    expect(
      [...itens[0]!.querySelectorAll("dt")].map((e) => e.textContent),
    ).toEqual(["Esperado", "Contado", "Diferença"]);
    expect(normalizar(dd(itens[1]!, "Esperado").textContent)).toBe("R$ 305,00");
    expect(normalizar(dd(itens[1]!, "Contado").textContent)).toBe("R$ 300,00");
  });

  it("bateu = verde e diferença cinza; quebra = vermelho; sobra = âmbar — sempre com a palavra e o sinal", async () => {
    await montar();
    const itens = [...secao("Histórico do caixa").querySelectorAll("li")];
    const [bateu, quebra, sobra] = itens as unknown as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(
      bateu.querySelector("[data-pilula]")?.getAttribute("data-pilula"),
    ).toBe("positivo");
    expect(normalizar(bateu.querySelector("[data-pilula]")?.textContent)).toBe(
      "Bateu",
    );
    expect(dd(bateu, "Diferença").className).toContain("text-zinc-400");
    expect(normalizar(dd(bateu, "Diferença").textContent)).toBe("R$ 0,00");

    expect(
      quebra.querySelector("[data-pilula]")?.getAttribute("data-pilula"),
    ).toBe("negativo");
    expect(normalizar(quebra.querySelector("[data-pilula]")?.textContent)).toBe(
      "Quebra −R$ 5,00",
    );
    expect(dd(quebra, "Diferença").className).toContain("text-red-400");
    // O esperado e o contado ficam neutros: só a diferença carrega a cor.
    expect(dd(quebra, "Esperado").className).toContain("text-white");
    expect(dd(quebra, "Contado").className).toContain("text-white");

    expect(normalizar(sobra.querySelector("[data-pilula]")?.textContent)).toBe(
      "Sobra +R$ 12,50",
    );
    expect(dd(sobra, "Diferença").className).toContain("text-amber-400");
  });

  it("período que vira o dia traz as duas datas; a conta só aparece quando não é a do caixa", async () => {
    await montar();
    const itens = [...secao("Histórico do caixa").querySelectorAll("li")];
    expect(itens[2]!.querySelector("p")?.textContent).toBe(
      "19/10 · 08:00 – 20/10 · 02:10",
    );
    expect(normalizar(itens[2]!.textContent)).toContain("Gaveta do balcão");
    expect(normalizar(itens[0]!.textContent)).not.toContain("Caixa da loja");
  });

  it("valores das colunas nunca quebram e encolhem quando longos", async () => {
    historico = [
      {
        ...SESSOES[1],
        esperado: 123456.78,
        contado: 123450.78,
        diferenca: -6,
      },
    ];
    await montar();
    const li = secao("Histórico do caixa").querySelector("li")!;
    for (const d of li.querySelectorAll("dd")) {
      expect(d.className).toContain("whitespace-nowrap");
      expect(d.querySelector(".tabular-nums")?.className).toContain(
        "whitespace-nowrap",
      );
    }
    expect(dd(li, "Esperado").className).toContain("text-[11px]");
    expect(dd(li, "Diferença").className).toContain("text-base");
  });

  it("sessão sem fechamento mostra traço e a pílula 'Aberto' cinza, sem inventar diferença", async () => {
    historico = [
      {
        id: "x",
        conta_nome: "Caixa da loja",
        aberto_em: "2026-10-23T11:00:00Z",
        fechado_em: null,
        status: "aberto",
      },
    ];
    await montar();
    const li = secao("Histórico do caixa").querySelector("li")!;
    expect(li.querySelector("p")?.textContent).toBe(
      "23/10 · 08:00 – em aberto",
    );
    expect(li.querySelector("[data-pilula]")?.textContent).toBe("Aberto");
    expect(li.querySelector("[data-pilula]")?.getAttribute("data-pilula")).toBe(
      "neutro",
    );
    expect(normalizar(dd(li, "Diferença").textContent)).toBe("—");
  });

  it("histórico vazio mostra a frase de sempre", async () => {
    historico = [];
    await montar();
    expect(normalizar(secao("Histórico do caixa").textContent)).toContain(
      "Nenhum caixa fechado ainda.",
    );
  });

  it("erro no histórico não derruba o caixa de cima", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "fin_caixa_historico"
        ? { data: null, error: { message: "Failed to fetch" } }
        : { data: CAIXA, error: null },
    );
    await montar();
    expect(
      secao("Histórico do caixa").querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(normalizar(secao("Esperado na gaveta").textContent)).toContain(
      "R$ 184,90",
    );
  });
});

describe("Ocultar valores vale para os blocos novos", () => {
  it("nenhum número aparece em nenhum bloco do Caixa quando o olho está fechado", async () => {
    await montar({}, true);
    const texto = normalizar(host.textContent);
    expect(texto).not.toMatch(/\d+,\d{2}/);
    expect(texto).toContain("R$ ••••••");
    // A pílula de quebra também esconde o valor, mas mantém a palavra.
    expect(texto).toContain("Quebra");
    expect(host.textContent).toContain("Valor oculto");
  });
});

describe("Medidas dos valores (funções puras)", () => {
  it("coluna do histórico: 22px não existe; encolhe por número de caracteres", () => {
    expect(classeDoValorNaColuna(412.5)).toContain("text-base");
    // "+R$ 412,50" = 10 caracteres; "R$ 1.412,50" = 11; "R$ 12.412,50" = 12…
    expect(classeDoValorNaColuna(412.5, true)).toContain("text-[15px]");
    expect(classeDoValorNaColuna(1412.5)).toContain("text-[13px]");
    expect(classeDoValorNaColuna(12412.5)).toContain("text-xs");
    expect(classeDoValorNaColuna(123456.78)).toContain("text-[11px]");
    expect(classeDoValorNaColuna(1234567.89)).toContain("text-[11px]");
    for (const v of [0, 5, 412.5, 99999999.99]) {
      expect(classeDoValorNaColuna(v)).toContain("whitespace-nowrap");
    }
  });

  it("o sinal conta como um caractere a mais", () => {
    expect(classeDoValorNaColuna(1412.5, true)).toContain("text-xs");
    expect(classeDoValorNaColuna(-1412.5)).toContain("text-xs");
  });

  it("linha e herói: nowrap sempre e tamanho por faixa", () => {
    expect(classeDoValorDaLinha(94.9, true)).toContain("text-base");
    expect(classeDoValorDaLinha(12345.67, true)).toContain("text-sm");
    expect(classeDoValorDaLinha(123456.78, true)).toContain("text-xs");
    expect(classeDoValorDaLinha(1)).toContain("whitespace-nowrap");
    expect(classeDoValorDoHeroi(184.9)).toContain(
      "text-[clamp(2rem,10vw,2.75rem)]",
    );
    expect(classeDoValorDoHeroi(12345678.9)).toContain(
      "text-[clamp(1.5rem,7vw,2rem)]",
    );
    expect(classeDoValorDoHeroi(1)).toContain("whitespace-nowrap");
  });

  it("instantes: hoje só a hora; outro dia com a data; lixo vira traço", () => {
    expect(quandoCurto("2026-10-23T11:12:00Z")).toBe("08:12");
    expect(quandoCurto("2026-10-22T11:12:00Z")).toBe("22/10, 08:12");
    expect(quandoCurto(null)).toBe("—");
    expect(quandoCurto("não é data")).toBe("—");
    expect(periodoDaSessao("lixo", null)).toBe("—");
    expect(periodoDaSessao("2026-10-21T11:00:00Z", "lixo")).toBe(
      "21/10 · 08:00",
    );
  });
});
