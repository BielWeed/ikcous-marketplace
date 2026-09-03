// @vitest-environment jsdom
//
// Frente "ficha do cliente" (03/09): a 4ª aba da ficha — "Voz do Cliente" —
// mostra o que o cliente ESCREVEU: avaliações e perguntas, lidas das mesmas
// tabelas dos hooks (reviews/questions, leitura pública nas policies da
// baseline) filtradas pelo autor.
//
// Três estados com frases DIFERENTES, porque cada mentira aqui confunde a
// lojista de um jeito diferente:
//   - lista vazia real  -> "Nada Escrito Ainda" (ele nunca escreveu);
//   - consulta falhou   -> frase de falha com tentar de novo (NUNCA a frase
//     de vazio: dizer "ele nunca escreveu" sobre uma consulta que nem
//     chegou ao servidor é a mentira que FavoritesContext e useQuestions
//     já consertaram uma vez cada);
//   - carregando        -> skeleton, nenhum dos dois textos.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AvaliacaoDaFicha,
  type PerguntaDaFicha,
  VozClienteTab,
} from "@/components/admin/users/VozClienteTab";
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

// ---- fixtures -------------------------------------------------------------

const avaliacaoProva: AvaliacaoDaFicha = {
  id: "r1",
  productId: "p1",
  produtoNome: "Sabão Artesanal",
  rating: 4,
  comment: "Produto excelente, entrega rápida.",
  status: "pendente",
  helpful: 2,
  merchantReply: "Obrigado pela confiança!",
  createdAt: "2026-08-30T10:00:00Z",
};

const perguntaProva: PerguntaDaFicha = {
  id: "q1",
  productId: "p1",
  produtoNome: "Sabão Artesanal",
  question: "Serve para roupas coloridas?",
  createdAt: "2026-08-28T10:00:00Z",
  respostas: [
    { id: "a1", answer: "Serve sim, sem desbotar.", createdAt: "2026-08-29T10:00:00Z" },
  ],
};

// ---- Parte 1: o componente, direto ----------------------------------------

describe("VozClienteTab — os três estados com frases próprias", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(props: {
    carregando?: boolean;
    erro?: string | null;
    avaliacoes?: AvaliacaoDaFicha[];
    perguntas?: PerguntaDaFicha[];
    onTentarDeNovo?: () => void;
  }) {
    await act(async () => {
      raiz.render(
        <VozClienteTab
          carregando={props.carregando ?? false}
          erro={props.erro ?? null}
          avaliacoes={props.avaliacoes ?? []}
          perguntas={props.perguntas ?? []}
          onTentarDeNovo={props.onTentarDeNovo ?? vi.fn()}
        />,
      );
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  it("renderiza as listas: avaliação com selo de pendente, resposta da loja e útil", async () => {
    await montar({
      avaliacoes: [avaliacaoProva],
      perguntas: [perguntaProva],
    });

    const t = texto();
    expect(t).toContain("Produto excelente, entrega rápida.");
    // Moderação real: pendente é DITO — esconder faria a lojista ler um
    // texto que o cliente final ainda não vê.
    expect(t).toMatch(/aguardando aprovação/i);
    expect(t).toContain("Obrigado pela confiança!");
    expect(t).toContain("Útil (2)");
    expect(t).toContain("Sabão Artesanal");
  });

  it("renderiza perguntas com as respostas da loja", async () => {
    await montar({
      avaliacoes: [],
      perguntas: [perguntaProva],
    });

    const t = texto();
    expect(t).toContain("Serve para roupas coloridas?");
    expect(t).toContain("Serve sim, sem desbotar.");
    // Uma lista cheia NÃO apaga a frase honesta da outra, vazia.
    expect(t).toMatch(/ainda não escreveu avaliações/i);
  });

  it("vazio dos dois lados é o estado vazio único da casa", async () => {
    await montar({});

    const t = texto();
    expect(t).toMatch(/nada escrito ainda/i);
    expect(t).toMatch(/não avaliou nem perguntou/i);
  });

  it("erro tem frase PRÓPRIA — nunca a de lista vazia — e o botão tenta de novo", async () => {
    const tentarDeNovo = vi.fn();
    await montar({ erro: "Não foi possível carregar o que este cliente escreveu.", onTentarDeNovo: tentarDeNovo });

    const t = texto();
    expect(t).toMatch(/não conseguimos carregar o que este cliente escreveu/i);
    expect(t).toMatch(/não significa que a lista esteja vazia/i);
    expect(t).not.toMatch(/nada escrito ainda/i);

    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar novamente"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("carregando mostra skeleton: nem frase de vazio, nem de falha", async () => {
    await montar({ carregando: true });

    const t = texto();
    expect(t).not.toMatch(/nada escrito ainda/i);
    expect(t).not.toMatch(/não conseguimos carregar/i);
  });
});

// ---- Parte 2: a aba dentro da ficha ---------------------------------------

type Linha = Record<string, any>;

const { estado } = vi.hoisted(() => ({
  estado: {
    reviews: [] as Linha[],
    questions: [] as Linha[],
    // Simula o mock "antigo" (cadeia curta de supabase), como os testes
    // irmãos da tela usam: a consulta da voz encontra um builder sem .eq()
    // e falha — o cenário de rede quebrada na vida real.
    vozQuebrada: false,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

function cadeia(resposta: { data: unknown; error: unknown }) {
  // Builder awaitable com os métodos encadeáveis anexados (mesma técnica de
  // painel-nao-mente-sobre-o-carrinho-da-cliente: Promise de verdade com
  // métodos, para não esbarrar no noThenProperty do Biome).
  const b: any = Promise.resolve(resposta);
  b.select = () => b;
  b.eq = () => b;
  b.order = () => b;
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [
            { id: "p1", status: "delivered", total: 80, created_at: "2026-08-01T12:00:00Z" },
          ],
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: (tabela: string) => {
      if (estado.vozQuebrada) {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (tabela === "reviews") {
        return cadeia({ data: estado.reviews, error: null });
      }
      if (tabela === "questions") {
        return cadeia({ data: estado.questions, error: null });
      }
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesmo motivo dos testes irmãos: o import da tela é caro e mora na
// preparação, não na asserção.
let TelaFicha: typeof TipoTelaFicha;

beforeAll(async () => {
  ({ AdminUserDetailView: TelaFicha } = await import(
    "@/views/admin/AdminUserDetailView"
  ));
});

describe("AdminUserDetailView — a aba Voz do Cliente na ficha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.vozQuebrada = false;
    estado.reviews = [
      {
        id: "r1",
        product_id: "p1",
        rating: 5,
        comment: "Melhor compra do mês.",
        status: "publicada",
        helpful: 1,
        merchant_reply: null,
        created_at: "2026-08-30T10:00:00Z",
        product: { nome: "Sabão Artesanal" },
      },
    ];
    estado.questions = [
      {
        id: "q1",
        product_id: "p1",
        question: "Tem versão sem perfume?",
        created_at: "2026-08-28T10:00:00Z",
        product: { nome: "Sabão Artesanal" },
        answers: [],
      },
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  /** Acha o trigger da aba pelo rótulo e clica (Radix troca o painel). */
  async function abrirAbaVoz() {
    const trigger = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Voz do Cliente"),
    );
    if (!trigger) throw new Error("Aba 'Voz do Cliente' não está na tela.");
    await act(async () => {
      // Radix Tabs troca no MOUSEDOWN (botão esquerdo, sem ctrl), não no
      // click — e `element.click()` dispara SÓ o click. Sem o mousedown
      // despachado, o painel não troca e o teste fica vermelho por
      // ausência de conteúdo. O click vai junto para cobrir qualquer
      // implementação que use um ou outro.
      trigger.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      trigger.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    return trigger;
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  it("o trigger mostra a contagem combinada e a aba abre as duas listas", async () => {
    await abrirFicha();

    const trigger = await abrirAbaVoz();
    // 1 avaliação + 1 pergunta = 2.
    expect(trigger.textContent).toContain("(2)");

    const t = texto();
    expect(t).toContain("O Que Este Cliente Escreveu");
    expect(t).toContain("Melhor compra do mês.");
    expect(t).toContain("Tem versão sem perfume?");
    // O dado chega do JOIN com produtos, não de invenção da tela.
    expect(t).toContain("Sabão Artesanal");
  });

  it("cliente que nunca escreveu abre o estado vazio da casa, não um erro", async () => {
    estado.reviews = [];
    estado.questions = [];
    await abrirFicha();

    await abrirAbaVoz();

    expect(texto()).toMatch(/nada escrito ainda/i);
    expect(texto()).not.toMatch(/não conseguimos carregar/i);
  });

  it("consulta quebrada mostra a frase de falha, nunca a de 'nunca escreveu'", async () => {
    estado.vozQuebrada = true;
    await abrirFicha();

    await abrirAbaVoz();

    const t = texto();
    expect(t).toMatch(/não conseguimos carregar o que este cliente escreveu/i);
    expect(t).not.toMatch(/nada escrito ainda/i);
    // E o resgate existe: o botão de tentar de novo está na aba.
    expect(t).toMatch(/tentar novamente/i);
  });
});
