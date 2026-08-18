// @vitest-environment jsdom
//
// ADMIN-050 (#96) — o painel dizia "salvo" e não salvava.
//
// Causa-raiz, a mesma em dois formulários: o payload montava o campo vazio como
// `undefined`, e `undefined` some. No produto, `updateProduct` só copia o campo
// quando `updates.X !== undefined`; no cupom, o `JSON.stringify` do supabase-js
// descarta a chave antes de virar SQL. Nos dois casos o UPDATE saía sem a
// coluna, o banco mantinha o valor antigo — e a interface confirmava sucesso.
//
// O que a lojista via: desmarcava "Produto em Promoção", o app dizia "Salvo", e
// o preço riscado continuava na loja; reabria o formulário e a promoção estava
// marcada de novo. Não é bug de tela: é o painel afirmando um fato que não
// aconteceu, que é o jeito mais rápido de ela parar de confiar no app.
//
// A DISTINÇÃO QUE ESTA CORREÇÃO PRECISA PRESERVAR
//
// "não mexi neste campo" (a chave nem vem) tem de continuar diferente de
// "quero limpar este campo" (a chave vem vazia). Não é teoria: o interruptor
// da lista de cupons (AdminCouponsView.tsx:564) chama
// `updateCoupon(id, { active: checked })` — um patch com UMA chave. Se a
// correção mandasse `null` para tudo que está ausente, ligar/desligar um cupom
// apagaria código, valor, validade e limite de uso. Por isso o cupom passou a
// ser montado por presença de chave (`"campo" in updates`), não por valor.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
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

// Mesmo dublê de Select de admin-product-form-draft-e-duplo-clique.test.tsx:
// o Radix real exige ResizeObserver/PointerEvent para abrir em jsdom, e o que
// se mede aqui é o payload do submit, não o dropdown.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoEmPromocao = {
  id: "prod-96",
  name: "Blusa Teste",
  description: "Descrição da blusa",
  price: 80,
  costPrice: 30,
  originalPrice: 120,
  images: [],
  category: "Geral",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  sku: "BLU-01",
  createdAt: new Date(0).toISOString(),
  variants: [],
};

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminProductFormView — limpar campo persiste como null (#96)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoEmPromocao);
    updateProduct.mockResolvedValue(undefined);
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
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

  async function abrirProdutoEmPromocao() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView productId="prod-96" onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  async function salvar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("a âncora: o formulário abriu com a promoção marcada", async () => {
    // Sem isto, "desmarcar" no teste seguinte poderia estar marcando, e a
    // asserção passaria pelo motivo errado.
    await abrirProdutoEmPromocao();

    const marcador = document.getElementById(
      "product-promo-active",
    ) as HTMLInputElement;
    expect(marcador).toBeDefined();
    expect(marcador.checked).toBe(true);
  });

  it("desmarcar 'Produto em Promoção' manda originalPrice como null, não undefined", async () => {
    await abrirProdutoEmPromocao();

    const marcador = document.getElementById(
      "product-promo-active",
    ) as HTMLInputElement;
    await act(async () => {
      marcador.click();
    });

    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    const [, payload] = updateProduct.mock.calls[0];
    // `null` chega ao banco e apaga o preço riscado. `undefined` é descartado
    // pela guarda `!== undefined` do useProducts e o preço antigo sobrevive.
    expect(payload.originalPrice).toBeNull();
  });

  it("salvar sem mexer em nada NÃO apaga campo nenhum", async () => {
    // A outra metade do critério de aceite, e a regressão mais cara que esta
    // correção poderia causar: agora que campo vazio vira `null`, abrir um
    // produto e salvar sem tocar em nada NÃO pode zerar o que já estava lá.
    // Isso só é seguro porque o formulário carrega esses campos ao abrir
    // (AdminProductFormView, `productFields` do loadProduct) — se alguém parar
    // de carregar um deles, este teste fica vermelho antes de chegar na loja.
    await abrirProdutoEmPromocao();

    await salvar();

    expect(updateProduct).toHaveBeenCalledTimes(1);
    const [, payload] = updateProduct.mock.calls[0];
    expect(payload.originalPrice).toBe(120);
    expect(payload.costPrice).toBe(30);
    expect(payload.sku).toBe("BLU-01");
  });
});
