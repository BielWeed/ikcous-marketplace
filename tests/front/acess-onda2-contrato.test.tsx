//
// Onda 2 do laudo de acessibilidade da LOJA (03/09 — laudo em
// equipe/entregas/laudo-acessibilidade-loja-0309.md, achados 9 e 12):
// "avisar o que muda na tela". Este teste é o CONTRATO da onda — cupom
// recusado, frete pendente e "carregando" viram anúncio de leitor de tela
// (role="alert"/role="status"), e esses atributos não podem sumir sem que
// alguém perceba.
//
// Por que lê FONTE e não renderiza os componentes: CheckoutView/HomeView
// arrastam hooks, supabase e framer-motion (mesma decisão da
// acess-onda1-contrato.test.tsx, cujo padrão este arquivo espelha). O que
// se prova aqui é a marcação — anúncio e classes originais preservadas
// (trava do dono: NADA muda de visual para quem usa o dedo).
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
const HOME = "/src/views/customer/HomeView.tsx";
const COUPON_INPUT = "/src/components/ui/custom/CouponInput.tsx";
const PRODUCT_LIST = "/src/components/ui/custom/ProductList.tsx";
const PRODUCT_CARD_SKELETON =
  "/src/components/ui/custom/ProductCardSkeleton.tsx";
const CATEGORY_FILTER = "/src/components/ui/custom/CategoryFilter.tsx";

describe("o glob casou os 6 arquivos da onda 2 (nada de prova vazia)", () => {
  const esperados = [
    CHECKOUT,
    HOME,
    COUPON_INPUT,
    PRODUCT_LIST,
    PRODUCT_CARD_SKELETON,
    CATEGORY_FILTER,
  ];
  it("os 6 fontes existem no glob", () => {
    for (const caminho of esperados) {
      expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
    }
  });
});

describe("achado 9 — recusas anunciadas: cupom e frete pendente", () => {
  it("erro do cupom é role=alert e o input se declara inválido, ligado à mensagem", () => {
    const src = fonte(COUPON_INPUT);
    // O `<p>` do erro ganha id e role="alert" — o mesmo tratamento da
    // recusa do pedido (SaidaDaRecusa.tsx:82), padrão da casa.
    expect(src).toMatch(/<p\s+id="erro-cupom"\s+role="alert"/);
    // Enquanto houver erro, o input se declara inválido e aponta a mensagem.
    expect(src).toContain("aria-invalid={error ? true : undefined}");
    expect(src).toContain(
      'aria-describedby={error ? "erro-cupom" : undefined}',
    );
  });

  it("classes originais do cupom preservadas (nada de visual mudou)", () => {
    const src = fonte(COUPON_INPUT);
    expect(src).toContain(
      'className="flex-1 bg-transparent text-sm focus:outline-none"',
    );
    expect(src).toContain(
      'className="flex items-center gap-1 text-xs text-red-500"',
    );
  });

  it("aviso de frete pendente na barra do checkout é role=alert", () => {
    const src = fonte(CHECKOUT);
    expect(src).toMatch(/<p\s+role="alert"\s+className="mx-auto mt-1\.5/);
  });
});

describe("achado 12 — carregando em silêncio: skeletons viram status", () => {
  it("o grid de skeletons da vitrine é UMA região de status", () => {
    const src = fonte(PRODUCT_LIST);
    expect(src).toMatch(
      /<div\s+role="status"\s+className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"/,
    );
    expect(src).toContain("Carregando produtos");
    expect(src).toContain('className="sr-only"');
    // Classes originais do grid preservadas.
    expect(src).toContain(
      'className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"',
    );
  });

  it("o skeleton do card em si NÃO é região de status (ajuste do revisor: 8 cópias = 8 falas)", () => {
    const src = fonte(PRODUCT_CARD_SKELETON);
    // O componente nunca renderiza sozinho — a região única mora no
    // ProductList. Aqui, NENHUM aria-live repetido.
    expect(src).not.toMatch(/role="status"/);
    expect(src).not.toContain("sr-only");
    // E o arquivo voltou ao estado da base: classes byte-idênticas.
    expect(src).toContain(
      'className="flex h-full flex-1 flex-col gap-0.5 overflow-hidden rounded-[2rem] border border-zinc-200/60 bg-zinc-50/30 p-2.5"',
    );
  });

  it("skeleton do banner da home anuncia Carregando banners", () => {
    const src = fonte(HOME);
    expect(src).toMatch(
      /<div\s+role="status"\s+className="mb-2 flex h-\[200px\] w-full animate-pulse items-center justify-center bg-zinc-100 sm:h-\[400px\]"/,
    );
    expect(src).toContain("Carregando banners");
  });

  it("sincronização de endereços do checkout é região status", () => {
    const src = fonte(CHECKOUT);
    expect(src).toMatch(
      /<div\s+role="status"\s+className="flex min-h-\[112px\] flex-col items-center justify-center py-8"/,
    );
    expect(src).toContain("Carregando endereços");
    // O texto visível continua lá, intacto.
    expect(src).toContain("Sincronizando endereços...");
  });

  it("skeleton do filtro de categorias anuncia Carregando categorias", () => {
    const src = fonte(CATEGORY_FILTER);
    expect(src).toMatch(
      /<div\s+role="status"\s+className="sticky top-\[72px\] z-40 border-b border-gray-100 bg-white"/,
    );
    expect(src).toContain("Carregando categorias");
    // SÓ o skeleton muda — o filtro real fica intocado (aria-pressed da
    // onda anterior continua lá).
    expect(src).toContain("aria-pressed={isActive}");
  });
});
