// @vitest-environment jsdom
//
// Vitrines (lote 203): o nome não pode ficar vazio, os toques não somem em
// silêncio durante uma gravação, e os alvos pequenos têm 44 px.
// O jsdom não mede largura nem altura: aqui vale a classe que GERA a medida;
// só o navegador prova o pixel.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: () => <div data-testid="cartao" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaEditarVitrine } = await import(
  "@/components/admin/vitrines/FolhaEditarVitrine"
);
const { ProductCarousel } = await import(
  "@/components/ui/custom/ProductCarousel"
);

const SECAO = {
  id: "custom_1",
  title: "Kits de presente",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: true,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const aoRenomear = vi.fn(async (_titulo: string) => true);

async function abrirFolha(extra: { travado?: boolean } = {}) {
  await act(async () => {
    raiz.render(
      <FolhaEditarVitrine
        secao={SECAO}
        posicao={1}
        produtos={[]}
        idsEmExibicao={[]}
        aoFechar={() => {}}
        aoRenomear={aoRenomear}
        aoMudarQuantidade={() => {}}
        aoAlternarProduto={() => {}}
        aoVoltarAoAutomatico={() => {}}
        aoEscolherManualmente={() => {}}
        {...extra}
      />,
    );
  });
}

const campoNome = () =>
  document.querySelector<HTMLInputElement>(
    'input[name="title"]',
  ) as HTMLInputElement;

async function digitarENaoSair(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    campoNome().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(campoNome(), texto);
    campoNome().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const sairDoCampo = () =>
  act(async () => {
    campoNome().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

describe("Folha de editar vitrine: nome vazio", () => {
  for (const texto of ["", "   "]) {
    it(`sair do campo com ${JSON.stringify(texto)} avisa, não grava e devolve o nome anterior`, async () => {
      await abrirFolha();
      await digitarENaoSair(texto);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300)); // passa o debounce
      });
      expect(aoRenomear).not.toHaveBeenCalled();

      await sairDoCampo();
      expect(toast.error).toHaveBeenCalledWith(
        "Informe um título para a vitrine",
      );
      expect(aoRenomear).not.toHaveBeenCalled();
      expect(campoNome().value).toBe("Kits de presente");
    });
  }

  it("um nome novo e válido continua sendo gravado", async () => {
    await abrirFolha();
    await digitarENaoSair("Presentes");
    await sairDoCampo();
    expect(aoRenomear).toHaveBeenCalledWith("Presentes");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Folha de editar vitrine: gravação em andamento", () => {
  it("quantidade e Automático/Escolher ficam desligados enquanto outra gravação corre", async () => {
    await abrirFolha({ travado: true });
    const botoes = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const alvo = botoes.filter((b) =>
      ["4", "6", "8", "10", "12", "Automático", "Escolher"].includes(
        b.textContent?.trim() ?? "",
      ),
    );
    expect(alvo.length).toBeGreaterThan(5);
    for (const b of alvo) expect(b.disabled).toBe(true);
  });

  it("sem gravação, os mesmos botões ficam ligados", async () => {
    await abrirFolha();
    const botoes = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const seis = botoes.find((b) => b.textContent?.trim() === "6");
    expect(seis?.disabled).toBe(false);
  });
});

describe("Folha de editar vitrine: Limpar busca", () => {
  it("o X de limpar a busca tem área de toque de 44 px", async () => {
    await abrirFolha();
    const busca = document.querySelector<HTMLInputElement>(
      '[aria-label="Buscar produto"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(busca, "perfume");
      busca.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const limpar = document.querySelector<HTMLButtonElement>(
      '[aria-label="Limpar busca"]',
    );
    expect(limpar?.className).toContain("size-11");
  });
});

describe("Vitrine na loja: título", () => {
  const produto = { id: "p1", name: "A", price: 1, images: [] } as never;
  async function mostrar(title: string) {
    await act(async () => {
      raiz.render(
        <ProductCarousel
          title={title}
          products={[produto]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });
  }

  it("título vazio ou só espaços não desenha um <h2> vazio", async () => {
    await mostrar("   ");
    expect(document.querySelector("h2")).toBeNull();
  });

  it("título gigante sem espaço quebra a palavra em vez de vazar", async () => {
    await mostrar("Promocaoooooooooooooooooooooooooooooooooooo");
    const h2 = document.querySelector("h2");
    expect(h2?.textContent).toContain("Promocaoooo");
    expect(h2?.className).toContain("break-words");
  });
});
