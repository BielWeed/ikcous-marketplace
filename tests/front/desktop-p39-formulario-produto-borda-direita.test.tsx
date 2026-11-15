// @vitest-environment jsdom
//
// P39 (painel em computador, a partir de 1280 px): no formulário do produto o
// cartão da direita ("Salvar alterações") encostava na borda da janela (x=1280)
// enquanto o topo, os alertas e os campos acabam 20 px antes (x=1260). A causa
// medida em Chromium: o cartão é filho direto da grade (`xl:grid`) e a margem
// dele é zerada de propósito (`!m-0`, para o `margin: auto` do painel não
// centrá-lo na coluna); todo o resto da página tem 20 px de folga lateral
// (`px-5`) e ele não tinha nenhuma. A correção devolve só os 20 px do lado
// direito (`xl:[&>.admin-acao-inline]:!mr-5`), a mesma folga do topo.
//
// O jsdom não calcula CSS: a medida (x de cada borda em 1024, 1280, 1536 e
// 1920 px) está no relatório da peça, feita em Chromium. Aqui a prova é o
// className do componente REAL e um mutante em cópia.
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fetchProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    fetchProduct,
    updateProduct: vi.fn(),
    addProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = {
  id: "prod-1",
  name: "Camiseta",
  description: "Algodão",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

// O container do formulário no celular (o que vale abaixo de 1024 px).
const CELULAR_DO_CONTAINER =
  "produto-formulario pb-admin relative h-auto min-h-full overflow-x-clip text-white";

let raiz: Root;
let hospedeiro: HTMLDivElement;
let prateleira: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  fetchProduct.mockResolvedValue(produto);
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  hospedeiro = document.createElement("div");
  prateleira = document.createElement("div");
  document.body.append(hospedeiro, prateleira);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  prateleira.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function montar() {
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <ContextoDaBarra.Provider
        value={{
          destino: prateleira,
          receberPrateleira: vi.fn(),
          larga: true,
          altura: 100,
        }}
      >
        <AdminProductFormView
          userId="lojista-1"
          productId="prod-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />
      </ContextoDaBarra.Provider>,
    );
  });
}

// Regras do cartão da direita que já existiam e NÃO podem mudar (a sticky de
// "Salvar" em 1024–1279 px depende de elas continuarem só em `xl:`).
const REGRAS_DO_CARTAO_QUE_JA_EXISTIAM = [
  "sticky",
  "bottom-auto",
  "top-24",
  "col-span-1",
  "col-start-2",
  "row-start-3",
  "!m-0",
  "self-start",
  "!rounded-3xl",
  "!p-6",
];
const FOLGA_DA_DIREITA = "xl:[&>.admin-acao-inline]:!mr-5";

/** O que falta para o cartão da direita acabar na mesma borda do topo. */
function problemasDoContainer(className: string) {
  const problemas: string[] = [];
  const tokens = className.split(/\s+/);
  if (!tokens.includes(FOLGA_DA_DIREITA)) {
    problemas.push("falta a folga de 20px à direita do cartão");
  }
  for (const regra of REGRAS_DO_CARTAO_QUE_JA_EXISTIAM) {
    if (!tokens.includes(`xl:[&>.admin-acao-inline]:${regra}`)) {
      problemas.push(`sumiu xl:[&>.admin-acao-inline]:${regra}`);
    }
  }
  if (!tokens.includes("xl:grid-cols-[minmax(0,1fr)_380px]")) {
    problemas.push("a grade de 380px mudou");
  }
  // Entre 1024 e 1279 px nada pode mudar: o único `lg:` do container é o de
  // antes, e a folga nova nasce só no `xl:`.
  const lg = tokens.filter((t) => t.split(":")[0] === "lg");
  if (lg.join(" ") !== "lg:pb-12") problemas.push(`lg: mudou (${lg})`);
  if (classesDoCelular(className) !== CELULAR_DO_CONTAINER) {
    problemas.push("a classe do celular mudou");
  }
  return problemas;
}

it("o cartão da direita termina na mesma borda do topo (folga de 20px)", async () => {
  await montar();
  const container = hospedeiro.querySelector<HTMLElement>(
    ".produto-formulario",
  );
  expect(container).not.toBeNull();
  expect(problemasDoContainer(container!.className)).toEqual([]);
  // A folga do cartão é a MESMA do topo (`px-5` = 20px de cada lado).
  const topo = hospedeiro.querySelector<HTMLElement>(".produto-topo");
  expect(topo?.classList.contains("px-5")).toBe(true);
  // Quem leva o cartão continua sendo o filho direto da grade.
  const barra = hospedeiro.querySelector<HTMLElement>(
    '[aria-label="Ações do produto"]',
  );
  expect(barra?.parentElement).toBe(container);
  expect(barra?.classList.contains("admin-acao-inline")).toBe(true);
});

// Mutantes em CÓPIA: a trava precisa reprovar, senão é decorativa.
const BOA = `${CELULAR_DO_CONTAINER} lg:pb-12 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] ${REGRAS_DO_CARTAO_QUE_JA_EXISTIAM.map((r) => `xl:[&>.admin-acao-inline]:${r}`).join(" ")} ${FOLGA_DA_DIREITA}`;

it("cópia boa passa na trava", () => {
  expect(problemasDoContainer(BOA)).toEqual([]);
});

it.each([
  ["sem a folga da direita", BOA.replace(` ${FOLGA_DA_DIREITA}`, "")],
  [
    "folga aberta também em lg (muda 1024–1279)",
    BOA.replace(FOLGA_DA_DIREITA, "lg:[&>.admin-acao-inline]:!mr-5"),
  ],
  [
    "sticky do cartão perdida",
    BOA.replace(" xl:[&>.admin-acao-inline]:sticky", ""),
  ],
  ["coluna da direita redimensionada", BOA.replace("_380px]", "_400px]")],
  ["classe do celular editada", BOA.replace("pb-admin", "pb-4")],
])("mutante reprova: %s", (_nome, mutante) => {
  expect(problemasDoContainer(mutante)).not.toEqual([]);
});
