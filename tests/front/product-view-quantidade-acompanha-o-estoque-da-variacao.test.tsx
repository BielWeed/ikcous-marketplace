// @vitest-environment jsdom
//
// Achado da compra da cliente: ela escolhe 5 unidades da cor Vermelha (10 em
// estoque), troca para Azul (só 2) e a tela continuava mostrando 5 -- e
// mandando 5 ao carrinho. O carrinho limita ao estoque (não vende a mais),
// mas a página deixava tentar. Contrato novo:
//   1. Trocar de variação ajusta a quantidade ao estoque da NOVA escolha e
//      diz "Só restam N";
//   2. variação esgotada fica desabilitada (como no card da vitrine);
//   3. tocar de novo na variação escolhida a desmarca.
//
// Render de verdade (react-dom/client + jsdom), mesmo molde de
// product-view-variante-composta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const avisar = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => avisar(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cor(id: string, valor: string, estoque: number): ProductVariant {
  return {
    id,
    productId: "p-camiseta",
    name: "Cor",
    value: valor,
    stockIncrement: estoque,
    active: true,
  };
}

function tamanho(id: string, valor: string, estoque: number): ProductVariant {
  return {
    id,
    productId: "p-camiseta",
    name: "Tamanho",
    value: valor,
    stockIncrement: estoque,
    active: true,
  };
}

function produtoCom(variants: ProductVariant[]): Product {
  return {
    id: "p-camiseta",
    name: "Camiseta",
    description: "Descrição de teste",
    price: 50,
    images: ["/foto-1.png"],
    category: "roupas",
    stock: 12,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

describe("ProductView — a quantidade acompanha o estoque da variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    avisar.mockClear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    adicionarAoCarrinho = vi.fn();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar(produto: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  function opcao(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    return span?.closest("button") as HTMLButtonElement;
  }

  async function tocar(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  async function aumentar(vezes: number) {
    const mais = hospedeiro.querySelector(
      "button[aria-label='Aumentar quantidade']",
    );
    for (let i = 0; i < vezes; i++) await tocar(mais);
  }

  async function comprar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Adicionar ao Carrinho"),
    );
    await tocar(botao);
  }

  // A quantidade que a tela MANDARIA ao carrinho. Não se lê o número do
  // seletor porque o número animado deixa os valores antigos no DOM do jsdom
  // (AnimatePresence, sem timers) -- o que importa à cliente é o que segue.
  async function quantidadeQueVaiAoCarrinho() {
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    return adicionarAoCarrinho.mock.calls[0][0];
  }

  it("5 unidades do vermelho (10), troca para o azul (2): vira 2 e avisa", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 2)]),
    );

    await tocar(opcao("Vermelho"));
    await aumentar(4);
    expect(avisar).not.toHaveBeenCalled();

    await tocar(opcao("Azul"));

    expect(await quantidadeQueVaiAoCarrinho()).toBe(2);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("v-azul");
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(String(avisar.mock.calls[0][0])).toBe("Só restam 2");
  });

  it("sobra 1 unidade na variação: o aviso diz 'Só resta 1' (singular)", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 1)]),
    );

    await tocar(opcao("Vermelho"));
    await aumentar(2);
    await tocar(opcao("Azul"));

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(String(avisar.mock.calls[0][0])).toBe("Só resta 1");
    expect(await quantidadeQueVaiAoCarrinho()).toBe(1);
  });

  it("trocar para uma variação com estoque de sobra NÃO mexe na quantidade nem avisa", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 8)]),
    );

    await tocar(opcao("Vermelho"));
    await aumentar(2);
    await tocar(opcao("Azul"));

    expect(avisar).not.toHaveBeenCalled();
    expect(await quantidadeQueVaiAoCarrinho()).toBe(3);
  });

  it("variação esgotada fica desabilitada e o toque não a escolhe", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 0)]),
    );

    const azul = opcao("Azul");
    expect(azul.disabled).toBe(true);

    await tocar(azul);
    await tocar(opcao("Vermelho"));
    expect(azul.getAttribute("aria-pressed")).toBe("false");
    expect(opcao("Vermelho").getAttribute("aria-pressed")).toBe("true");
  });

  it("com dois grupos, a quantidade acompanha o MENOR estoque da combinação", async () => {
    await montar(
      produtoCom([
        cor("v-verm", "Vermelho", 10),
        tamanho("v-p", "P", 10),
        tamanho("v-m", "M", 3),
      ]),
    );

    await tocar(opcao("Vermelho"));
    await tocar(opcao("P"));
    await aumentar(5);

    await tocar(opcao("M"));
    expect(String(avisar.mock.calls[0][0])).toBe("Só restam 3");
    expect(await quantidadeQueVaiAoCarrinho()).toBe(3);
  });

  it("tocar de novo na variação escolhida a desmarca", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 2)]),
    );

    await tocar(opcao("Azul"));
    expect(opcao("Azul").getAttribute("aria-pressed")).toBe("true");
    await tocar(opcao("Azul"));
    expect(opcao("Azul").getAttribute("aria-pressed")).toBe("false");

    // Sem escolha, exigir de novo a variação antes de comprar.
    await comprar();
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
  });

  it("variação selecionada e depois desativada bloqueia comprar até escolher outra", async () => {
    const vermelho = cor("v-verm", "Vermelho", 10);
    const azul = cor("v-azul", "Azul", 2);
    await montar(produtoCom([vermelho, azul]));
    await tocar(opcao("Vermelho"));

    await montar(produtoCom([{ ...vermelho, active: false }, azul]));
    expect(hospedeiro.textContent).toContain(
      "Esta opção não está mais disponível",
    );
    const bloqueados = [...hospedeiro.querySelectorAll("button")].filter(
      (b) => b.textContent === "Indisponível",
    );
    expect(bloqueados).toHaveLength(1);
    for (const botao of bloqueados) {
      expect(botao.disabled).toBe(true);
      await tocar(botao);
    }
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();

    await tocar(opcao("Azul"));
    await comprar();
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("v-azul");
  });

  it("todas as variações desativadas seguem vendendo pelo produto base", async () => {
    // Regra do servidor, do carrinho e do card: produto cujas variações foram
    // TODAS desativadas continua vendável pelo produto base.
    await montar(
      produtoCom([{ ...cor("v-verm", "Vermelho", 10), active: false }]),
    );
    expect(hospedeiro.textContent).not.toContain("sem opções disponíveis");
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBeUndefined();
  });

  // Ao vivo: a cliente já tinha escolhido uma opção e a lojista desligou TODAS
  // as variações do produto com a página aberta. Não há mais o que escolher e o
  // produto segue à venda pelo cadastro base (igual a recarregar a página): a
  // escolha velha, guardada na tela, não pode prender o botão em "Indisponível".
  function botoesIndisponiveis() {
    return [...document.querySelectorAll("button")].filter(
      (b) => b.textContent === "Indisponível",
    );
  }

  it("escolheu Vermelho e a lojista desligou TODAS as variações: o produto volta a vender pelo base", async () => {
    const vermelho = cor("v-verm", "Vermelho", 10);
    const azul = cor("v-azul", "Azul", 2);
    await montar(produtoCom([vermelho, azul]));
    await tocar(opcao("Vermelho"));
    expect(opcao("Vermelho").getAttribute("aria-pressed")).toBe("true");

    await montar(
      produtoCom([
        { ...vermelho, active: false },
        { ...azul, active: false },
      ]),
    );

    expect(hospedeiro.textContent).not.toContain(
      "Esta opção não está mais disponível",
    );
    expect(botoesIndisponiveis()).toHaveLength(0);
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBeUndefined();
  });

  it("opção única já marcada sozinha e depois todas desligadas: também volta a vender pelo base", async () => {
    const unica = cor("v-unica", "Vermelho", 10);
    await montar(produtoCom([unica]));
    expect(opcao("Vermelho").getAttribute("aria-pressed")).toBe("true");

    await montar(produtoCom([{ ...unica, active: false }]));

    expect(botoesIndisponiveis()).toHaveLength(0);
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBeUndefined();
  });

  it("todas desligadas e o produto base SEM estoque: continua sem comprar (Esgotado)", async () => {
    const vermelho = cor("v-verm", "Vermelho", 10);
    await montar(produtoCom([vermelho]));
    await tocar(opcao("Vermelho"));

    await montar({
      ...produtoCom([{ ...vermelho, active: false }]),
      stock: 0,
    });

    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Esgotado",
    ) as HTMLButtonElement | undefined;
    expect(botao).toBeTruthy();
    expect(botao?.disabled).toBe(true);
    await tocar(botao);
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
  });

  it("só o grupo Cor foi todo desligado (Tamanho segue): a escolha velha de Cor não trava, e nunca vai ao carrinho", async () => {
    const vermelho = cor("v-verm", "Vermelho", 10);
    const p = tamanho("v-p", "P", 10);
    const m = tamanho("v-m", "M", 10);
    await montar(produtoCom([vermelho, p, m]));
    await tocar(opcao("Vermelho"));
    await tocar(opcao("P"));

    await montar(produtoCom([{ ...vermelho, active: false }, p, m]));

    expect(hospedeiro.textContent).not.toContain(
      "Esta opção não está mais disponível",
    );
    expect(botoesIndisponiveis()).toHaveLength(0);
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("v-p");
    expect(String(adicionarAoCarrinho.mock.calls[0][2] ?? "")).not.toContain(
      "Vermelho",
    );
  });

  it("a fileira de Cor continua, mas a cor escolhida foi desligada (Tamanho ainda por escolher): segue travado até escolher outra", async () => {
    // O limite da regra: só a fileira que SUMIU por inteiro deixa de valer. Se
    // a fileira continua na tela, a escolha velha que ficou fora dela trava.
    const vermelho = cor("v-verm", "Vermelho", 10);
    const azul = cor("v-azul", "Azul", 10);
    const p = tamanho("v-p", "P", 10);
    const m = tamanho("v-m", "M", 10);
    await montar(produtoCom([vermelho, azul, p, m]));
    await tocar(opcao("Vermelho"));

    await montar(produtoCom([{ ...vermelho, active: false }, azul, p, m]));

    expect(hospedeiro.textContent).toContain(
      "Esta opção não está mais disponível",
    );
    const bloqueados = botoesIndisponiveis();
    expect(bloqueados.length).toBeGreaterThan(0);
    for (const botao of bloqueados) {
      expect((botao as HTMLButtonElement).disabled).toBe(true);
      await tocar(botao);
    }
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
  });

  it("grade composta (Cor / Tamanho) escolhida e depois toda desligada: vende pelo base", async () => {
    const linha = (id: string, valor: string): ProductVariant => ({
      id,
      productId: "p-camiseta",
      name: "Cor / Tamanho",
      value: valor,
      stockIncrement: 5,
      active: true,
    });
    const brancaP = linha("v-bp", "Branca / P");
    const brancaM = linha("v-bm", "Branca / M");
    await montar(produtoCom([brancaP, brancaM]));
    await tocar(document.querySelector('button[aria-label="Branca"]'));
    await tocar(document.querySelector('button[aria-label="P"]'));

    await montar(
      produtoCom([
        { ...brancaP, active: false },
        { ...brancaM, active: false },
      ]),
    );

    expect(botoesIndisponiveis()).toHaveLength(0);
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBeUndefined();
  });

  // Cadastro antigo com Cor e Tamanho em grupos SEPARADOS: a cor Azul tem 5
  // unidades, mas todos os tamanhos estão zerados. Nenhuma combinação pode ser
  // comprada, então a página diz "Esgotado" em vez de deixar o "Adicionar"
  // aceso e mandar a cliente escolher um tamanho que está todo bloqueado.
  function botoesEsgotado() {
    return [...document.querySelectorAll("button")].filter(
      (b) => b.textContent === "Esgotado",
    ) as HTMLButtonElement[];
  }

  it("Cor com estoque e TODOS os tamanhos zerados: o produto fica Esgotado, sem comprar", async () => {
    await montar({
      ...produtoCom([
        cor("v-azul", "Azul", 5),
        tamanho("v-p", "P", 0),
        tamanho("v-m", "M", 0),
      ]),
      stock: 5,
    });

    const esgotados = botoesEsgotado();
    expect(esgotados.length).toBeGreaterThan(0);
    for (const botao of esgotados) {
      expect(botao.disabled).toBe(true);
      await tocar(botao);
    }
    // Escolher a cor não devolve uma compra impossível.
    await tocar(opcao("Azul"));
    expect(botoesEsgotado().length).toBeGreaterThan(0);
    expect(hospedeiro.textContent).not.toContain("Adicionar ao Carrinho");
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    expect(avisar).not.toHaveBeenCalled();
  });

  it("Cor com estoque e UM tamanho com estoque: segue comprável (controle)", async () => {
    await montar({
      ...produtoCom([
        cor("v-azul", "Azul", 5),
        tamanho("v-p", "P", 0),
        tamanho("v-m", "M", 3),
      ]),
      stock: 8,
    });

    expect(botoesEsgotado()).toHaveLength(0);
    await tocar(opcao("Azul"));
    await tocar(opcao("M"));
    await comprar();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("v-azul~v-m");
  });

  it("desmarcar funciona também com dois grupos", async () => {
    // Estoque da combinação cai a 0 por causa do OUTRO grupo: o botão da
    // escolha atual não pode virar armadilha (disabled sem como desmarcar).
    await montar(
      produtoCom([
        cor("v-verm", "Vermelho", 10),
        cor("v-azul", "Azul", 0),
        tamanho("v-p", "P", 10),
      ]),
    );
    await tocar(opcao("Vermelho"));
    await tocar(opcao("P"));
    await tocar(opcao("Vermelho"));
    expect(opcao("Vermelho").getAttribute("aria-pressed")).toBe("false");
  });
});
