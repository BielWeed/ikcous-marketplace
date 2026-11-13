// @vitest-environment jsdom
// Aparelho 1 exclui a variação M (desligada, sem peças) e não salva; o
// aparelho 2 liga M com 10 peças e salva. O salvar do aparelho 1 é recusado
// pela versão; o segundo clique (reação natural) NÃO pode apagar M sem a
// lojista ter visto a mudança. A que ninguém mexeu segue sendo excluída.
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const salvarProdutoComGrade = vi.fn();
const avisoAmarelo = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    salvarProdutoComGrade,
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
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
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: (...args: unknown[]) => avisoAmarelo(...args),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variacao = (
  id: string,
  value: string,
  stockIncrement: number,
  active = true,
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value,
  stockIncrement,
  active,
});
type Variacao = ReturnType<typeof variacao>;
const A = variacao("va", "A", 2);
const B = variacao("vb", "B", 3);
const MDesligada = variacao("vm", "M", 0, false);
const MLigadaCom10 = variacao("vm", "M", 10, true);
const MSoLigada = variacao("vm", "M", 0, true);
const produto = (variants: Variacao[]) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: variants
    .filter((v) => v.active)
    .reduce((soma, v) => soma + v.stockIncrement, 0),
  sold: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
const botaoPorTexto = (texto: string) => {
  const botao = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  expect(botao).toBeDefined();
  return botao as HTMLButtonElement;
};
async function salvar() {
  await act(async () => {
    const botao = botaoPorTexto("Salvar alterações");
    expect(botao.disabled).toBe(false);
    botao.click();
    await new Promise((r) => setTimeout(r, 50));
  });
}
const gradeNaTela = () =>
  [...hospedeiro.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (linha) => linha.textContent?.trim(),
  );
const idsApagadosNaChamada = (n: number) =>
  salvarProdutoComGrade.mock.calls.at(n)?.[2].apagar;

async function abrirEExcluir(abertura: Variacao[], valores: string[]) {
  fetchProduct.mockResolvedValue(produto(abertura));
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <AdminProductFormView
        productId="p-1"
        userId="lojista-1"
        onNavigate={vi.fn()}
        onSetDirty={vi.fn()}
      />,
    );
  });
  for (const valor of valores) {
    await act(async () => {
      const excluir = hospedeiro.querySelector<HTMLButtonElement>(
        `[aria-label="Excluir variação ${valor}"]`,
      );
      expect(excluir).not.toBeNull();
      excluir!.click();
    });
    await act(async () => botaoPorTexto("Excluir Variante").click());
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => armazem.set(k, v),
    removeItem: (k: string) => armazem.delete(k),
  });
  salvarProdutoComGrade.mockResolvedValue({
    produto: undefined,
    recusadas: [],
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("M excluída que o outro aparelho ligou com 10 peças volta à lista e o segundo salvar não a apaga", async () => {
  await abrirEExcluir([A, MDesligada], ["M"]);
  expect(gradeNaTela()).toEqual(["Cor: A"]);

  salvarProdutoComGrade.mockRejectedValueOnce({
    produtoAtual: produto([A, MLigadaCom10]),
  });
  await salvar();
  expect(idsApagadosNaChamada(0)).toEqual(["vm"]);

  // Ela volta, com o estoque novo, e o aviso diz qual voltou.
  expect(gradeNaTela()).toHaveLength(2);
  expect(gradeNaTela()[1]).toContain("Cor: M");
  expect(
    (document.getElementById("product-stock") as HTMLInputElement).value,
  ).toBe("12");
  expect(avisoAmarelo).toHaveBeenCalledTimes(1);
  expect(avisoAmarelo.mock.calls[0]?.[0]).toContain("Cor: M");
  expect(avisoAmarelo.mock.calls[0]?.[0]).toContain("outro aparelho");

  // O segundo clique não leva "vm" na lista de exclusões.
  await salvar();
  expect(salvarProdutoComGrade).toHaveBeenCalledTimes(2);
  expect(idsApagadosNaChamada(1)).toEqual([]);
  expect(gradeNaTela()).toHaveLength(2);
});

it("caso misto: M mudou (só foi ligada) e volta; B ninguém mexeu e continua sendo apagada", async () => {
  await abrirEExcluir([A, B, MDesligada], ["B", "M"]);
  expect(gradeNaTela()).toEqual(["Cor: A"]);

  salvarProdutoComGrade.mockRejectedValueOnce({
    produtoAtual: produto([A, B, MSoLigada]),
  });
  await salvar();
  expect(idsApagadosNaChamada(0).sort()).toEqual(["vb", "vm"]);

  expect(gradeNaTela().join("|")).toContain("Cor: M");
  expect(gradeNaTela().join("|")).not.toContain("Cor: B");
  expect(avisoAmarelo).toHaveBeenCalledTimes(1);

  await salvar();
  expect(salvarProdutoComGrade).toHaveBeenCalledTimes(2);
  expect(idsApagadosNaChamada(1)).toEqual(["vb"]);
});

it("a excluída que ninguém mexeu continua na fila e não avisa nada", async () => {
  await abrirEExcluir([A, B], ["B"]);
  salvarProdutoComGrade.mockRejectedValueOnce({
    produtoAtual: { ...produto([A, B]), price: 55 },
  });
  await salvar();
  expect(gradeNaTela()).toEqual(["Cor: A"]);
  expect(avisoAmarelo).not.toHaveBeenCalled();
  await salvar();
  expect(idsApagadosNaChamada(1)).toEqual(["vb"]);
});
