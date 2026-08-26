// @vitest-environment jsdom
//
// Defeito: seis rótulos verdes de "deu certo" ("Copiado!", "Principal" do
// endereço padrão, o desconto "-X%" do carrinho, "Comprador" nas perguntas,
// "Verificado" nas avaliações e "Bônus VIP" do frete grátis) usavam
// `text-emerald-600` em tamanho pequeno (7px-9px), abaixo do mínimo AA
// (4,5:1) do WCAG para texto normal. Medido (Tailwind v3, três fundos
// diferentes): 3,58 a 3,77 -- todos reprovam. `text-emerald-700` sobre os
// mesmos fundos passa (5,21 a 5,48).
//
// Escopo: SÓ estas seis linhas, medidas uma a uma pela coordenação. Não é
// "unificação do verde do app" -- `text-emerald-600` tem outras 20
// ocorrências em 16 arquivos, não medidas, fora do escopo desta tarefa.
//
// POR QUE RENDER DE VERDADE: a classe de cor vive no elemento renderizado,
// não em nenhum dado estático que dê para inspecionar sem montar a árvore.
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

import type { Address, CartItem, Product, Review } from "@/types";

// vi.mock precisa ficar no nível do módulo (hoisted acima dos imports) --
// dentro de um describe/it a fábrica perderia o escopo das variáveis que
// referenciasse. Fixture inline, sem depender de const declarada depois.
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [
      {
        id: "q-1",
        userId: "user-1",
        productId: "prod-1",
        customerName: "Cliente Teste",
        question: "Tem em outras cores?",
        createdAt: new Date(0).toISOString(),
        isVerified: true,
        answers: [],
      },
    ],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — botão de ID em 'Copiado!' usa text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(() => {
    // jsdom não implementa navigator.clipboard -- precisa do stub para o
    // clique real disparar copyToClipboard sem lançar.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

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
  });

  it("clica no ID, entra em 'Copiado!' e o botão usa text-emerald-700, não text-emerald-600", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const pedido = {
      id: "pedido-1",
      customer: { name: "Cliente Teste", whatsapp: "34999999999" },
      items: [
        { productId: "p1", name: "Item", price: 10, quantity: 1, image: "" },
      ],
      subtotal: 10,
      shipping: 0,
      discount: 0,
      total: 10,
      paymentMethod: "pix" as const,
      status: "pending" as const,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      cancelledAfterShipping: false,
    };

    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={() => {}} />);
    });

    const botaoId = hospedeiro.querySelector("button");
    await act(async () => {
      botaoId?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // A armadilha precisa estar de fato presente: sem "Copiado!" renderizado
    // de verdade, o par abaixo não prova nada sobre este defeito.
    expect(hospedeiro.textContent).toContain("Copiado!");

    const botaoCopiado = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Copiado!"),
    );
    expect(botaoCopiado).not.toBeUndefined();
    expect(botaoCopiado?.classList.contains("text-emerald-700")).toBe(true);
    expect(botaoCopiado?.classList.contains("text-emerald-600")).toBe(false);
  });
});

describe("AddressList — selo 'Principal' (modo compacto) usa text-emerald-700, não mais text-emerald-600", () => {
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
  });

  it("endereço padrão em modo compacto: o selo 'Principal' troca de tom", async () => {
    const { AddressList } = await import("@/components/ui/custom/AddressList");
    const endereco: Address = {
      id: "end-1",
      user_id: "user-1",
      name: "Casa",
      recipient_name: "Cliente Teste",
      cep: "38400-000",
      street: "Rua Teste",
      number: "100",
      neighborhood: "Centro",
      city: "Uberlândia",
      state: "MG",
      is_default: true,
    };

    await act(async () => {
      raiz.render(<AddressList addresses={[endereco]} compact />);
    });

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const selo = spans.find((el) => el.textContent === "Principal");
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });
});

describe("CartItemsList — pill de desconto do item usa text-emerald-700, não mais text-emerald-600", () => {
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
  });

  it("item com desconto: o pill '-X%' troca de tom", async () => {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    const produto: Product = {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 80,
      originalPrice: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    };
    const item: CartItem = { product: produto, quantity: 1 };

    await act(async () => {
      raiz.render(
        <CartItemsList
          cart={[item]}
          removingId={null}
          onUpdateQuantity={() => {}}
          onRemove={() => {}}
          handleClearCart={() => {}}
        />,
      );
    });

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const pillDesconto = spans.find((el) => el.textContent === "-20%");
    expect(pillDesconto).not.toBeUndefined();
    expect(pillDesconto?.classList.contains("text-emerald-700")).toBe(true);
    expect(pillDesconto?.classList.contains("text-emerald-600")).toBe(false);
  });
});

describe("ProductQA — selo 'Comprador' (pergunta de compra verificada) usa text-emerald-700, não mais text-emerald-600", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Mesmo motivo de product-qa-edit-prefill.test.tsx: o primeiro import
  // dinâmico do ProductQA carrega Avatar do Radix + ícones + date-fns/ptBR,
  // medido em 3,3s-4,5s -- perto do testTimeout padrão (5000ms). Paga o
  // custo uma vez em beforeAll, fora do orçamento por `it`.
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

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
  });

  it("pergunta de comprador verificado: o selo 'Comprador' troca de tom", async () => {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const selo = spans.find((el) => el.textContent?.includes("Comprador"));
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });
});

describe("ReviewCard — selo 'Verificado' usa text-emerald-700, não mais text-emerald-600", () => {
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
  });

  it("avaliação de compra verificada: o selo 'Verificado' troca de tom", async () => {
    const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
    const avaliacao: Review = {
      id: "rev-1",
      productId: "prod-1",
      customerName: "Cliente Teste",
      rating: 5,
      comment: "Ótimo produto",
      verified: true,
      helpful: 0,
      createdAt: new Date(0).toISOString(),
    };

    await act(async () => {
      raiz.render(<ReviewCard review={avaliacao} />);
    });

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const selo = spans.find((el) => el.textContent?.includes("Verificado"));
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });
});

describe("CartFooterSummary — selo 'Bônus VIP' (frete grátis) usa text-emerald-700, não mais text-emerald-600", () => {
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
  });

  it("frete grátis: o selo 'Bônus VIP' (portal em document.body) troca de tom", async () => {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );

    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={2}
          shipping={0}
          total={100}
          onNavigate={() => {}}
        />,
      );
    });

    // createPortal insere direto em document.body, fora de `hospedeiro`.
    const spans = Array.from(document.body.querySelectorAll("span"));
    const selo = spans.find((el) => el.textContent === "Bônus VIP");
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-emerald-700")).toBe(true);
    expect(selo?.classList.contains("text-emerald-600")).toBe(false);
  });
});
