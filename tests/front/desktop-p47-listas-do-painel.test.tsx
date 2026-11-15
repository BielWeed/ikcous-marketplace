// @vitest-environment jsdom
//
// P47 (computador) — quatro listas do painel da lojista ganham melhor uso da
// tela: avaliações, perguntas, "Pagar e receber" e "Extrato".
//
// A regra de ouro é que o celular NÃO muda: só entram classes com prefixo
// `lg:`/`xl:`. Por isso o teste congela, como LISTA LITERAL, o que cada
// elemento tocado tem SEM prefixo (a cópia de hoje, escrita aqui à mão — nunca
// lida do histórico do git, que no CI vem com 1 commit só).
//
// O teste renderiza os componentes REAIS e aplica ao DOM renderizado o seletor
// de filho que a classe do Tailwind carrega (`xl:[&>li:last-child:...]`): é
// isso que prova que ele casa com elementos de verdade, e não com um nome que
// ninguém tem (lição P29). O controle é um mutante em cópia: tirar o
// `col-span-2` do ímpar tem de reprovar a prova.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const h = vi.hoisted(() => ({
  avaliacoes: [] as Array<Record<string, unknown>>,
  perguntas: [] as unknown[],
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.avaliacoes,
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({
      reviews: h.avaliacoes,
      total: h.avaliacoes.length,
      averageRating: 4.5,
      globalVerifiedCount: 0,
      globalRepliedCount: 0,
    }),
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply: vi.fn().mockResolvedValue(true),
    subscribeToReviews: vi.fn().mockReturnValue(() => {}),
  }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: () =>
      Promise.resolve({
        questions: h.perguntas,
        total: h.perguntas.length,
      }),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: async () => ({
      status: "ok",
      total: h.perguntas.length,
      pending: h.perguntas.length,
      answered: 0,
      rate: 0,
    }),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    })),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  h.rpc.mockReset();
  h.avaliacoes = [];
  h.perguntas = [];
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
  });
  vi.stubGlobal("IntersectionObserver", ObservadorMudo);
  vi.stubGlobal("ResizeObserver", ObservadorMudo);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montar(elemento: React.ReactNode) {
  await act(async () => {
    raiz.render(elemento);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const noop = () => {};

function avaliacoes(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `r-${i}`,
    customerName: `Cliente ${i}`,
    productName: `Produto ${i}`,
    rating: 5,
    comment: "Ótimo",
    verified: false,
    status: "publicada",
    helpful: 0,
    createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
    merchantReply: null,
  }));
}

function perguntas(quantas: number) {
  return Array.from({ length: quantas }, (_, i) => ({
    id: `q-${i}`,
    userId: `cliente-${i}`,
    productId: `prod-${i}`,
    productName: `Produto ${i}`,
    customerName: `Cliente ${i}`,
    question: "Vocês enviam para o interior?",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    answers: [],
  }));
}

const HOJE = "2026-09-30";
function previstos(vencidos: number, daSemana: number) {
  const dia = (n: number) => String(n).padStart(2, "0");
  return [
    ...Array.from({ length: vencidos }, (_, i) => ({
      id: `v-${i}`,
      descricao: `Conta atrasada ${i}`,
      valor: 10,
      vencimento: `2026-09-${dia(10 + i)}`,
      origem: "manual",
      editavel: true,
    })),
    ...Array.from({ length: daSemana }, (_, i) => ({
      id: `s-${i}`,
      descricao: `Conta da semana ${i}`,
      valor: 10,
      vencimento: `2026-10-${dia(2 + i)}`,
      origem: "manual",
      editavel: true,
    })),
  ];
}

const fichas = (classe: string) => classe.split(/\s+/).filter(Boolean);
const listaDoCelular = (el: Element) =>
  classesDoCelular(el.getAttribute("class") ?? "");

/** O seletor que a classe `xl:[&…]:col-span-2` carrega, ou falha a prova. */
function seletorDoImpar(classe: string): string {
  const achadas = fichas(classe)
    .map((ficha) => /^xl:\[&(.+)\]:col-span-2$/.exec(ficha)?.[1])
    .filter((seletor): seletor is string => seletor !== undefined);
  expect(achadas).toHaveLength(1);
  return achadas[0] as string;
}

/** Os filhos REAIS da lista que a classe de PC faz ocupar duas colunas. */
function quemOcupaDuasColunas(lista: Element, classe: string): Element[] {
  const seletor = seletorDoImpar(classe);
  lista.setAttribute("data-p47", "");
  try {
    return [...document.querySelectorAll(`[data-p47]${seletor}`)];
  } finally {
    lista.removeAttribute("data-p47");
  }
}

function provarImpar(lista: Element, classe: string) {
  const itens = [...lista.children];
  const esperado = itens.length % 2 === 1 ? [itens[itens.length - 1]] : [];
  expect(quemOcupaDuasColunas(lista, classe)).toEqual(esperado);
}

const GRADE_DE_DUAS_COLUNAS = [
  "xl:grid",
  "xl:grid-cols-2",
  "xl:gap-6",
  "xl:space-y-0",
  "xl:items-start",
];

function listaDe(texto: string): HTMLUListElement {
  const lista = [...hospedeiro.querySelectorAll("ul")].find((ul) =>
    ul.textContent?.includes(texto),
  );
  expect(lista).toBeDefined();
  return lista as HTMLUListElement;
}

describe("P47 — avaliações", () => {
  async function abrir(quantas: number) {
    h.avaliacoes = avaliacoes(quantas);
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await montar(<AdminReviewsView active={true} onNavigate={noop} />);
    return listaDe("Cliente 0");
  }

  it("a lista do celular continua igual, e a de PC vira duas colunas só a partir de 1280", async () => {
    const lista = await abrir(3);
    expect(listaDoCelular(lista)).toBe("space-y-3");
    const classe = lista.getAttribute("class") ?? "";
    expect(fichas(classe)).toEqual(
      expect.arrayContaining(GRADE_DE_DUAS_COLUNAS),
    );
    // Duas colunas nunca em `lg:` (1024 daria ~358 px por coluna).
    expect(fichas(classe).some((f) => f.startsWith("lg:grid"))).toBe(false);
    // O cartão em si não muda.
    for (const li of lista.children)
      expect(li.getAttribute("class")).toBe(
        "rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5 lg:p-6",
      );
  });

  it.each([1, 2, 3, 4])(
    "com %i cartões o ímpar do fim ocupa as duas colunas e o par não deixa buraco",
    async (quantas) => {
      const lista = await abrir(quantas);
      expect(lista.children).toHaveLength(quantas);
      provarImpar(lista, lista.getAttribute("class") ?? "");
    },
  );

  it("o Responder deixa de crescer no PC e o resto do botão é o de hoje", async () => {
    const lista = await abrir(2);
    const botao = lista.querySelector('button[aria-label^="Responder a"]');
    expect(botao).not.toBeNull();
    expect(listaDoCelular(botao as Element)).toBe(
      "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-solid border-admin-border-strong bg-admin-raised px-4 text-sm font-semibold text-zinc-100 transition-colors hover:bg-admin-hover disabled:cursor-not-allowed disabled:opacity-40 min-w-0 flex-1",
    );
    expect(fichas(botao?.getAttribute("class") ?? "")).toEqual(
      expect.arrayContaining(["lg:flex-none", "lg:min-w-48"]),
    );
  });

  it("CONTROLE: sem o col-span-2 do ímpar, a prova reprova", async () => {
    const lista = await abrir(3);
    const mutante = (lista.getAttribute("class") ?? "").replace(
      "col-span-2",
      "col-span-1",
    );
    expect(() => provarImpar(lista, mutante)).toThrow();
  });
});

describe("P47 — perguntas", () => {
  async function abrir(quantas: number) {
    h.perguntas = perguntas(quantas);
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await montar(<AdminQAView onNavigate={noop} active={true} />);
    return listaDe("Cliente 0");
  }

  it("a lista do celular continua igual, e a de PC vira duas colunas só a partir de 1280", async () => {
    const lista = await abrir(3);
    expect(listaDoCelular(lista)).toBe(
      "space-y-3 transition-opacity duration-300",
    );
    const classe = lista.getAttribute("class") ?? "";
    expect(fichas(classe)).toEqual(
      expect.arrayContaining([...GRADE_DE_DUAS_COLUNAS, "lg:space-y-4"]),
    );
    expect(fichas(classe).some((f) => f.startsWith("lg:grid"))).toBe(false);
    for (const li of lista.children)
      expect(li.getAttribute("class")).toBe(
        "rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5 lg:rounded-3xl lg:p-6",
      );
  });

  it.each([1, 2, 3, 4])(
    "com %i cartões o ímpar do fim ocupa as duas colunas e o par não deixa buraco",
    async (quantas) => {
      const lista = await abrir(quantas);
      expect(lista.children).toHaveLength(quantas);
      provarImpar(lista, lista.getAttribute("class") ?? "");
    },
  );

  it("o contêiner dos avisos de erro não vira grade", async () => {
    await abrir(3);
    const principal = hospedeiro.querySelector("main");
    expect(fichas(principal?.getAttribute("class") ?? "")).not.toContain(
      "xl:grid",
    );
  });

  it("CONTROLE: sem o col-span-2 do ímpar, a prova reprova", async () => {
    const lista = await abrir(3);
    const mutante = (lista.getAttribute("class") ?? "").replace(
      "col-span-2",
      "col-span-1",
    );
    expect(() => provarImpar(lista, mutante)).toThrow();
  });
});

describe("P47 — Pagar e receber", () => {
  async function abrir(vencidos: number, daSemana: number) {
    h.rpc.mockResolvedValue({
      data: previstos(vencidos, daSemana),
      error: null,
    });
    const { AbaPrevistos } = await import(
      "@/components/admin/financeiro/AbaPrevistos"
    );
    await montar(
      <AbaPrevistos
        ativo
        hoje={HOJE}
        versao={0}
        lado="saida"
        aoMudarLado={noop}
        abrirFolha={noop}
        aoNovoLancamento={noop}
        aoAbrirPedido={noop}
      />,
    );
  }

  it("a grade do celular continua igual; o PC fica em 1 coluna até 1279 e em 2 a partir de 1280", async () => {
    await abrir(3, 2);
    const listas = [...hospedeiro.querySelectorAll("section[aria-label] ul")];
    expect(listas).toHaveLength(2);
    for (const lista of listas) {
      expect(listaDoCelular(lista)).toBe("grid grid-cols-1 gap-3");
      const classe = fichas(lista.getAttribute("class") ?? "");
      // Era `lg:grid-cols-2` (~358 px por coluna a 1024): sai de vez.
      expect(classe).not.toContain("lg:grid-cols-2");
      expect(classe).toEqual(
        expect.arrayContaining(["xl:grid-cols-2", "xl:gap-6"]),
      );
    }
  });

  it("cada seção cuida do SEU último ímpar, sem juntar uma com a outra", async () => {
    await abrir(3, 2);
    const [vencidos, daSemana] = [
      ...hospedeiro.querySelectorAll("section[aria-label] ul"),
    ] as HTMLUListElement[];
    expect(vencidos.children).toHaveLength(3);
    expect(daSemana.children).toHaveLength(2);
    provarImpar(vencidos, vencidos.getAttribute("class") ?? "");
    provarImpar(daSemana, daSemana.getAttribute("class") ?? "");
    expect(
      quemOcupaDuasColunas(vencidos, vencidos.getAttribute("class") ?? ""),
    ).toEqual([vencidos.children[2]]);
    expect(
      quemOcupaDuasColunas(daSemana, daSemana.getAttribute("class") ?? ""),
    ).toEqual([]);
  });

  it("CONTROLE: sem o col-span-2 do ímpar, a prova reprova", async () => {
    await abrir(3, 0);
    const lista = hospedeiro.querySelector(
      "section[aria-label] ul",
    ) as HTMLUListElement;
    const mutante = (lista.getAttribute("class") ?? "").replace(
      "col-span-2",
      "col-span-1",
    );
    expect(() => provarImpar(lista, mutante)).toThrow();
  });
});

describe("P47 — Extrato", () => {
  async function abrir() {
    h.rpc.mockResolvedValue({
      data: [
        {
          id: "l1",
          origem: "manual",
          tipo: "entrada",
          status: "realizado",
          valor: 10,
          data: "2026-10-01",
          conta_id: "00000000-0000-0000-0000-000000000001",
          conta_nome: "Conta bancária",
          categoria_nome: "Vendas",
          descricao: "Venda do dia",
          editavel: false,
        },
      ],
      error: null,
    });
    const { AbaExtrato } = await import(
      "@/components/admin/financeiro/AbaExtrato"
    );
    await montar(
      <AbaExtrato
        ativo
        intervalo={{ inicio: "2026-10-01", fim: "2026-10-31" }}
        hoje="2026-10-31"
        versao={0}
        contas={[]}
        rotuloDoPeriodo="Outubro de 2026"
        abrirFolha={noop}
        aoNovoLancamento={noop}
      />,
    );
  }

  it("a aba do celular continua igual e, no PC, a coluna tem largura de leitura (sem dividir os dias)", async () => {
    await abrir();
    const aba = hospedeiro.firstElementChild as Element;
    expect(listaDoCelular(aba)).toBe("flex flex-col gap-4");
    expect(fichas(aba.getAttribute("class") ?? "")).toContain("lg:max-w-4xl");
    const dias = hospedeiro.querySelector(
      '[role="group"][aria-label$="lançamento"]',
    ) as Element;
    expect(listaDoCelular(dias)).toBe("flex flex-col gap-3");
    expect(
      fichas(dias.getAttribute("class") ?? "").some((f) => /grid/.test(f)),
    ).toBe(false);
  });
});
