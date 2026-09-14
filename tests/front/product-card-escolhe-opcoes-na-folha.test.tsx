// @vitest-environment jsdom
//
// REDESENHO (13/09, direção B escolhida pelo Gabriel entre 3 mockups —
// equipe/entregas/20260913-redesenho-opcoes-do-card/direcao-b-folha.html): o
// botão "Escolher opções" do card NÃO expande mais um painel DENTRO do card.
// Ele abre uma FOLHA que desliza de baixo (bottom sheet — o Sheet da casa,
// src/components/ui/sheet.tsx, Radix Dialog side="bottom"), renderizada em
// PORTAL, fora da árvore do card. Este arquivo substitui
// product-card-escolhe-opcoes-no-card.test.tsx (o fluxo é o mesmo; mudou o
// ENDEREÇO da escolha — do card para a folha).
//
// O CONTRATO (a lógica de negócio é PORTE INTACTO da versão no-card):
//   - Com a prop `onAddToCartWithVariants` presente: "Escolher opções" ABRE
//     a folha (não navega); os chips da folha selecionam variações (tocar de
//     novo DESELECIONA — toggle); o preço do card e da folha reflete o
//     `priceOverride` da escolha; o CTA do RODAPÉ da folha entrega
//     (product, variantId, "Grupo: valor") para a prop; grupo sem escolha →
//     toast nomeando o que falta e nada é entregue; variação sem estoque →
//     chip morto.
//   - 🔴 DECISÃO PAGA (herdada do painel de 12/09, portada): depois do
//     "Salvo!" a folha NÃO fecha e NÃO limpa a escolha — a cliente compra
//     DUAS variações do mesmo produto (P e M, dois sabores) sem recomeçar
//     do zero. Fechar é sempre gesto explícito (X, fora, Escape).
//   - Sem a prop: o botão continua fazendo o que fazia — levar para a tela
//     do produto (o teste irmão
//     card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx continua
//     valendo para esse caminho).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import type { Product, ProductVariant } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function criarVariantes(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-m",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "M",
      stockIncrement: 3,
      priceOverride: 65,
      active: true,
    },
    {
      id: "var-g",
      productId: "prod-caderno",
      name: "Tamanho",
      value: "G",
      stockIncrement: 0,
      active: true,
    },
  ];
}

function criarDoisGrupos(): ProductVariant[] {
  return [
    ...criarVariantes(),
    {
      id: "var-cor-azul",
      productId: "prod-caderno",
      name: "Cor",
      value: "Azul",
      stockIncrement: 2,
      active: true,
    },
  ];
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-caderno",
    name: "Caderno Bom",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "papelaria",
    stock: 10,
    sold: 3,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 12,
    ...overrides,
  };
}

describe("ProductCard — escolher opções na FOLHA (direção B)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarCard(
    produto: Product,
    props: {
      onProductClick?: (productId: string) => void;
      onAddToCartWithVariants?: (
        product: Product,
        variantId: string | undefined,
        variantNames: string,
      ) => void;
    } = {},
  ) {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={props.onProductClick ?? vi.fn()}
          showRating={false}
          onAddToCartWithVariants={props.onAddToCartWithVariants}
        />,
      );
    });
  }

  // O botão de ação do card mantém o testid de sempre: ele só ABRE a folha
  // (o rótulo "Escolher opções" é fixo agora). O CTA de adicionar mora no
  // RODAPÉ da folha, com testid próprio.
  const botaoDeAcao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;

  // A folha renderiza em PORTAL (fora do hospedeiro) — as queries dela saem
  // de document.body, não do hospedeiro.
  const folha = () =>
    document.querySelector<HTMLDivElement>(
      '[data-testid="product-card-options-sheet"]',
    );

  const ctaDaFolha = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-add"]',
    )!;

  const chip = (texto: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.trim() === texto,
    )!;

  // O X da folha: o SheetContent da casa embute o Close do Radix SEM
  // data-testid, SEM aria-label e SEM data-slot -- o único endereço estável
  // que ele oferece hoje é o <span class="sr-only">Close</span> (em inglês;
  // defeito do sheet.tsx registrado fora de escopo no relatório).
  const xDaFolha = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Close",
    )!;

  // A ALÇA (barrinha do topo da folha): peça 03, 13/09 — pedido do dono ao
  // vivo. Antes era só desenho (div aria-hidden); agora é botão que fecha por
  // CLIQUE e por ARRASTO para baixo. Endereçada por testid — endereço
  // estável, imune a ajuste de rótulo (o aria-label dela nomeia o gesto e
  // se distingue do X; quem endereça por texto teria de acompanhar).
  const alcaDaFolha = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-handle"]',
    )!;

  async function abrirFolha() {
    await act(async () => {
      botaoDeAcao()!.click();
    });
  }

  it("clicar em 'Escolher opções' abre a FOLHA por portal (fora do card) e não navega", async () => {
    const onProductClick = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
      onAddToCartWithVariants: vi.fn(),
    });

    await abrirFolha();

    const folhaEl = folha();
    expect(folhaEl).not.toBeNull();
    // PORTAL: a folha NÃO está na árvore do card — o card nunca ganha um
    // filho novo para mostrar as opções.
    expect(hospedeiro.contains(folhaEl!)).toBe(false);
    // Os valores das variações estão visíveis (na folha).
    expect(document.body.textContent).toContain("P");
    expect(document.body.textContent).toContain("M");
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("o rótulo do botão do card é sempre 'Escolher opções' — a escolha mora na folha", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    expect(botaoDeAcao().textContent).toContain("Escolher opções");

    await abrirFolha();

    // Aberta, o botão do card CONTINUA 'Escolher opções' — o rótulo de
    // ação ("Adicionar"/"Escolha acima") agora vive no CTA da folha.
    expect(botaoDeAcao().textContent).toContain("Escolher opções");
    expect(botaoDeAcao().textContent).not.toContain("Escolha acima");
  });

  it("selecionar variação com preço próprio atualiza o PREÇO do card e o rótulo do CTA", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    // Antes da escolha: preço do produto. (formatCurrency usa espaço
    // não-quebrável entre "R$" e o número — afirmar só o número.)
    expect(hospedeiro.textContent).toContain("50,00");

    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });

    // "M" tem priceOverride 65 — o card mostra o preço da escolha...
    expect(hospedeiro.textContent).toContain("65,00");
    expect(hospedeiro.textContent).not.toContain("50,00");
    // ...e o CTA da folha anuncia o valor no próprio rótulo.
    expect(ctaDaFolha().textContent).toContain("65,00");
  });

  it("'Adicionar' com a escolha completa entrega variantId e nomes, sem navegar", async () => {
    const onProductClick = vi.fn();
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
      onAddToCartWithVariants,
    });

    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });

    expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
    expect(onAddToCartWithVariants.mock.calls[0][0].id).toBe("prod-caderno");
    expect(onAddToCartWithVariants.mock.calls[0][1]).toBe("var-m");
    expect(onAddToCartWithVariants.mock.calls[0][2]).toBe("Tamanho: M");
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("dois grupos e só um escolhido: 'Adicionar' não entrega nada e o toast nomeia o grupo que falta", async () => {
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarDoisGrupos() }), {
      onAddToCartWithVariants,
    });

    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });

    expect(onAddToCartWithVariants).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toBe("Falta escolher");
    expect(JSON.stringify(vi.mocked(toast.warning).mock.calls[0][1])).toContain(
      "Cor",
    );
  });

  it("variação sem estoque: chip morto, não seleciona, e diz por quê no title", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    await abrirFolha();
    const chipG = chip("G") as HTMLButtonElement;

    expect(chipG.disabled).toBe(true);
    expect(chipG.getAttribute("title")).toBe("G — sem estoque");
  });

  it("🔴 depois do 'Salvo!' a folha NÃO fecha e NÃO limpa a escolha (compra de duas variações)", async () => {
    vi.useFakeTimers();
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants,
    });

    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });
    // 600 ms: idle -> loading -> success ("Salvo!").
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(ctaDaFolha().textContent).toContain("Salvo!");
    // A folha continua aberta...
    expect(folha()).not.toBeNull();
    // ...a escolha continua lá (chip marcado e preço da escolha no card)...
    expect(chip("M").getAttribute("aria-pressed")).toBe("true");
    expect(hospedeiro.textContent).toContain("65,00");

    // ...e voltando a idle (mais 1500 ms), nada foi descartado: o CTA já
    // está pronto para adicionar a MESMA escolha de novo (segunda variação).
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(folha()).not.toBeNull();
    expect(chip("M").getAttribute("aria-pressed")).toBe("true");
    expect(ctaDaFolha().textContent).toContain("65,00");
  });

  it("a escolha sobrevive a fechar (X) e reabrir a folha — recomeçar do zero quebraria a compra dupla", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      xDaFolha().click();
    });
    expect(folha()).toBeNull();

    await abrirFolha();

    expect(chip("M").getAttribute("aria-pressed")).toBe("true");
    expect(ctaDaFolha().textContent).toContain("65,00");
  });

  // ── FECHAR PELA ALÇA (peça 03: pedido do dono ao vivo, 13/09) ──────────
  // Três caminhos além do X: clicar na barrinha, arrastar a barrinha para
  // baixo e clicar fora (no véu). Ver cada caso pelo motivo.

  it("a alça é botão de verdade que anuncia 'Fechar (arraste para baixo)' — área de toque generosa, não só o risco de 4px", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    const alca = alcaDaFolha();
    expect(alca.tagName).toBe("BUTTON");
    // O anúncio nomeia o GESTO e se DISTINGUE do X (que continua "Fechar"):
    // dois botões de fechar com o mesmo nome obrigavam o leitor de tela a
    // adivinhar qual é qual.
    expect(alca.getAttribute("aria-label")).toBe("Fechar (arraste para baixo)");
    // h-11 = 44px de alvo de toque (WCAG 2.5.5): a área tocável é o botão
    // inteiro, altura de dedo — não o risco de 4px dentro dele.
    expect(alca.className).toContain("h-11");
  });

  it("clicar na alça (barrinha) fecha a folha — caminho que o dono pediu", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    expect(folha()).not.toBeNull();

    await act(async () => {
      alcaDaFolha().click();
    });
    expect(folha()).toBeNull();
  });

  it("arrastar a alça para baixo (além de 64px) fecha a folha", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    // jsdom não tem PointerEvent: MouseEvent com type de pointer dispara os
    // handlers normalmente (é o que o app escuta).
    await act(async () => {
      alcaDaFolha().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 180 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 172 }),
      );
    });
    expect(folha()).toBeNull();
  });

  it("arrasto curto (menos de 64px) NÃO fecha — a folha volta ao lugar", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    await act(async () => {
      alcaDaFolha().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 130 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 128 }),
      );
    });
    expect(folha()).not.toBeNull();
  });

  it("o clique sintético logo após um arrasto curto NÃO fecha (guarda movimentou)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    // Depois de um pointerup, o navegador despacha um click no MESMO
    // elemento do pointerdown (a alça). Sem a guarda `movimentou`, todo
    // arrasto curto que voltou ao lugar fecharia a folha "por acidente" —
    // o gesto de puxar e soltar viraria fecho disfarçado de toque.
    await act(async () => {
      alcaDaFolha().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 130 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 128 }),
      );
    });
    await act(async () => {
      alcaDaFolha().click();
    });
    expect(folha()).not.toBeNull();
  });

  it("clicar FORA (no véu escuro) fecha a folha — âncora do contrato do Radix", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    // O defeito relatado pelo dono ("clicar fora não fecha") era a ÁREA
    // MORTA criada pela BottomNav cobrindo o VÉU (nav z-[120] sobre sheet
    // z-50): o toque na faixa da nav atravessava e acertava o rodapé da
    // folha, não o véu. O conserto de camada (sheet no z-[130]) elimina a
    // área morta; este caso ancora o contrato de o véu em si fechar
    // (outside-pointerdown do Radix Dialog).
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    expect(overlay).not.toBeNull();
    await act(async () => {
      overlay!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      overlay!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      overlay!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(folha()).toBeNull();
  });

  it("sem a prop nova, o botão continua levando para a tela do produto (retrocompatível) e nenhuma folha abre", async () => {
    const onProductClick = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
    });

    await act(async () => {
      botaoDeAcao()!.click();
    });

    expect(onProductClick).toHaveBeenCalledWith("prod-caderno");
    expect(folha()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Adicionar");
  });
});
