// @vitest-environment jsdom
//
// Prova forte da ficha do cliente (25/11/2026, caça por mutação). Os testes
// vizinhos usam bancos de mentira que IGNORAM os filtros (`eq = () => b`), então
// uma consulta sem o filtro do dono, ou sem a ordem, passava. Aqui o banco de
// mentira REGISTRA cada filtro, e cada teste derruba um defeito de uma linha:
//   - voz do cliente: as duas consultas filtram pelo autor e vêm da mais nova;
//   - voz do cliente: avaliação sem estado conta como publicada, "Útil" só
//     aparece com voto, produto apagado ganha nome da casa, respostas em ordem;
//   - carrinho: remover um item e limpar o carrinho apagam SÓ do dono da ficha;
//   - carrinho: produto excluído/inativo é dito no nome;
//   - os avisos de falha de cada ação têm a frase da casa.
// Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

type Linha = Record<string, unknown>;

const h = vi.hoisted(() => ({
  // O que o banco devolve em cada tabela.
  reviews: [] as Record<string, unknown>[],
  questions: [] as Record<string, unknown>[],
  carrinho: [] as Record<string, unknown>[],
  produtos: [] as Record<string, unknown>[],
  // Resposta do DELETE do carrinho (data = linhas apagadas).
  respostaDoDelete: { data: [{ id: "x" }], error: null } as {
    data: unknown;
    error: unknown;
  },
  falhaNaFicha: false,
  // O que a tela encadeou, por tabela, em ordem.
  cadeias: {
    reviews: [] as { metodo: string; args: unknown[] }[],
    questions: [] as { metodo: string; args: unknown[] }[],
    cart_items: [] as { metodo: string; args: unknown[] }[],
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

function cadeia(
  registro: { metodo: string; args: unknown[] }[],
  dado: unknown,
) {
  const b: any = Promise.resolve(dado);
  const metodos = ["select", "eq", "is", "in", "order", "delete"].map(
    (metodo) =>
      [
        metodo,
        (...args: unknown[]) => {
          registro.push({ metodo, args });
          return b;
        },
      ] as const,
  );
  return Object.assign(b, Object.fromEntries(metodos));
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      h.falhaNaFicha
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({
            data: {
              profile: {
                id: "cliente-1",
                full_name: "Cliente de Prova",
                role: "customer",
                created_at: "2026-02-07T00:00:00Z",
                email: "cliente@example.test",
                whatsapp: "",
              },
              orders: [],
              cart_items: h.carrinho.map((l) => ({ ...l })),
              addresses: [],
            },
            error: null,
          }),
    from: (tabela: string) => {
      if (tabela === "reviews") {
        return cadeia(h.cadeias.reviews, { data: h.reviews, error: null });
      }
      if (tabela === "questions") {
        return cadeia(h.cadeias.questions, {
          data: h.questions,
          error: null,
        });
      }
      if (tabela === "cart_items") {
        return {
          delete: (...args: unknown[]) => {
            h.cadeias.cart_items.push({ metodo: "delete", args });
            return cadeia(h.cadeias.cart_items, h.respostaDoDelete);
          },
        };
      }
      if (tabela === "vw_produtos_admin") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: h.produtos, error: null }),
          }),
        };
      }
      throw new Error(`Tabela inesperada: ${tabela}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const produtoBase = {
  id: "produto-1",
  nome: "Camiseta de prova",
  preco_venda: 10,
  estoque: 12,
  ativo: true,
  imagens: [],
  product_variants: [],
};

const linhaDoCarrinho = (id: string, extra: Linha = {}) => ({
  id,
  user_id: "cliente-1",
  product_id: "produto-1",
  quantity: 2,
  variant_id: null,
  ...extra,
});

let TelaFicha: typeof TipoTelaFicha;

beforeAll(async () => {
  ({ AdminUserDetailView: TelaFicha } = await import(
    "@/views/admin/AdminUserDetailView"
  ));
}, 60_000);

describe("Ficha do cliente — prova forte", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.reviews = [];
    h.questions = [];
    h.carrinho = [];
    h.produtos = [{ ...produtoBase }];
    h.respostaDoDelete = { data: [{ id: "x" }], error: null };
    h.falhaNaFicha = false;
    h.cadeias.reviews = [];
    h.cadeias.questions = [];
    h.cadeias.cart_items = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
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
      await esperar(50);
    });
  }

  async function abrirAba(rotulo: string) {
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes(rotulo),
    );
    if (!aba) throw new Error(`Aba "${rotulo}" não encontrada.`);
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      await esperar(20);
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  async function clicarBotao(rotulo: string, raizDoBotao: ParentNode) {
    const botao = [...raizDoBotao.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === rotulo,
    );
    if (!botao) throw new Error(`Botão "${rotulo}" não encontrado.`);
    await act(async () => {
      botao.click();
      await esperar(0);
    });
  }

  // ---- voz do cliente -----------------------------------------------------

  it("a voz do cliente lê avaliações e perguntas DELE (user_id) e da mais nova para a mais antiga", async () => {
    await abrirFicha();

    for (const [tabela, chamadas] of [
      ["reviews", h.cadeias.reviews],
      ["questions", h.cadeias.questions],
    ] as const) {
      expect(
        chamadas.filter((c) => c.metodo === "eq").map((c) => c.args),
        tabela,
      ).toEqual([["user_id", "cliente-1"]]);
      expect(
        chamadas.filter((c) => c.metodo === "order").map((c) => c.args),
        tabela,
      ).toEqual([["created_at", { ascending: false }]]);
    }
  });

  it("avaliação sem estado conta como publicada; 'Útil' só com voto; produto apagado e resposta da loja", async () => {
    h.reviews = [
      {
        id: "r-antiga",
        product_id: "p-apagado",
        rating: 4,
        comment: "Gostei muito.",
        // sem `status` e sem `helpful`: linha antiga do banco
        merchant_reply: "Obrigada pela compra!",
        created_at: "2026-08-30T10:00:00Z",
        product: null,
      },
      {
        id: "r-fila",
        product_id: "p1",
        rating: 2,
        comment: "Não serviu.",
        status: "pendente",
        helpful: 3,
        merchant_reply: null,
        created_at: "2026-08-29T10:00:00Z",
        product: { nome: "Sabão Artesanal" },
      },
    ];
    await abrirFicha();
    await abrirAba("Voz do Cliente");

    const t = texto();
    // Só a avaliação marcada pendente ganha o selo de fila.
    expect(t.match(/Aguardando aprovação/g)).toHaveLength(1);
    // A antiga (sem estado) vem primeiro e NÃO está na fila: o único selo fica
    // depois dela inteira (comentário, produto e resposta da loja).
    expect(t.indexOf("Aguardando aprovação")).toBeGreaterThan(
      t.indexOf("Obrigada pela compra!"),
    );
    expect(t.indexOf("Gostei muito.")).toBeLessThan(t.indexOf("Não serviu."));
    // Voto: só quem tem aparece; zero some.
    expect(t.match(/Útil \(/g)).toHaveLength(1);
    expect(t).toContain("Útil (3)");
    expect(t).not.toContain("Útil (0)");
    // Produto apagado ganha o nome da casa; o resto vem do banco.
    expect(t).toContain("Produto removido");
    expect(t).toContain("Sabão Artesanal");
    // Resposta da loja só onde existe.
    expect(t.match(/Resposta da loja/g)).toHaveLength(1);
    expect(t).toContain("Obrigada pela compra!");
  });

  it("as respostas de uma pergunta aparecem da mais antiga para a mais nova, mesmo chegando fora de ordem", async () => {
    h.questions = [
      {
        id: "q1",
        product_id: "p1",
        question: "Serve para roupa colorida?",
        created_at: "2026-08-28T10:00:00Z",
        product: { nome: "Sabão Artesanal" },
        answers: [
          {
            id: "a2",
            answer: "SEGUNDA resposta da loja",
            created_at: "2026-08-30T10:00:00Z",
          },
          {
            id: "a1",
            answer: "PRIMEIRA resposta da loja",
            created_at: "2026-08-29T10:00:00Z",
          },
        ],
      },
    ];
    await abrirFicha();
    await abrirAba("Voz do Cliente");

    const t = texto();
    expect(t).toContain("PRIMEIRA resposta da loja");
    expect(t).toContain("SEGUNDA resposta da loja");
    expect(t.indexOf("PRIMEIRA resposta da loja")).toBeLessThan(
      t.indexOf("SEGUNDA resposta da loja"),
    );
  });

  // ---- carrinho -----------------------------------------------------------

  async function abrirCarrinho() {
    await abrirFicha();
    await abrirAba("Carrinho");
  }

  it("remover UM item apaga só do dono da ficha, daquele produto, e só a linha sem variação quando é ela", async () => {
    h.carrinho = [linhaDoCarrinho("l1")];
    await abrirCarrinho();
    const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Remover do Carrinho"]',
    );
    expect(lixeira).not.toBeNull();
    await act(async () => lixeira?.click());
    await clicarBotao("Remover Item", document.body);

    const c = h.cadeias.cart_items;
    expect(c.map((x) => x.metodo)).toEqual([
      "delete",
      "select",
      "eq",
      "eq",
      "is",
    ]);
    expect(c.filter((x) => x.metodo === "eq").map((x) => x.args)).toEqual([
      ["user_id", "cliente-1"],
      ["product_id", "produto-1"],
    ]);
    expect(c.find((x) => x.metodo === "is")?.args).toEqual([
      "variant_id",
      null,
    ]);
    expect(h.toast.success).toHaveBeenCalledWith("Item removido com sucesso!");
  });

  it("limpar o carrinho apaga só do dono da ficha e só as linhas que a lojista viu", async () => {
    h.carrinho = [
      linhaDoCarrinho("l1"),
      linhaDoCarrinho("l2", { quantity: 1 }),
    ];
    await abrirCarrinho();
    await clicarBotao("Limpar Carrinho", hospedeiro);
    const dialogo = document.querySelector('[role="alertdialog"]');
    expect(dialogo).not.toBeNull();
    await clicarBotao("Limpar Carrinho", dialogo as ParentNode);

    const c = h.cadeias.cart_items;
    expect(c.filter((x) => x.metodo === "eq").map((x) => x.args)).toEqual([
      ["user_id", "cliente-1"],
    ]);
    expect(c.find((x) => x.metodo === "in")?.args).toEqual([
      "id",
      ["l1", "l2"],
    ]);
  });

  it("falha comum ao remover um item e ao limpar o carrinho tem a frase da casa (e não diz que deu certo)", async () => {
    h.carrinho = [linhaDoCarrinho("l1")];
    h.respostaDoDelete = { data: null, error: { message: "rede caiu" } };
    await abrirCarrinho();
    const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Remover do Carrinho"]',
    );
    await act(async () => lixeira?.click());
    await clicarBotao("Remover Item", document.body);
    expect(h.toast.error).toHaveBeenCalledWith(
      "Erro ao remover item do carrinho",
    );

    h.toast.error.mockClear();
    await clicarBotao("Limpar Carrinho", hospedeiro);
    const dialogo = document.querySelector('[role="alertdialog"]');
    await clicarBotao("Limpar Carrinho", dialogo as ParentNode);
    expect(h.toast.error).toHaveBeenCalledWith("Erro ao limpar carrinho");
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("produto excluído e produto inativo são ditos no nome, cada um com a sua palavra", async () => {
    h.carrinho = [
      linhaDoCarrinho("l1", { product_id: "produto-1" }),
      linhaDoCarrinho("l2", { product_id: "produto-2" }),
    ];
    h.produtos = [
      {
        ...produtoBase,
        id: "produto-1",
        nome: "Caneca sumida",
        deleted_at: "2026-09-01T00:00:00Z",
      },
      { ...produtoBase, id: "produto-2", nome: "Caneca parada", ativo: false },
    ];
    await abrirCarrinho();

    const t = texto();
    expect(t).toContain("Caneca sumida (Excluído)");
    expect(t).not.toContain("Caneca sumida (Inativo)");
    expect(t).toContain("Caneca parada (Inativo)");
    expect(t).not.toContain("Caneca parada (Excluído)");
  });

  it("a ficha que não carrega avisa com a frase da casa e oferece tentar de novo", async () => {
    h.falhaNaFicha = true;
    await abrirFicha();

    expect(h.toast.error).toHaveBeenCalledWith(
      "Erro ao carregar dados do usuário",
    );
    expect(texto()).toContain(
      "Não foi possível carregar os dados deste cliente",
    );
    expect(texto()).toContain("Tentar novamente");
  });
});
