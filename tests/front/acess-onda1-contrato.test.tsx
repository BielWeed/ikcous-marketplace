//
// Onda 1 do laudo de acessibilidade da LOJA (03/09 — laudo em
// equipe/entregas/laudo-acessibilidade-loja-0309.md, achados 1, 2, 3, 5 e 6):
// "dar nome e estado ao que a compra precisa". Este teste é o CONTRATO da
// onda — os atributos ARIA que os consertos introduziram não podem sumir
// sem que alguém perceba.
//
// Por que lê FONTE e não renderiza os componentes: CheckoutView/ProductView
// arrastam hooks, supabase e framer-motion (mesma decisão do
// admin-visual-telas-titulo-padronizado.test.tsx, cujo padrão este arquivo
// espelha). O que se prova aqui é a marcação — rótulo, estado e anúncio.
//
// `import.meta.glob` com `?raw` lê os arquivos em tempo de build do vitest,
// sem API de Node — senão o typecheck (tsconfig sem "node" para tests/front)
// e o lint:ratchet reprovam (lição já escrita na âncora do teste admin).
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

const CHECKOUT = "/src/views/customer/CheckoutView.tsx";
const PRODUCT_VIEW = "/src/views/customer/ProductView.tsx";
const COUPON_INPUT = "/src/components/ui/custom/CouponInput.tsx";
const PRODUCT_CARD = "/src/components/ui/custom/ProductCard.tsx";
const BOTTOM_NAV = "/src/components/ui/custom/BottomNav.tsx";
const HEADER = "/src/components/ui/custom/Header.tsx";
const QUANTITY_SELECTOR =
  "/src/components/ui/custom/QuantitySelector.tsx";

describe("o glob casou os 7 arquivos da onda 1 (nada de prova vazia)", () => {
  const esperados = [
    CHECKOUT,
    PRODUCT_VIEW,
    COUPON_INPUT,
    PRODUCT_CARD,
    BOTTOM_NAV,
    HEADER,
    QUANTITY_SELECTOR,
  ];
  it("os 7 fontes existem no glob", () => {
    for (const caminho of esperados) {
      expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
    }
  });
});

describe("achado 1 — checkout: erro de preenchimento marcado e anunciado", () => {
  it("cada campo com mensagem tem aria-invalid e aria-describedby", () => {
    const src = fonte(CHECKOUT);
    // Os 6 campos que renderizam mensagem de erro precisam estar marcados e
    // ligados ao `<p>` do erro pelo id.
    const campos = [
      "name",
      "whatsapp",
      "cep",
      "number",
      "street",
      "neighborhood",
    ];
    for (const campo of campos) {
      expect(
        src,
        `campo ${campo} sem aria-invalid`,
      ).toContain(`form.formState.errors.${campo} ? true : undefined`);
      expect(
        src,
        `campo ${campo} sem aria-describedby apontando a mensagem`,
      ).toContain(`form.formState.errors.${campo}`);
    }
    for (const id of [
      "erro-checkout-name",
      "erro-checkout-tel",
      "erro-guest-cep",
      "erro-guest-number",
      "erro-guest-street",
      "erro-guest-neighborhood",
    ]) {
      expect(src, `mensagem de erro sem id ${id}`).toContain(`id="${id}"`);
    }
    // Cidade e Estado não têm `<p>` de erro, mas o schema os recusa para
    // convidado — o campo fica marcado e o foco anuncia.
    expect(src).toContain("form.formState.errors.city ? true : undefined");
    expect(src).toContain("form.formState.errors.state ? true : undefined");
  });

  it("a recusa por preenchimento leva o foco ao primeiro campo com erro", () => {
    const src = fonte(CHECKOUT);
    expect(src).toContain("ORDEM_CAMPOS_FOCO");
    expect(src).toContain("form.setFocus(primeiroErro)");
  });
});

describe("achado 2 — página de produto e cupom: botões de ícone com nome", () => {
  it("galeria do produto: setas e bolinhas nomeadas, bolinha atual marcada", () => {
    const src = fonte(PRODUCT_VIEW);
    expect(src).toContain('aria-label="Foto anterior"');
    expect(src).toContain('aria-label="Próxima foto"');
    expect(src).toContain("aria-label={`Foto ${index + 1} de");
    expect(src).toContain('aria-current={index === currentImageIndex');
  });

  it("coração de favoritar nomeado nos dois estados", () => {
    const src = fonte(PRODUCT_VIEW);
    expect(src).toContain('"Adicionar aos favoritos"');
    expect(src).toContain('"Remover dos favoritos"');
  });

  it("X do cupom aplicado diz Remover cupom", () => {
    const src = fonte(COUPON_INPUT);
    expect(src).toContain('aria-label="Remover cupom"');
  });
});

describe("achado 3 — escolha marcada: variantes e meio de pagamento", () => {
  it("variantes da página de produto usam aria-pressed", () => {
    const src = fonte(PRODUCT_VIEW);
    expect(src).toContain("aria-pressed={isSelected}");
  });

  it("variantes do card usam aria-pressed", () => {
    const src = fonte(PRODUCT_CARD);
    expect(src).toContain("aria-pressed={ativa}");
  });

  it("meios de pagamento são radiogroup com radio e aria-checked", () => {
    const src = fonte(CHECKOUT);
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('aria-label="Meio de pagamento"');
    expect(src).toContain('role="radio"');
    expect(src).toContain("aria-checked={isSelected && !bloqueadaPorFaltaDeConta}");
  });
});

describe("achado 5 — contadores com a contagem no nome", () => {
  it("BottomNav anuncia Carrinho/Favoritos com o número da bolinha", () => {
    const src = fonte(BOTTOM_NAV);
    expect(src).toContain("aria-label={");
    expect(src).toContain("${item.label}, ${item.badge}");
  });

  it("Header anuncia notificações não lidas", () => {
    const src = fonte(HEADER);
    expect(src).toContain("`Notificações, ${unreadCount}");
  });
});

describe("achado 6 — quantidade anunciada entre − e +", () => {
  it("QuantitySelector tem região live no número", () => {
    const src = fonte(QUANTITY_SELECTOR);
    expect(src).toContain('aria-live="polite"');
  });
});
