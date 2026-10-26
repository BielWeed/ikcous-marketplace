// @vitest-environment jsdom
//
// Defeito medido: a foto PRINCIPAL é sempre a primeira, mas cada foto só tinha
// "recortar" e "excluir". Para a foto 3 virar a principal a lojista tinha de
// excluir a 1 e a 2 e reenviar. Agora, toda foto que NÃO é a primeira ganha o
// botão "Tornar principal", que a leva para a primeira posição e mantém a
// ordem das outras.
//
// Contrato provado aqui:
//   1. Só as fotos 2 em diante têm o botão (a principal não; foto que ainda
//      está subindo — o cartão "Enviando…" — também não).
//   2. Tornar a 3ª principal deixa a ordem [3, 1, 2] na tela.
//   3. O que o "Publicar" grava vai nessa mesma ordem (a primeira é a capa).
//   4. A foto que virou principal passa a mostrar a marca "Principal".
//
// Mesmo padrão de admin-product-form-fotos-e-grade-nao-travam-o-publicar.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(true),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: mocks.uploadProductImages,
    fetchProduct: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO_A = "https://cdn/a.jpg";
const FOTO_B = "https://cdn/b.jpg";
const FOTO_C = "https://cdn/c.jpg";

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  escolherCategoriaDoProduto(valor);
}

function escolherFotos(arquivos: File[]) {
  const input = document.getElementById(
    "product-image-upload",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: arquivos,
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const foto = (nome: string) =>
  new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });

/** Os botões "Tornar principal" na tela: só a foto EM FOCO tem as ações dela. */
const botoesTornarPrincipal = () => [
  ...document.body.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="Tornar principal"]',
  ),
];

/** Toca na miniatura N (1 = a primeira) da faixa: a foto N entra em foco. */
async function focarFoto(n: number) {
  const miniaturas = [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Galeria de fotos do produto"] button[aria-pressed]',
    ),
  ];
  await act(async () => {
    miniaturas[n - 1].click();
  });
}

/** O botão que cada foto de 1 a `total` oferece ao entrar em foco. */
async function rotulosDeCadaFoto(total: number) {
  const achados: string[][] = [];
  for (let n = 1; n <= total; n++) {
    await focarFoto(n);
    achados.push(
      botoesTornarPrincipal().map((b) => b.getAttribute("aria-label") ?? ""),
    );
  }
  return achados;
}

/** As fotos do produto na tela, na ordem do carrossel. */
const fotosNaTela = () =>
  [
    ...document.body.querySelectorAll(
      '[aria-label="Galeria de fotos do produto"] img',
    ),
  ]
    .map((i) => i.getAttribute("src"))
    .filter((src): src is string => !!src && src.startsWith("https://cdn/"));

describe("AdminProductFormView — tornar uma foto a principal", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.rpc.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
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
    vi.restoreAllMocks();
  });

  /** Produto novo, preenchido, com as fotos A, B e C já enviadas. */
  async function montarComTresFotos() {
    mocks.uploadProductImages
      .mockResolvedValueOnce([FOTO_A])
      .mockResolvedValueOnce([FOTO_B])
      .mockResolvedValueOnce([FOTO_C]);
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      digitar("product-name", "Camiseta");
      digitarTextarea("product-description", "Algodão");
      digitar("product-sale-price", "5000");
      digitar("product-stock", "3");
      selecionarCategoria("Geral");
      await new Promise((r) => setTimeout(r, 300));
    });
    await act(async () => {
      escolherFotos([foto("a.jpg"), foto("b.jpg"), foto("c.jpg")]);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("só as fotos 2 em diante têm o botão — a principal não tem", async () => {
    await montarComTresFotos();

    expect(fotosNaTela()).toEqual([FOTO_A, FOTO_B, FOTO_C]);
    // A principal (em foco ao abrir) não tem o botão; as outras ganham o delas
    // ao entrar em foco.
    expect(await rotulosDeCadaFoto(3)).toEqual([
      [],
      ["Tornar principal: foto 2 de 3"],
      ["Tornar principal: foto 3 de 3"],
    ]);
    // Alvo de toque confortável no celular, igual aos outros botões da foto.
    await focarFoto(3);
    for (const b of botoesTornarPrincipal())
      expect(b.className).toContain("min-h-11");
  });

  it("tornar a 3ª principal deixa a ordem [3, 1, 2] e Publicar grava nessa ordem", async () => {
    await montarComTresFotos();

    await focarFoto(3);
    await act(async () => {
      botoesTornarPrincipal()[0].click();
    });

    expect(fotosNaTela()).toEqual([FOTO_C, FOTO_A, FOTO_B]);
    expect(
      document
        .querySelector('[data-testid="resumo-do-produto"] img')
        ?.getAttribute("src"),
    ).toBe(FOTO_C);
    // A marca "Principal" acompanha a foto que virou capa: só uma na tela.
    const marcas = [...document.body.querySelectorAll("div")].filter(
      (d) => d.children.length === 0 && d.textContent === "Principal",
    );
    expect(marcas).toHaveLength(1);
    // E a nova capa já não oferece o botão; as outras duas oferecem.
    expect(await rotulosDeCadaFoto(3)).toEqual([
      [],
      ["Tornar principal: foto 2 de 3"],
      ["Tornar principal: foto 3 de 3"],
    ]);

    const publicar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Publicar"),
    ) as HTMLButtonElement;
    await act(async () => {
      publicar.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mocks.addProduct).toHaveBeenCalledTimes(1);
    expect(mocks.addProduct.mock.calls[0][0].images).toEqual([
      FOTO_C,
      FOTO_A,
      FOTO_B,
    ]);
  });

  it("foto que ainda está subindo não ganha o botão", async () => {
    await montarComTresFotos();
    mocks.uploadProductImages.mockImplementation(
      () => new Promise<string[]>(() => {}),
    );

    await act(async () => {
      escolherFotos([foto("d.jpg")]);
    });

    // O cartão "Enviando…" aparece, mas só B e C (já enviadas) têm o botão; a
    // que está subindo não tem miniatura nem botão (só 3 fotos na faixa).
    expect(document.body.textContent).toMatch(/Enviando|Comprimindo/);
    expect(await rotulosDeCadaFoto(3)).toEqual([
      [],
      ["Tornar principal: foto 2 de 3"],
      ["Tornar principal: foto 3 de 3"],
    ]);
    expect(
      document.body.querySelectorAll(
        '[aria-label="Galeria de fotos do produto"] button[aria-pressed]',
      ),
    ).toHaveLength(3);
  });
});
