// @vitest-environment jsdom
//
// O PhoneSimulator e a previa do celular que a lojista ve no painel enquanto
// cadastra um produto -- e ele mostrava "Troca garantida em ate 24h", uma
// promessa que a pagina real do produto (ProductView.tsx) ja removeu, porque
// nao existe fluxo de troca ou devolucao neste app (issues #46 e #108 seguem
// abertas -- ver product-view-remove-troca-garantida.test.tsx). Previa que
// mente e pior que previa nenhuma: quem opera o painel decide o texto do
// produto olhando essa tela, acreditando que e o que o cliente vai ver.
//
// O selo de entrega tambem estava defasado ("Entrega local rapida"): a
// pagina real mostra "Entrega em {cidade}, {UF}" (condicional a cidade
// configurada) mais "Produto em estoque - Envio rapido".
//
// Montagem real (react-dom/client + jsdom). O componente faz createPortal
// para document.body, entao o conteudo verificado esta la, nao no host.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutável de propósito: o caso #571 reescreve `shippingCoverage` para
// "national" e o `beforeEach` repõe o padrão — guarda contra vazamento
// entre testes (mesma técnica de aviso-de-regiao-olha-a-cobertura.test.tsx).
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "local" as "national" | "local",
    storeCity: "Sao Paulo" as string | undefined,
    storeState: "SP" as string | undefined,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

// @ts-expect-error flag interna do React, sem tipo publico -- mesmo padrao
// de product-view-remove-troca-garantida.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const formDataBase = {
  name: "Produto de teste",
  description: "Descricao de teste",
  price: "100",
  costPrice: "50",
  originalPrice: "",
  stock: "10",
  category: "geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
};

describe("PhoneSimulator — a previa nao promete o que o app nao cumpre", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig.shippingCoverage = "local";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("nao mostra 'Troca garantida' e espelha o selo de entrega da pagina real", async () => {
    mockConfig.shippingCoverage = "local";
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataBase}
          previewMode="page"
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });

    expect(document.body.textContent).not.toContain("Troca garantida");
    expect(document.body.textContent).not.toContain("Entrega local rápida");
    // Os dois beneficios verdadeiros continuam de pe, iguais aos da pagina
    // real: entrega com a cidade da loja e estoque.
    expect(document.body.textContent).toContain("Entrega em Sao Paulo, SP");
    expect(document.body.textContent).toContain(
      "Produto em estoque - Envio rápido",
    );
  });

  it("loja com cobertura NACIONAL e cidade configurada nao mostra 'Entrega em' (#571)", async () => {
    // O caso da issue: a loja entrega para o Brasil todo; com a cidade na
    // identidade, a previa afirmava "Entrega em <cidade>" — mentira que a
    // lojista copiaria para o texto do produto.
    mockConfig.shippingCoverage = "national";
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataBase}
          previewMode="page"
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });

    expect(document.body.textContent).not.toContain("Entrega em");
    // O que sumiu foi SÓ o bloco de entrega — o estoque continua de pé.
    expect(document.body.textContent).toContain(
      "Produto em estoque - Envio rápido",
    );
  });

  it("o fundo do formulario fica FOSCO (veu translucido com blur) e a barra do simulador nítida", async () => {
    const { PhoneSimulator } = await import(
      "@/components/admin/PhoneSimulator"
    );

    await act(async () => {
      raiz.render(
        <PhoneSimulator
          onClose={() => {}}
          formData={formDataBase}
          previewMode="card"
          setPreviewMode={() => {}}
          previewImgIndex={0}
          setPreviewImgIndex={() => {}}
          previewSelectedVariants={{}}
          setPreviewSelectedVariants={() => {}}
          activeDetailTab="description"
          setActiveDetailTab={() => {}}
        />,
      );
    });

    // O véu que cobre o formulário é translúcido COM blur: o fundo fica
    // fosco (pedido do Gabriel, 02/09) — e não opaco como era antes.
    const veu = document.body.querySelector('div[class*="backdrop-blur-xl"]');
    expect(veu).toBeTruthy();
    expect(veu!.className).toContain("bg-zinc-950/70");
    expect(veu!.className).not.toContain("bg-zinc-950/98");

    // A barra superior do simulador é nítida sobre o véu (fundo quase
    // sólido), porque é o único comando que continua clicável.
    const barra = document.body.querySelector('div[class*="bg-zinc-950/85"]');
    expect(barra).toBeTruthy();
    expect(barra!.textContent).toContain("Simulador do Aplicativo");
  });
});
