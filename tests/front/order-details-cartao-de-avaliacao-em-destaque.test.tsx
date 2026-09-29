// @vitest-environment jsdom
//
// Redesenho visual da tela do pedido (25/09/2026): a avaliação de produto
// deixa de ser uma pilula minuscula "Avaliar" perdida na lista de itens e
// vira um cartao em destaque ("O que achou da compra?"), com estrelas
// tocaveis por produto e um botao "Escrever avaliacao". Este arquivo prova
// o comportamento NOVO que a task pediu:
//   - o cartao so aparece com user + enableReviews + status delivered;
//   - tocar numa estrela abre a folha de avaliacao com a nota PRE-SELECIONADA;
//   - produto ja avaliado mostra "Avaliado" e sai do contador de estrelas;
//   - "Escrever avaliacao" some quando todos os produtos ja foram avaliados;
//   - produto repetido (duas linhas do MESMO productId) aparece uma vez so;
//   - o titulo grande do cabecalho muda por status;
//   - a linha do tempo de 4 etapas nao aparece no pedido cancelado.
//
// Molde de montagem: order-details-view-financeiro-contraste-aa.test.tsx e
// order-details-gate-avaliacoes.test.tsx (mesmos dubles de hooks).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

const pedidoBase: Order = {
  id: "pedido-avaliacao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Tênis feminino",
      price: 100,
      quantity: 1,
      image: "",
    },
    {
      productId: "prod-2",
      name: "Kit canetas",
      price: 20,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 120,
  shipping: 0,
  discount: 0,
  total: 120,
  paymentMethod: "cash",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;
/** Lista de `product_id` que `checkIfReviewed` (efeito da tela) devolve como
 * já avaliados — cada teste escreve nela antes de renderizar. */
let productIdsJaAvaliados: string[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

// `user` precisa ser a MESMA referência em toda chamada — o efeito
// `checkIfReviewed` de OrderDetailsView tem `[user, order]` nas deps. É um
// `let` (não `const`) para o teste de convidado poder zerar para `null` sem
// trocar de referência NO MEIO de um render — só entre testes.
let usuarioAtual: { id: string } | null = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

let enableReviews = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () =>
            Promise.resolve({
              data: productIdsJaAvaliados.map((product_id) => ({
                product_id,
              })),
              error: null,
            }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — cartão de avaliação em destaque", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockClear();
    updateOrderStatus.mockClear();
    enableReviews = true;
    usuarioAtual = { id: "user-1" };
    pedidoAtual = pedidoBase;
    productIdsJaAvaliados = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar(orderId = "pedido-avaliacao") {
    // Capturado só AGORA — depois que o `it` já reatribuiu `pedidoAtual`,
    // nunca no `beforeEach` (que rodaria antes da reatribuição do teste e
    // travaria o mock no pedido velho).
    fetchUserOrders.mockResolvedValue([pedidoAtual]);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={orderId}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    // `checkIfReviewed` (efeito assíncrono) precisa resolver antes de medir.
    await act(async () => {
      await Promise.resolve();
    });
  }

  function cartaoDeAvaliacao() {
    return hospedeiro.querySelector('[data-testid="cartao-avaliacao"]');
  }

  it("com enableReviews desligado, o cartão inteiro não existe (não só o botão)", async () => {
    enableReviews = false;

    await renderizar();

    expect(cartaoDeAvaliacao()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("O que achou da compra?");
  });

  it("com pedido ainda não entregue (shipping), o cartão não existe", async () => {
    pedidoAtual = { ...pedidoBase, status: "shipping" };

    await renderizar();

    expect(cartaoDeAvaliacao()).toBeNull();
  });

  // Rodada 2 (revisor Opus, "anotados"): convidado (sem sessão) com pedido
  // entregue e enableReviews ligado NÃO pode ver o cartão — avaliar exige
  // `auth.uid()` (a folha grava em `reviews`, tabela com RLS por usuário).
  it("convidado (user null), pedido entregue e enableReviews ligado: o cartão não existe", async () => {
    usuarioAtual = null;

    await renderizar();

    expect(cartaoDeAvaliacao()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("O que achou da compra?");
  });

  it("com user + enableReviews + delivered, o cartão aparece", async () => {
    await renderizar();

    expect(cartaoDeAvaliacao()).not.toBeNull();
    expect(hospedeiro.textContent).toContain("O que achou da compra?");
  });

  it("produto repetido (duas linhas do MESMO productId) aparece uma vez só no cartão", async () => {
    pedidoAtual = {
      ...pedidoBase,
      items: [
        pedidoBase.items[0],
        { ...pedidoBase.items[0] },
        pedidoBase.items[1],
      ],
    };

    await renderizar();

    const cartao = cartaoDeAvaliacao();
    expect(cartao).not.toBeNull();
    const ocorrencias = (cartao!.textContent?.match(/Tênis feminino/g) ?? [])
      .length;
    expect(ocorrencias).toBe(1);
  });

  it("produto já avaliado mostra 'Avaliado' e sai do contador de pendentes; o outro continua com estrelas", async () => {
    productIdsJaAvaliados = ["prod-1"];

    await renderizar();

    const cartao = cartaoDeAvaliacao()!;
    expect(cartao).not.toBeNull();
    // Contador: 1 dos 2 produtos já avaliado.
    expect(cartao.textContent).toContain("1 de 2 avaliados");

    const seloAvaliado = Array.from(cartao.querySelectorAll("span")).find(
      (el) => el.textContent === "Avaliado",
    );
    expect(seloAvaliado).not.toBeUndefined();

    // O produto NÃO avaliado (prod-2) ainda oferece as 5 estrelas.
    const estrelasDoPendente = cartao.querySelectorAll(
      '[aria-label*="para Kit canetas"]',
    );
    expect(estrelasDoPendente.length).toBe(5);
  });

  it("'Escrever avaliação' some quando todos os produtos já foram avaliados", async () => {
    productIdsJaAvaliados = ["prod-1", "prod-2"];

    await renderizar();

    const cartao = cartaoDeAvaliacao()!;
    expect(cartao.textContent).toContain("2 de 2 avaliados");
    const botaoEscrever = Array.from(cartao.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Escrever avaliação"),
    );
    expect(botaoEscrever).toBeUndefined();
  });

  it("'Escrever avaliação' aparece quando existe ao menos um produto pendente", async () => {
    productIdsJaAvaliados = ["prod-1"];

    await renderizar();

    const cartao = cartaoDeAvaliacao()!;
    const botaoEscrever = Array.from(cartao.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Escrever avaliação"),
    );
    expect(botaoEscrever).not.toBeUndefined();
  });

  it("tocar numa estrela abre a folha de avaliação com a nota PRÉ-SELECIONADA", async () => {
    await renderizar();

    const cartao = cartaoDeAvaliacao()!;
    // A 3ª estrela do primeiro produto (Tênis feminino).
    const estrela3 = hospedeiro.querySelector(
      '[aria-label="Dar 3 estrelas para Tênis feminino"]',
    ) as HTMLButtonElement | null;
    expect(estrela3).not.toBeNull();
    void cartao; // já usado acima só para localizar; a estrela pode estar fora dele também

    await act(async () => {
      estrela3!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // A folha de avaliação sai por `createPortal(..., document.body)` — é
    // IRMÃ de `hospedeiro` sob `document.body`, nunca sua descendente.
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const form = dialog!.querySelector("form");
    expect(form).not.toBeNull();
    const estrelasDaFolha = Array.from(
      form!.querySelectorAll('button[type="button"]'),
    );
    expect(estrelasDaFolha.length).toBe(5);

    // As 3 primeiras estrelas vêm preenchidas (nota pré-selecionada = 3); a
    // 4ª não.
    const svgDaTerceira = estrelasDaFolha[2].querySelector("svg");
    const svgDaQuarta = estrelasDaFolha[3].querySelector("svg");
    expect(svgDaTerceira?.getAttribute("class") ?? "").toContain(
      "fill-amber-400",
    );
    expect(svgDaQuarta?.getAttribute("class") ?? "").not.toContain(
      "fill-amber-400",
    );
  });
});

describe("OrderDetailsView — o título muda por status", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockClear();
    fetchUserOrders.mockResolvedValue([pedidoAtual]);
    updateOrderStatus.mockClear();
    enableReviews = false;
    productIdsJaAvaliados = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarComStatus(status: Order["status"]) {
    pedidoAtual = { ...pedidoBase, status };
    fetchUserOrders.mockResolvedValue([pedidoAtual]);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-avaliacao"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.querySelector("h1")?.textContent ?? "";
  }

  it("pending: 'Pedido recebido'", async () => {
    expect(await renderizarComStatus("pending")).toBe("Pedido recebido");
  });

  it("processing: 'Preparando seu pedido'", async () => {
    expect(await renderizarComStatus("processing")).toBe(
      "Preparando seu pedido",
    );
  });

  it("shipping: 'Chegando até você'", async () => {
    expect(await renderizarComStatus("shipping")).toBe("Chegando até você");
  });

  it("delivered: 'Chegou!'", async () => {
    expect(await renderizarComStatus("delivered")).toBe("Chegou!");
  });

  it("cancelled: 'Pedido cancelado'", async () => {
    expect(await renderizarComStatus("cancelled")).toBe("Pedido cancelado");
  });

  it("status desconhecido (fora do type): cai no título de pending, não fica em branco", async () => {
    expect(await renderizarComStatus("new" as unknown as Order["status"])).toBe(
      "Pedido recebido",
    );
  });
});

describe("OrderDetailsView — a linha do tempo de 4 etapas some no pedido cancelado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockClear();
    updateOrderStatus.mockClear();
    enableReviews = false;
    productIdsJaAvaliados = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarComStatus(status: Order["status"]) {
    pedidoAtual = { ...pedidoBase, status };
    fetchUserOrders.mockResolvedValue([pedidoAtual]);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-avaliacao"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function etapaExiste(nome: string) {
    return Array.from(hospedeiro.querySelectorAll("span")).some(
      (el) => el.textContent === nome,
    );
  }

  it("shipping: as 4 etapas aparecem ('Separado' e 'A caminho' inclusive)", async () => {
    await renderizarComStatus("shipping");

    expect(etapaExiste("Separado")).toBe(true);
    expect(etapaExiste("A caminho")).toBe(true);
    expect(etapaExiste("Entregue")).toBe(true);
  });

  it("cancelled: nenhuma das etapas da linha do tempo aparece", async () => {
    await renderizarComStatus("cancelled");

    expect(etapaExiste("Separado")).toBe(false);
    expect(etapaExiste("A caminho")).toBe(false);
    expect(etapaExiste("Entregue")).toBe(false);
  });
});
