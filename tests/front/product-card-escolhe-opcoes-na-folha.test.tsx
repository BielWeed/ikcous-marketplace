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
//     a folha (não navega); desde 21/10, só Cor é pré-escolhida e os eixos
//     abrem um por vez (tocar no marcado só recolhe); o preço reflete o
//     `priceOverride` da escolha; o CTA do RODAPÉ da folha entrega
//     (product, variantId, "Grupo: valor", quantidade) para a prop; grupo sem
//     escolha → toast nomeando o que falta e nada é entregue; variação sem
//     estoque → chip morto.
//   - 🟢 PEÇA 18 (14/09 — novo pedido do dono, ditado por voz ~17:58, que
//     REVOGA a decisão de 12/09): depois do "Salvo!" a folha FECHA sozinha,
//     pelo mecanismo dela (setFolhaOpcoesAberta; alça, clique fora, Escape e
//     o guardião do sheet.tsx seguem intactos). A escolha de variação
//     continua viva no card (reabrir mantém), a quantidade volta a 1.
//   - 🟢 PEÇA 18: a folha tem SELETOR DE QUANTIDADE (o QuantitySelector da
//     casa, o da página do produto): nasce em 1, teto = estoque do item
//     escolhido, "+" e "−" desabilitam nas bordas, e a quantidade escolhida
//     viaja no 4º argumento da prop.
//   - 🟢 PEÇA 18 (REVISTA em 14/10/2026): o "Adicionar" da folha termina no
//     MESMO voo de bolinha do caminho do card (triggerFlyingCartAnimation),
//     mas SÓ QUANDO A FOLHA JÁ SAIU, partindo da foto do CARD ao fundo. A
//     versão da peça 18 partia da foto da folha com ela aberta: a bolinha
//     boiava sobre o conteúdo e ia para um carrinho coberto pela folha.
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
        quantity?: number,
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
      (b) =>
        b.getAttribute("aria-label") === texto ||
        b.textContent?.trim() === texto,
    )!;

  // A ALÇA (barrinha do topo da folha): peça 03, 13/09 — pedido do dono ao
  // vivo. Antes era só desenho (div aria-hidden); agora é botão que fecha por
  // CLIQUE e por ARRASTO para baixo. Peça 09 (14/09): com o X embutido do
  // SheetContent DESLIGADO nesta folha, ela é o ÚNICO botão de fechar — e
  // herdou o anúncio de leitor de tela que o X carregava. Endereçada por
  // testid — endereço estável, imune a ajuste de rótulo.
  const alcaDaFolha = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-options-handle"]',
    )!;

  // ── SELETOR DE QUANTIDADE (peça 18) ────────────────────────────────────
  // O número vive na região live do QuantitySelector (aria-live="polite");
  // os botões têm aria-label "Diminuir/Aumentar quantidade". No jsdom a
  // AnimatePresence (framer-motion) NUNCA completa a saída do número antigo,
  // então os spans se acumulam ("12345") — o número VIGENTE é o ÚLTIMO span
  // (ordem de inserção: cada troca acrescenta o novo depois dos que estão
  // saindo).
  const numeroDaQuantidade = () => {
    const spans = document.querySelectorAll<HTMLElement>(
      '[aria-live="polite"] span',
    );
    return spans[spans.length - 1]!.textContent!.trim();
  };
  const botaoQuantidade = (direcao: "Diminuir" | "Aumentar") =>
    document.querySelector<HTMLButtonElement>(
      `button[aria-label="${direcao} quantidade"]`,
    )!;

  async function abrirFolha() {
    await act(async () => {
      botaoDeAcao()!.click();
    });
  }

  it("reabre opções se P esgotou depois da escolha mas M ainda tem estoque", async () => {
    const adicionar = vi.fn();
    const produto = criarProduto({ variants: criarVariantes() });
    await renderizarCard(produto, { onAddToCartWithVariants: adicionar });
    await abrirFolha();
    await act(async () => chip("P").click());
    await act(async () => alcaDaFolha().click());
    await renderizarCard(
      {
        ...produto,
        variants: criarVariantes().map((v) =>
          v.value === "P" ? { ...v, stockIncrement: 0 } : v,
        ),
      },
      { onAddToCartWithVariants: adicionar },
    );

    expect(botaoDeAcao().disabled).toBe(false);
    expect(botaoDeAcao().textContent).toContain("Escolher opções");
    await abrirFolha();
    expect(folha()).not.toBeNull();
    await act(async () => ctaDaFolha().click());
    expect(adicionar).not.toHaveBeenCalled();
    await act(async () => chip("M").click());
    await act(async () => ctaDaFolha().click());
    expect(adicionar).toHaveBeenCalledWith(
      expect.anything(),
      "var-m",
      expect.stringContaining("M"),
      1,
    );
  });

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

    await abrirFolha(); // Só Cor nasce escolhida; Tamanho continua pendente.
    await act(async () => {
      ctaDaFolha().click();
    });

    expect(onAddToCartWithVariants).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toBe("Falta escolher");
    expect(JSON.stringify(vi.mocked(toast.warning).mock.calls[0][1])).toContain(
      "Tamanho",
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

  it("🟢 depois do 'Salvo!' a folha FECHA sozinha (peça 18: o dono revogou a decisão de 12/09 em 14/09)", async () => {
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
    // O "Salvo!" tem um batimento visível ANTES do fecho: a folha ainda
    // está na tela neste ponto (600 ms de voo + confirmação).
    expect(folha()).not.toBeNull();

    // +700 ms: o voo (750 ms, no total) já aterrissou e a folha fecha
    // sozinha — pelo mecanismo dela (setFolhaOpcoesAberta), sem tocar no
    // guardião do sheet.tsx.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(folha()).toBeNull();

    // Reabrindo: a ESCOLHA continua viva no card (contrato que sobreviveu —
    // reabrir mantém o M e o preço da escolha), mas a QUANTIDADE voltou a 1:
    // pedido novo começa do um.
    await abrirFolha();
    expect(chip("M").getAttribute("aria-pressed")).toBe("true");
    expect(hospedeiro.textContent).toContain("65,00");
    expect(numeroDaQuantidade()).toBe("1");
  });

  // ── SELETOR DE QUANTIDADE (peça 18, 14/09 — pedido do dono) ────────────

  it("a folha tem seletor de quantidade: nasce em 1 e trava nas bordas 1 e estoque-da-escolha", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    await act(async () => {
      chip("M").click(); // M tem stockIncrement 3
    });

    const menos = botaoQuantidade("Diminuir");
    const mais = botaoQuantidade("Aumentar");
    // Nasce em 1: primeiro render, um span só — e "−" já desabilitado.
    expect(numeroDaQuantidade()).toBe("1");
    expect(menos.disabled).toBe(true);

    await act(async () => {
      mais.click();
    });
    // Andou: "−" volta a existir.
    expect(menos.disabled).toBe(false);

    await act(async () => {
      mais.click();
    });
    // Teto = estoque do item escolhido (M = 3): "+" desabilita.
    expect(mais.disabled).toBe(true);

    // Trocar para P (estoque 5) solta o teto: "+" volta a andar até 5.
    await act(async () => {
      chip("P").click();
    });
    expect(mais.disabled).toBe(false);
    await act(async () => {
      mais.click();
    });
    await act(async () => {
      mais.click();
    });
    expect(mais.disabled).toBe(true);
  });

  it("trocar para uma variação com MENOS estoque aperta a quantidade para caber", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    await act(async () => {
      chip("P").click(); // P tem estoque 5
    });
    const menos = botaoQuantidade("Diminuir");
    const mais = botaoQuantidade("Aumentar");
    await act(async () => {
      mais.click();
    });
    await act(async () => {
      mais.click();
    });
    await act(async () => {
      mais.click();
    });
    await act(async () => {
      mais.click();
    });
    // No teto do P (5): "+" travado.
    expect(mais.disabled).toBe(true);

    // Troca para M (estoque 3): a quantidade DESCE para 3 — a folha não
    // deixa pedir mais do que existe. Prova POR COMPORTAMENTO (o dígito
    // animado do framer-motion não é confiável no jsdom): se a quantidade
    // tivesse ficado em 5, UM "−" deixaria "+" travado (4 >= 3); como
    // desceu a 3, um "−" a traz para 2 e "+" volta a andar.
    await act(async () => {
      chip("M").click();
    });
    expect(mais.disabled).toBe(true);
    await act(async () => {
      menos.click();
    });
    expect(mais.disabled).toBe(false);
    expect(menos.disabled).toBe(false);
  });

  it("'Adicionar' entrega a QUANTIDADE escolhida no 4º argumento (escolhe 3 → carrinho soma 3)", async () => {
    const onAddToCartWithVariants = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants,
    });
    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    const mais = botaoQuantidade("Aumentar");
    await act(async () => {
      mais.click();
    });
    await act(async () => {
      mais.click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });

    expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
    expect(onAddToCartWithVariants.mock.calls[0][1]).toBe("var-m");
    expect(onAddToCartWithVariants.mock.calls[0][2]).toBe("Tamanho: M");
    expect(onAddToCartWithVariants.mock.calls[0][3]).toBe(3);
  });

  // ── A BOLINHA DO CARRINHO NÃO ATRAVESSA A FOLHA (14/10/2026) ───────────
  // Relato do dono (dois prints de celular): ao tocar em "Adicionar" dentro
  // da folha, a bolinha com a foto do produto aparecia boiando por cima do
  // conteúdo da folha (ao lado do preço) e seguia para um carrinho que a
  // própria folha cobre (folha z-130 acima da barra de baixo z-120). Medido
  // no Chromium, 375x812: ela saía do centro da foto da folha (188,343) e ia
  // até (237,780), TODAS as 45 amostras do voo dentro da folha aberta.
  // Contrato novo: a bolinha só voa quando a folha já SAIU — parte da foto
  // do CARD (que está visível ao fundo) até o carrinho. Sem ponto de partida
  // visível e confiável, não voa (fica o "Salvo!").
  //
  // O jsdom não mede layout: `getBoundingClientRect` devolve zeros. Os
  // testes dão as medidas na mão; o visual real foi conferido no Chromium.
  const fotoDoCard = () =>
    hospedeiro.querySelector<HTMLElement>(
      '[data-testid="product-card-photo"]',
    )!;
  const voos = () => document.querySelectorAll(".cart-flyer-container");

  function medir(el: Element, r: Partial<DOMRect>) {
    const left = r.left ?? 0;
    const top = r.top ?? 0;
    const width = r.width ?? 0;
    const height = r.height ?? 0;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    });
  }

  // O alvo do voo: #bottom-nav-cart (a BottomNav planta na vitrine real; no
  // jsdom, um pino de teste). Sem ele o trigger sai cedo, só com um aviso.
  function plantarCarrinho() {
    const alvo = document.createElement("div");
    alvo.id = "bottom-nav-cart";
    document.body.appendChild(alvo);
    medir(alvo, { left: 300, top: 700, width: 60, height: 20 });
    return alvo;
  }

  // O jsdom não implementa `elementFromPoint` (quem está por cima de um
  // ponto da tela): o teste planta uma resposta e, no fim, tira.
  function quemEstaPorCima(el: () => Element | null) {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => el(),
    });
  }

  // Tela de 1024x768 (padrão do jsdom): a foto do card inteira à vista.
  function fotoDoCardVisivel() {
    medir(fotoDoCard(), { left: 20, top: 100, width: 160, height: 200 });
    // Centro (100, 200): o que está por cima ali é a própria foto do card.
    quemEstaPorCima(() => fotoDoCard());
  }

  async function escolherMEAdicionar() {
    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      ctaDaFolha().click();
    });
  }

  // 600 ms (Salvando -> Salvo!) + 700 ms (Salvo! visível) = folha fecha;
  // depois, um tique para o Radix terminar de soltar a folha e avisar.
  async function esperarAFolhaFechar() {
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
  }

  describe("bolinha do carrinho no caminho da folha", () => {
    let alvoDoCarrinho: HTMLElement;

    beforeEach(() => {
      vi.useFakeTimers();
      alvoDoCarrinho = plantarCarrinho();
    });

    afterEach(() => {
      // O voo se limpa sozinho aos 750 ms; limpar na mão para não vazar nó
      // para o caso seguinte.
      for (const voo of Array.from(voos())) voo.remove();
      alvoDoCarrinho.remove();
      Reflect.deleteProperty(document, "elementFromPoint");
    });

    it("com a folha ABERTA nenhuma bolinha nasce — nem no toque, nem no 'Salvo!'", async () => {
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants: vi.fn(),
      });
      fotoDoCardVisivel();
      await escolherMEAdicionar();

      // Logo depois do toque: o botão mostra "Salvando...", e nada voa.
      expect(ctaDaFolha().textContent).toContain("Salvando...");
      expect(voos()).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      // No "Salvo!" a folha ainda está na tela — e continua sem bolinha.
      expect(ctaDaFolha().textContent).toContain("Salvo!");
      expect(folha()).not.toBeNull();
      expect(voos()).toHaveLength(0);
    });

    it("quando a folha SAI, a bolinha parte da foto do CARD até o carrinho", async () => {
      const onAddToCartWithVariants = vi.fn();
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants,
      });
      fotoDoCardVisivel();
      await escolherMEAdicionar();
      await esperarAFolhaFechar();

      expect(folha()).toBeNull();
      expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);

      expect(voos()).toHaveLength(1);
      const voo = voos()[0] as HTMLElement;
      // No BODY (fora do card e da folha, mesma anatomia do caminho do card).
      expect(voo.parentElement).toBe(document.body);
      // Ponto de partida = centro da foto do CARD (100,200) menos metade da
      // bolinha (50px / 2): a bolinha nasce em cima da foto de fundo.
      expect(voo.style.left).toBe("75px");
      expect(voo.style.top).toBe("175px");
      const bolinha = voo.querySelector("img");
      expect(bolinha).not.toBeNull();
      expect(bolinha!.getAttribute("src")).toBe("https://example.com/img.png");
    });

    it("o voo vale UMA vez: fechar e reabrir a folha depois não solta outra bolinha", async () => {
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants: vi.fn(),
      });
      fotoDoCardVisivel();
      await escolherMEAdicionar();
      await esperarAFolhaFechar();
      expect(voos()).toHaveLength(1);
      for (const voo of Array.from(voos())) voo.remove();

      await abrirFolha();
      await act(async () => {
        alcaDaFolha().click();
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(folha()).toBeNull();
      expect(voos()).toHaveLength(0);
    });

    it("abrir a folha e fechar SEM adicionar não solta bolinha", async () => {
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants: vi.fn(),
      });
      fotoDoCardVisivel();
      await abrirFolha();
      await act(async () => {
        alcaDaFolha().click();
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(folha()).toBeNull();
      expect(voos()).toHaveLength(0);
    });

    it("toque duplo no 'Adicionar': entra UMA vez e sai UMA bolinha", async () => {
      const onAddToCartWithVariants = vi.fn();
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants,
      });
      fotoDoCardVisivel();
      await abrirFolha();
      await act(async () => {
        chip("M").click();
      });
      // Dois toques, cada um um evento (o React atualiza entre eles, como no
      // aparelho): o segundo cai no "Salvando..." e é recusado.
      await act(async () => {
        ctaDaFolha().click();
      });
      await act(async () => {
        ctaDaFolha().click();
      });
      await esperarAFolhaFechar();

      expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
      expect(voos()).toHaveLength(1);
    });

    it("fechar a folha pela alça durante o 'Salvando...' também termina no voo (o item JÁ entrou)", async () => {
      const onAddToCartWithVariants = vi.fn();
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants,
      });
      fotoDoCardVisivel();
      await escolherMEAdicionar();
      expect(voos()).toHaveLength(0);

      await act(async () => {
        alcaDaFolha().click();
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(folha()).toBeNull();
      expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
      expect(voos()).toHaveLength(1);
    });

    it("card fora da tela quando a folha sai: NÃO voa (sem ponto de partida visível), mas o item entrou", async () => {
      const onAddToCartWithVariants = vi.fn();
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants,
      });
      // A foto do card está acima do topo da tela (rolada para fora).
      medir(fotoDoCard(), { left: 20, top: -500, width: 160, height: 200 });
      quemEstaPorCima(() => fotoDoCard());
      await escolherMEAdicionar();
      await esperarAFolhaFechar();

      expect(folha()).toBeNull();
      expect(onAddToCartWithVariants).toHaveBeenCalledTimes(1);
      expect(voos()).toHaveLength(0);
    });

    it("foto do card COBERTA por outra coisa (barra fixa, outra folha): NÃO voa", async () => {
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants: vi.fn(),
      });
      medir(fotoDoCard(), { left: 20, top: 100, width: 160, height: 200 });
      // O que está por cima do centro da foto NÃO é do card.
      quemEstaPorCima(() => alvoDoCarrinho);
      await escolherMEAdicionar();
      await esperarAFolhaFechar();

      expect(voos()).toHaveLength(0);
    });

    it("o foco volta ao botão do card quando a folha sai (a bolinha não rouba o foco)", async () => {
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants: vi.fn(),
      });
      fotoDoCardVisivel();
      await escolherMEAdicionar();
      await esperarAFolhaFechar();

      expect(voos()).toHaveLength(1);
      expect(document.activeElement).toBe(botaoDeAcao());
    });

    it("a bolinha sai ANTES de o foco voltar ao botão do card (focar rola a página e tira a foto da tela)", async () => {
      // Medido no Chromium (1024px, 2 colunas, foto de ~600px, card
      // parcialmente rolado): `botao.focus()` rola a página para mostrar o
      // botão, que fica no pé do card. Com a ordem antiga (foco, depois voo) o
      // centro da foto já tinha saído da tela quando `pontoDeSaidaVisivel`
      // perguntava, e só aparecia o "Salvo!". Aqui o foco registra QUANTAS
      // bolinhas já existiam no instante em que foi chamado.
      await renderizarCard(criarProduto({ variants: criarVariantes() }), {
        onAddToCartWithVariants: vi.fn(),
      });
      fotoDoCardVisivel();
      const bolinhasNoInstanteDoFoco: number[] = [];
      const focarDeVerdade = HTMLElement.prototype.focus;
      const botao = botaoDeAcao();
      vi.spyOn(botao, "focus").mockImplementation(function (
        this: HTMLElement,
        opcoes?: FocusOptions,
      ) {
        bolinhasNoInstanteDoFoco.push(voos().length);
        focarDeVerdade.call(this, opcoes);
      });
      await escolherMEAdicionar();
      await esperarAFolhaFechar();

      expect(bolinhasNoInstanteDoFoco).toEqual([1]);
      expect(voos()).toHaveLength(1);
      expect(document.activeElement).toBe(botao);
    });
  });

  it("card SEM variação: o voo continua saindo na hora, do botão do card (caminho direto preservado)", async () => {
    vi.useFakeTimers();
    const alvo = plantarCarrinho();
    try {
      const onAddToCart = vi.fn();
      const { ProductCard } = await import(
        "@/components/ui/custom/ProductCard"
      );
      await act(async () => {
        raiz.render(
          <ProductCard
            product={criarProduto()}
            isFavorite={false}
            onToggleFavorite={() => {}}
            onClick={vi.fn()}
            showRating={false}
            onAddToCart={onAddToCart}
          />,
        );
      });
      medir(botaoDeAcao(), { left: 40, top: 300, width: 100, height: 30 });
      await act(async () => {
        botaoDeAcao().click();
      });

      expect(onAddToCart).toHaveBeenCalledTimes(1);
      // Na hora, sem esperar nada: centro do botão (90,315) - 25.
      expect(voos()).toHaveLength(1);
      const voo = voos()[0] as HTMLElement;
      expect(voo.style.left).toBe("65px");
      expect(voo.style.top).toBe("290px");
    } finally {
      for (const voo of Array.from(voos())) voo.remove();
      alvo.remove();
    }
  });

  it("a escolha sobrevive a fechar (alça) e reabrir a folha — recomeçar do zero quebraria a compra dupla", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });

    await abrirFolha();
    await act(async () => {
      chip("M").click();
    });
    await act(async () => {
      alcaDaFolha().click();
    });
    expect(folha()).toBeNull();

    await abrirFolha();

    expect(chip("M").getAttribute("aria-pressed")).toBe("true");
    expect(ctaDaFolha().textContent).toContain("65,00");
  });

  const linha = (nome: string) =>
    Array.from(
      folha()!.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => b.getAttribute("aria-label")?.startsWith(`${nome}:`))!;
  const produtoComposto = () =>
    criarProduto({
      variants: [
        {
          id: "azul-pp",
          productId: "prod-caderno",
          name: "Cor / Tamanho",
          value: "Azul / PP",
          stockIncrement: 5,
          priceOverride: 60,
          imageUrl: "https://example.com/azul.png",
          active: true,
        },
        {
          id: "azul-m",
          productId: "prod-caderno",
          name: "Cor / Tamanho",
          value: "Azul / M",
          stockIncrement: 3,
          priceOverride: 75,
          active: true,
        },
        {
          id: "preto-pp",
          productId: "prod-caderno",
          name: "Cor / Tamanho",
          value: "Preto / PP",
          stockIncrement: 2,
          active: true,
        },
        {
          id: "verde-m",
          productId: "prod-caderno",
          name: "Cor / Tamanho",
          value: "Verde / M",
          stockIncrement: 0,
          active: true,
        },
      ],
    });

  it("compacta: só Cor pré-escolhida, tamanho aberto com foco; foto parcial não muda preço do card", async () => {
    await renderizarCard(produtoComposto(), {
      onAddToCartWithVariants: vi.fn(),
    });
    expect(hospedeiro.textContent).toContain("50,00");
    await abrirFolha();
    expect(linha("Cor").getAttribute("aria-label")).toBe(
      "Cor: Azul. Toque para trocar",
    );
    expect(linha("Cor").getAttribute("aria-expanded")).toBe("false");
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(chip("PP"));
    expect(ctaDaFolha().textContent).toContain("Escolha: Tamanho");
    expect(hospedeiro.textContent).toContain("50,00");
    const foto = folha()!.querySelector(
      '[data-testid="product-card-options-thumbnail"] img',
    )!;
    expect(foto.getAttribute("src")).toContain("azul.png");
    expect(foto.getAttribute("style")).toContain("contain");
  });

  it("compacta: escolher recolhe e foca CTA com total; tocar marcado não desmarca", async () => {
    const entregar = vi.fn();
    await renderizarCard(produtoComposto(), {
      onAddToCartWithVariants: entregar,
    });
    await abrirFolha();
    await act(async () => chip("M").click());
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(ctaDaFolha());
    await act(async () => botaoQuantidade("Aumentar").click());
    expect(ctaDaFolha().textContent).toContain("150,00");
    await act(async () => linha("Tamanho").click());
    await act(async () => chip("M").click());
    expect(chip("M").getAttribute("aria-pressed")).toBe("true");
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("false");
    await act(async () => ctaDaFolha().click());
    expect(entregar.mock.calls[0].slice(1)).toEqual([
      "azul-m",
      "Cor / Tamanho: Azul / M",
      2,
    ]);
  });

  it("compacta: trocar a cor permite a nova cor e desfaz tamanho inexistente", async () => {
    await renderizarCard(produtoComposto(), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    await act(async () => chip("M").click());
    await act(async () => linha("Cor").click());
    expect(chip("Preto").disabled).toBe(false);
    await act(async () => chip("Preto").click());
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("true");
    expect(chip("M").disabled).toBe(false);
    expect(chip("M").className).toContain("line-through");
    expect(folha()!.textContent).toContain("M não tem em Preto.");
    expect(ctaDaFolha().textContent).toContain("Escolha: Tamanho");
  });

  it("compacta: estoque vivo zera, desfaz tamanho e explica sem entregar item", async () => {
    const entregar = vi.fn();
    const produto = produtoComposto();
    await renderizarCard(produto, { onAddToCartWithVariants: entregar });
    await abrirFolha();
    await act(async () => chip("M").click());
    await renderizarCard(
      {
        ...produto,
        variants: produto.variants!.map((v) =>
          v.id === "azul-m" ? { ...v, stockIncrement: 0 } : v,
        ),
      },
      { onAddToCartWithVariants: entregar },
    );
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("true");
    expect(folha()!.textContent).toContain("M em Azul acabou agora.");
    await act(async () => ctaDaFolha().click());
    expect(entregar).not.toHaveBeenCalled();
  });

  it("compacta: um único tamanho continua esperando; Ver detalhes sai da folha uma vez", async () => {
    const navegar = vi.fn();
    await renderizarCard(criarProduto({ variants: [criarVariantes()[0]!] }), {
      onProductClick: navegar,
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    expect(ctaDaFolha().textContent).toContain("Escolha: Tamanho");
    const detalhes = Array.from(
      folha()!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.includes("Ver detalhes"))!;
    await act(async () => detalhes.click());
    expect(navegar.mock.calls).toEqual([["prod-caderno"]]);
    expect(folha()).toBeNull();
  });

  it("compacta: três eixos abrem um por vez e esperam até a última escolha", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      criarProduto({
        variants: [
          {
            ...criarVariantes()[0]!,
            name: "Cor / Tamanho / Manga",
            value: "Azul / M / Longa",
            priceOverride: 80,
          },
        ],
      }),
      { onAddToCartWithVariants: entregar },
    );
    await abrirFolha();
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("true");
    expect(linha("Manga").getAttribute("aria-expanded")).toBe("false");
    await act(async () => chip("M").click());
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("false");
    expect(linha("Manga").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(chip("Longa"));
    expect(ctaDaFolha().textContent).toContain("Escolha: Manga");
    expect(hospedeiro.textContent).toContain("50,00");
    await act(async () => chip("Longa").click());
    await act(async () => ctaDaFolha().click());
    expect(entregar.mock.calls[0].slice(1)).toEqual([
      "var-p",
      "Cor / Tamanho / Manga: Azul / M / Longa",
      1,
    ]);
  });

  it("compacta: só Cor pronta foca CTA; tocar cor marcada só recolhe mesmo com tamanho pendente", async () => {
    await renderizarCard(
      criarProduto({
        variants: [{ ...criarVariantes()[0]!, name: "Cor", value: "Azul" }],
      }),
      { onAddToCartWithVariants: vi.fn() },
    );
    await abrirFolha();
    expect(document.activeElement).toBe(ctaDaFolha());
    await act(async () => alcaDaFolha().click());
    await renderizarCard(produtoComposto(), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    await act(async () => linha("Cor").click());
    await act(async () => chip("Azul").click());
    expect(linha("Cor").getAttribute("aria-expanded")).toBe("false");
    expect(linha("Tamanho").getAttribute("aria-expanded")).toBe("false");
    expect(ctaDaFolha().textContent).toContain("Escolha: Tamanho");
  });

  it("compacta: nenhuma opção disponível mantém o card esgotado sem abrir a folha", async () => {
    const entregar = vi.fn();
    await renderizarCard(
      criarProduto({
        variants: criarVariantes().map((v) => ({ ...v, stockIncrement: 0 })),
      }),
      { onAddToCartWithVariants: entregar },
    );
    await abrirFolha();
    expect(botaoDeAcao().disabled).toBe(true);
    expect(botaoDeAcao().textContent).toContain("Esgotado");
    expect(folha()).toBeNull();
    expect(entregar).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("compacta: com Cor em segundo lugar, tamanho incompatível fica riscado mas permite trocar", async () => {
    await renderizarCard(
      criarProduto({
        variants: [
          {
            ...criarVariantes()[0]!,
            name: "Tamanho / Cor",
            value: "PP / Azul",
          },
          {
            ...criarVariantes()[1]!,
            name: "Tamanho / Cor",
            value: "M / Preto",
          },
        ],
      }),
      { onAddToCartWithVariants: vi.fn() },
    );
    await abrirFolha();
    expect(chip("M").disabled).toBe(false);
    expect(chip("M").className).toContain("line-through");
    expect(chip("PP").disabled).toBe(false);
  });

  it("compacta: sem foto mantém o quadrado com ícone, sem imagem vazia", async () => {
    await renderizarCard(
      criarProduto({ images: [], variants: criarVariantes() }),
      { onAddToCartWithVariants: vi.fn() },
    );
    await abrirFolha();
    const miniatura = folha()!.querySelector(
      '[data-testid="product-card-options-thumbnail"]',
    )!;
    expect(miniatura.querySelector("img")).toBeNull();
    expect(miniatura.querySelector("svg")).not.toBeNull();
  });

  it.each(
    [
      {
        nome: "Tamanho / Material",
        primeira: ["M", "Algodão"],
        segunda: ["G", "Poliéster"],
      },
      {
        nome: "Tonalidade / Tamanho",
        primeira: ["Clara", "M"],
        segunda: ["Escura", "G"],
      },
      {
        nome: "Cor / Tamanho / Material",
        primeira: ["Azul", "M", "Algodão"],
        segunda: ["Azul", "G", "Poliéster"],
      },
    ].flatMap((caso) =>
      caso.segunda.flatMap((valor, pivo) =>
        valor === caso.primeira.at(pivo) ? [] : [{ ...caso, pivo }],
      ),
    ),
  )(
    "troca sem saída: $nome permite chegar à outra combinação pelo eixo $pivo",
    async ({ nome, primeira, segunda, pivo }) => {
      const entregar = vi.fn();
      const produto = criarProduto({
        variants: [
          {
            ...criarVariantes()[0]!,
            id: "combinacao-a",
            name: nome,
            value: primeira.join(" / "),
            priceOverride: 60,
          },
          {
            ...criarVariantes()[1]!,
            id: "combinacao-b",
            name: nome,
            value: segunda.join(" / "),
            priceOverride: 80,
          },
        ],
      });
      const eixos = nome.split(" / ");
      await renderizarCard(produto, { onAddToCartWithVariants: entregar });
      await abrirFolha();
      for (const valor of primeira) {
        if (chip(valor).getAttribute("aria-pressed") !== "true")
          await act(async () => chip(valor).click());
      }
      expect(ctaDaFolha().textContent).toContain("60,00");
      // Não basta liberar só o primeiro eixo: a cliente pode trocar pelo último.
      for (const [indice, valor] of segunda.entries()) {
        if (valor === primeira.at(indice)) continue;
        await act(async () => linha(eixos.at(indice)!).click());
        expect(chip(valor).disabled).toBe(false);
        expect(chip(valor).className).toContain("line-through");
      }
      const linhaDaTroca = linha(eixos.at(pivo)!);
      if (linhaDaTroca.getAttribute("aria-expanded") !== "true") {
        await act(async () => linhaDaTroca.click());
      }
      await act(async () => chip(segunda.at(pivo)!).click());
      expect(entregar).not.toHaveBeenCalled();
      expect(ctaDaFolha().textContent).toContain("Escolha:");
      expect(folha()!.textContent).toContain("não tem em");
      for (const valor of segunda) {
        if (chip(valor).getAttribute("aria-pressed") !== "true")
          await act(async () => chip(valor).click());
      }
      await act(async () => ctaDaFolha().click());
      expect(entregar.mock.calls).toEqual([
        [produto, "combinacao-b", `${nome}: ${segunda.join(" / ")}`, 1],
      ]);
    },
  );

  it("troca sem saída: eixo único continua alternando e só estoque global zero desabilita", async () => {
    const entregar = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: entregar,
    });
    await abrirFolha();
    await act(async () => chip("M").click());
    await act(async () => linha("Tamanho").click());
    await act(async () => chip("M").click()); // Marcado recolhe, mas não aprisiona.
    await act(async () => linha("Tamanho").click());
    expect(chip("P").disabled).toBe(false);
    expect(chip("G").disabled).toBe(true);
    await act(async () => chip("P").click());
    await act(async () => ctaDaFolha().click());
    expect(entregar.mock.calls[0].slice(1)).toEqual(["var-p", "Tamanho: P", 1]);
  });

  it("troca sem saída: aviso não chama combinação inexistente de esgotada", async () => {
    await renderizarCard(produtoComposto(), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();
    await act(async () => linha("Cor").click());
    await act(async () => chip("Preto").click());
    expect(folha()!.textContent).toContain("Riscado = indisponível em Preto.");
    expect(folha()!.textContent).not.toContain("Riscado = esgotado");
    expect(chip("M").disabled).toBe(false);
    expect(chip("Verde").disabled).toBe(true); // Nenhuma combinação Verde tem estoque.
  });

  // Mesmos resultados literais conferidos no fluxo antigo de chips compostos.
  it.each([
    ["Azul / PP", "azul-pp", 60, 2],
    ["Azul / M", "azul-m", 75, 2],
    ["Verde / M", "verde-m", 0, 1],
  ] as const)(
    "equivalência antigo × novo no carrinho: %s",
    async (valor, id, preco, qtd) => {
      const entregar = vi.fn();
      const produto = criarProduto({
        variants: [
          {
            id: "azul-pp",
            productId: "prod-caderno",
            name: "Cor / Tamanho",
            value: "Azul / PP",
            stockIncrement: 5,
            priceOverride: 60,
            active: true,
          },
          {
            id: "azul-m",
            productId: "prod-caderno",
            name: "Cor / Tamanho",
            value: "Azul / M",
            stockIncrement: 3,
            priceOverride: 75,
            active: true,
          },
          {
            id: "verde-m",
            productId: "prod-caderno",
            name: "Cor / Tamanho",
            value: "Verde / M",
            stockIncrement: 1,
            priceOverride: 0,
            active: true,
          },
        ],
      });
      await renderizarCard(produto, { onAddToCartWithVariants: entregar });
      await abrirFolha();
      const [cor, tamanho] = valor.split(" / ");
      if (cor !== "Azul") {
        await act(async () => linha("Cor").click());
        await act(async () => chip(cor!).click());
      }
      await act(async () => chip(tamanho!).click());
      if (qtd === 2) await act(async () => botaoQuantidade("Aumentar").click());
      await act(async () => ctaDaFolha().click());
      expect(entregar.mock.calls).toEqual([
        [produto, id, `Cor / Tamanho: ${valor}`, qtd],
      ]);
      expect(hospedeiro.textContent).toContain(
        preco.toFixed(2).replace(".", ","),
      );
    },
  );

  // ── FECHAR PELA ALÇA (peça 03: pedido do dono ao vivo, 13/09) ──────────
  // Três caminhos: clicar na barrinha, arrastar a barrinha para baixo e
  // clicar fora (no véu). Ver cada caso pelo motivo.

  it("a alça é botão de verdade que anuncia 'Fechar (arraste para baixo)' — área de toque generosa, não só o risco de 4px", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    const alca = alcaDaFolha();
    expect(alca.tagName).toBe("BUTTON");
    // Peça 09 (14/09): o X embutido do SheetContent saiu desta folha — a
    // alça é o ÚNICO botão de fechar e carrega sozinha o anúncio de leitor
    // de tela (o "Fechar" simples que o X anunciava migrou para o nome dela,
    // que além de fechar nomeia o gesto).
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

  it("a folha de opções NÃO renderiza botão X dedicado — a alça é o único botão de fechar (peça 09)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    // O X embutido do SheetContent (sr-only "Close", aria-label "Fechar")
    // saiu DESTA folha — fechar é pela alça (clique/arrasto) ou clique fora.
    // Quem religar o X (default do base) derruba este it: o botão volta a
    // existir no DOM da folha.
    const botoes = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(botoes.find((b) => b.textContent === "Close")).toBeUndefined();
    expect(
      botoes.find((b) => b.getAttribute("aria-label") === "Fechar"),
    ).toBeUndefined();
    // E exatamente um botão anuncia fechar: a alça, com o gesto no nome.
    const queAnunciamFechar = botoes.filter((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Fechar"),
    );
    expect(queAnunciamFechar).toHaveLength(1);
    expect(queAnunciamFechar[0]).toBe(alcaDaFolha());
  });

  it("a folha de opções carrega border-t-0 — sem contorno no topo (peça 09; contrato textual: Tailwind não renderiza no jsdom)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    const folhaEl = document.querySelector(
      '[data-testid="product-card-options-sheet"]',
    );
    expect(folhaEl).not.toBeNull();
    expect(folhaEl!.className).toContain("border-t-0");
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

    // LIMPEZA do gesto: soltar devolve a folha ao lugar sem resquício —
    // sem transform inline (senão ela ficava deslocada para sempre) e com a
    // transição de volta ("" e nunca "none": é ela que anima abrir/fechar).
    const conteudo = document.querySelector<HTMLElement>(
      '[data-slot="sheet-content"]',
    )!;
    expect(conteudo.style.transform).toBe("");
    expect(conteudo.style.transition).toBe("");
  });

  it("pointercancel no meio do arrasto solta a alça: folha aberta, estilo restaurado, listeners removidos", async () => {
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
    });
    // A folha acompanhou o dedo...
    const conteudo = document.querySelector<HTMLElement>(
      '[data-slot="sheet-content"]',
    )!;
    expect(conteudo.style.transform).toBe("translateY(30px)");

    // ...até o sistema cancelar o gesto (rolagem assumida pelo navegador,
    // chamada interrompida). Cancelar NÃO é gesto de fechar — e tem de
    // limpar exatamente como o soltar limpa.
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("pointercancel", { bubbles: true, clientY: 0 }),
      );
    });

    expect(folha()).not.toBeNull();
    // Estilo restaurado — "" e não "none".
    expect(conteudo.style.transition).toBe("");
    expect(conteudo.style.transform).toBe("");
    // Listeners removidos: pointermove seguinte é INERTE.
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 400 }),
      );
    });
    expect(conteudo.style.transform).toBe("");
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

  it("TECLADO logo após REABRIR a folha fecha de primeira (a guarda movimentou não sobrevive ao reabrir)", async () => {
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onAddToCartWithVariants: vi.fn(),
    });
    await abrirFolha();

    // Arrasto que FECHA a folha (além de 64px): o marcador movimentou fica
    // true e, no desenho antigo, só o próximo pointerdown o limpa.
    await act(async () => {
      alcaDaFolha().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 200 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 190 }),
      );
    });
    expect(folha()).toBeNull();

    await abrirFolha();

    // Ativação por TECLADO: Enter/Espaço num <button> disparam click SEM
    // pointerdown. Com o marcador residual, o primeiro Enter era engolido
    // (não fazia nada) — só o segundo fechava.
    await act(async () => {
      alcaDaFolha().click();
    });
    expect(folha()).toBeNull();
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

  // ── CLICAR FORA TEM QUE SÓ FECHAR (14/09, relato do dono ao vivo) ────────
  // O MESMO clique que fecha a folha não pode ATINGIR o card de fundo: o
  // Radix desmonta a folha no pointerdown (e no toque, no próprio click),
  // e o click sintetizado do gesto cai no que ficou por baixo — o dono viu
  // o app NAVEGAR para o produto ao tentar só fechar. O guardião do clique
  // pós-fecho (sheet.tsx) engole esse click órfão. Estes dois casos são o
  // defeito do dono, ponta a ponta com o card de verdade (o spy da prop
  // onClick é o mesmo gatilho do pushState do App).

  // Gesto físico completo num botão: pointerdown + pointerup + click — é o
  // que TODO gesto real produz (e o que desarma o guardião de um fecho
  // anterior: nenhum click nasce sem pointerdown).
  async function gestoFisicoNo(elemento: HTMLElement) {
    await act(async () => {
      elemento.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      elemento.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      elemento.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }

  it("clique fora fecha a folha e NÃO navega: o card de fundo não recebe o click atravessado", async () => {
    const onProductClick = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
      onAddToCartWithVariants: vi.fn(),
    });
    await gestoFisicoNo(botaoDeAcao());
    expect(folha()).not.toBeNull();

    // Gesto real: pointerdown no véu fecha (Radix)...
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(folha()).toBeNull();

    // ...e o click do MESMO gesto cai no CARD (que ficou por baixo): o card
    // inteiro é clicável — é exatamente por aqui que o app navegava.
    const card = hospedeiro.firstElementChild as HTMLElement;
    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onProductClick).not.toHaveBeenCalled();
  });

  it("soltar o arrasto da alça FORA da folha não navega: o click pós-arrasto também morre", async () => {
    const onProductClick = vi.fn();
    await renderizarCard(criarProduto({ variants: criarVariantes() }), {
      onProductClick,
      onAddToCartWithVariants: vi.fn(),
    });
    await gestoFisicoNo(botaoDeAcao());
    expect(folha()).not.toBeNull();

    // Arrasto que fecha: dedo desce na ALÇA (dentro), passa de 64px e o
    // pointerup cai no CARD (fora da folha — é o que o browser faz: o
    // evento vai ao elemento sob o cursor). O click do soltar cai no card.
    await act(async () => {
      alcaDaFolha().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 200 }),
      );
      (hospedeiro.firstElementChild as HTMLElement).dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 190 }),
      );
    });
    expect(folha()).toBeNull();

    await act(async () => {
      (hospedeiro.firstElementChild as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onProductClick).not.toHaveBeenCalled();
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
