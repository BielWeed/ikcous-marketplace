//
// Onda 1 do laudo de acessibilidade 05/09 (laudo em
// equipe/entregas/20260905-laudo-acessibilidade-loja.md, itens A1, M1, M2,
// M3, M4, M5, M6 e M8): "etiqueta e estado nos pontos de dinheiro e
// navegação". Este teste é o CONTRATO da onda — os atributos ARIA, anéis de
// foco, alvos de toque e tokens de cor que os consertos introduziram não
// podem sumir sem que alguém perceba.
//
// Por que lê FONTE e não renderiza os componentes: CheckoutView/ProductView/
// OrderDetailsView arrastam hooks, supabase e framer-motion (mesma decisão do
// acess-onda1-contrato.test.tsx da onda de 03/09, cujo padrão este arquivo
// espelha; o frete e o StarRating ganham testes de RENDER próprios —
// shipping-calculator-frete-falado.test.tsx e starrating-nota-falada.test.tsx).
//
// `import.meta.glob` com `?raw` lê os arquivos em tempo de build do vitest,
// sem API de Node — senão o typecheck (tsconfig sem "node" para tests/front)
// e o lint:ratchet reprovam.
import { describe, expect, it } from "vitest";

const FONTES_CUSTOMER = import.meta.glob<string>("/src/views/customer/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const FONTES_COMPONENTES = import.meta.glob<string>(
  "/src/components/ui/custom/*.tsx",
  { query: "?raw", import: "default", eager: true },
);

const FONTES: Record<string, string> = {
  ...FONTES_CUSTOMER,
  ...FONTES_COMPONENTES,
};

function fonte(caminho: string): string {
  expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
  return FONTES[caminho] as string;
}

const SHIPPING = "/src/components/ui/custom/ShippingCalculator.tsx";
const CATEGORY_FILTER = "/src/components/ui/custom/CategoryFilter.tsx";
const PRODUCT_VIEW = "/src/views/customer/ProductView.tsx";
const PROFILE_VIEW = "/src/views/customer/ProfileView.tsx";
const ACCOUNT_SETTINGS = "/src/views/customer/AccountSettingsView.tsx";
const COUPON_INPUT = "/src/components/ui/custom/CouponInput.tsx";
const HEADER = "/src/components/ui/custom/Header.tsx";
const CHECKOUT = "/src/views/customer/CheckoutView.tsx";
const SEARCH_BAR = "/src/components/ui/custom/SearchBar.tsx";
const SEARCH_VIEW = "/src/views/customer/SearchView.tsx";
const ORDER_DETAILS = "/src/views/customer/OrderDetailsView.tsx";
const STAR_RATING = "/src/components/ui/custom/StarRating.tsx";
const BOTTOM_NAV = "/src/components/ui/custom/BottomNav.tsx";

describe("o glob casou os 13 arquivos da onda (nada de prova vazia)", () => {
  const esperados = [
    SHIPPING,
    CATEGORY_FILTER,
    PRODUCT_VIEW,
    PROFILE_VIEW,
    ACCOUNT_SETTINGS,
    COUPON_INPUT,
    HEADER,
    CHECKOUT,
    SEARCH_BAR,
    SEARCH_VIEW,
    ORDER_DETAILS,
    STAR_RATING,
    BOTTOM_NAV,
  ];
  it("os 13 fontes existem no glob", () => {
    for (const caminho of esperados) {
      expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
    }
  });
});

describe("A1 — frete: a opção escolhida é anunciada (ALTA)", () => {
  it("cada opção PAC/SEDEX/GRÁTIS carrega o estado de selecionada", () => {
    const src = fonte(SHIPPING);
    // Mesmo padrão que a onda 1 (03/09) aplicou às variantes do produto.
    expect(src).toContain("aria-pressed={isSelected}");
  });
});

describe("M1 — frete: erro da cotação é anunciado", () => {
  it("o bloco de erro do frete tem role=alert", () => {
    const src = fonte(SHIPPING);
    expect(src).toContain('role="alert"');
  });
});

describe("M2 — frete: campo de CEP com nome", () => {
  it("o input de CEP tem aria-label próprio", () => {
    const src = fonte(SHIPPING);
    expect(src).toContain('aria-label="CEP de destino"');
  });
});

describe("M3 — anel de foco reposto nos 11 pontos que apagavam", () => {
  // O par (espessura + cor) é o que o anel visível precisa; a posição na
  // string segue a ordem canônica do eslint-plugin-tailwindcss (a casa roda
  // eslint --fix, que reordena classes — o par permanece contíguo).
  const CAMINHO_ANEL = "focus-visible:ring-2 focus-visible:ring-zinc-900/50";
  const pontos: Array<[string, string, number]> = [
    ["chips de categoria da vitrine", CATEGORY_FILTER, 1],
    ["abas Detalhes/Avaliações/Perguntas", PRODUCT_VIEW, 1],
    ["abas do modal de avatar do perfil", PROFILE_VIEW, 2],
    ["abas Perfil/Segurança e do modal de avatar", ACCOUNT_SETTINGS, 4],
    ["campo de cupom", COUPON_INPUT, 1],
    ["logo do cabeçalho", HEADER, 1],
    ["painel de resumo do pedido no checkout", CHECKOUT, 1],
  ];

  it("todos os 11 pontos têm anel visível para teclado", () => {
    for (const [nome, caminho, esperado] of pontos) {
      const src = fonte(caminho);
      const quantidade = src.split(CAMINHO_ANEL).length - 1;
      expect(
        quantidade,
        `${nome} (${caminho}): esperado ${esperado} anel(is), achei ${quantidade}`,
      ).toBeGreaterThanOrEqual(esperado);
    }
  });

  it("o override que apagava o anel global nos pontos de aba morreu", () => {
    // `focus:outline-none` tem especificidade MAIOR que o :focus-visible
    // global (index.css) e era o que de fato apagava o anel nas abas — não
    // pode voltar. (ProfileView:378/AccountSettingsView:558 são o avatar,
    // que JÁ repõe com focus:ring-2 próprio — fora do laudo.)
    expect(fonte(PROFILE_VIEW)).not.toContain(
      "transition-all focus:outline-none",
    );
    expect(fonte(ACCOUNT_SETTINGS)).not.toContain(
      "transition-all focus:outline-none",
    );
    // O campo de cupom idem: apagava com `focus:outline-none` puro.
    expect(fonte(COUPON_INPUT)).not.toContain("focus:outline-none");
  });
});

describe("M4 — alvos de toque ampliados sem mudar o visual", () => {
  it("bolinhas da galeria (4px) ganham área >= 24px via pseudo-elemento", () => {
    const src = fonte(PRODUCT_VIEW);
    expect(src).toContain("after:-inset-2.5");
  });

  it("setas da galeria (32px) ganham área de 44px", () => {
    const src = fonte(PRODUCT_VIEW);
    expect(src).toContain("after:-inset-1.5");
  });

  it("X de limpar a busca (20px) ganha área via pseudo-elemento", () => {
    const src = fonte(SEARCH_BAR);
    expect(src).toContain("after:-inset-2");
  });
});

describe("M5 — três botões de ícone com nome", () => {
  it("WhatsApp do pedido, voltar da busca e fechar avaliação", () => {
    expect(fonte(ORDER_DETAILS)).toContain(
      'aria-label="Falar com a loja no WhatsApp"',
    );
    expect(fonte(SEARCH_VIEW)).toContain('aria-label="Voltar"');
    expect(fonte(ORDER_DETAILS)).toContain('aria-label="Fechar avaliação"');
  });
});

describe("M6 — classes de cor inexistentes zeradas na loja do cliente", () => {
  // zinc-505/550/650/905/150 e red-655 não existem no Tailwind: a cor
  // NUNCA aplicava e o elemento herdava outra — o CANCELAR PEDIDO perdeu o
  // vermelho de ação destrutiva. Teste de substring crua: se voltar em
  // className OU em comentário, alguém precisa rever este arquivo.
  const tokensMortos = [
    "zinc-505",
    "zinc-550",
    "red-655",
    "zinc-650",
    "zinc-905",
    "zinc-150",
  ];

  it("nenhum token morto sobra nas telas de pedido e produto", () => {
    for (const token of tokensMortos) {
      expect(fonte(ORDER_DETAILS), token).not.toContain(token);
      expect(fonte(PRODUCT_VIEW), token).not.toContain(token);
    }
  });

  it("o botão de CANCELAR PEDIDO é vermelho de novo (token real)", () => {
    expect(fonte(ORDER_DETAILS)).toContain("text-red-600");
  });
});

describe("M8 — nota falada nas estrelas e aba atual anunciada", () => {
  it("StarRating resolve no componente: sr-only com a nota + estrelas mudas", () => {
    const src = fonte(STAR_RATING);
    expect(src).toContain("sr-only");
    expect(src).toContain("notaFalada");
    expect(src).toContain('aria-hidden="true"');
  });

  it("BottomNav marca a aba ativa com aria-current", () => {
    const src = fonte(BOTTOM_NAV);
    expect(src).toContain('aria-current={isActive ? "page" : undefined}');
  });
});
