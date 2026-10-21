// @vitest-environment jsdom
import { useLeitorDeCodigo } from "@/hooks/useLeitorDeCodigo";
import type { Product } from "@/types";
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { catalogo, rpc } = vi.hoisted(() => ({
  catalogo: { products: [] as Product[] },
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke: vi.fn().mockResolvedValue({ error: null }) },
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, products: catalogo.products }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "operador" } }),
}));
vi.mock("@/hooks/useLeitorDeCodigo", () => ({ useLeitorDeCodigo: vi.fn() }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;
const hook = vi.mocked(useLeitorDeCodigo);
const produto = (name: string, extra: Partial<Product> = {}): Product => ({
  id: name,
  name,
  price: 10,
  stock: 3,
  images: [],
  description: "",
  category: "Geral",
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-10-18",
  ...extra,
});

const produtoDoServidor = {
  id: "Camiseta",
  nome: "Camiseta",
  preco_venda: 27.9,
  estoque: 2,
  imagem_url: null,
  imagem_urls: [],
  product_variants: [],
};

const pagina = (produtos = [produtoDoServidor], total = produtos.length) => ({
  data: { data: produtos, total_count: total },
  error: null,
});

beforeEach(() => {
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  catalogo.products = [];
  rpc.mockReset();
  rpc.mockResolvedValue(pagina([]));
  hook.mockReturnValue({
    estado: "lendo",
    erro: null,
    motor: "nativo",
    ultimaLeitura: null,
    refDoVideo: { current: null },
    tentarDeNovo: vi.fn(),
    lerCodigoDigitado: vi.fn(),
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  window.history.replaceState({}, "");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function montar(active = true) {
  await act(async () =>
    raiz.render(
      <StrictMode>
        <AdminPdvView onNavigate={vi.fn()} active={active} />
      </StrictMode>,
    ),
  );
}

function aba(modo: "bipar" | "digitar" | "buscar") {
  return host.querySelector<HTMLButtonElement>(`#modo-${modo}-produto`)!;
}

async function selecionar(modo: "bipar" | "buscar") {
  await act(async () => aba(modo).click());
}

const painelVisivel = () =>
  host.querySelector('[role="tabpanel"]:not([hidden])')!;

it("três modos segmentados compartilham os handlers sem ligar a câmera em Digitar", async () => {
  await montar();
  expect(
    [...host.querySelectorAll('[role="tab"]')].map((b) => b.textContent),
  ).toEqual(["Câmera", "Digitar", "Buscar"]);
  expect(host.querySelector(".pdv-viewport")).not.toBeNull();
  await act(async () => aba("digitar").click());
  expect(host.querySelector("video")).toBeNull();
  expect(host.querySelector("#codigo-de-barras-manual")).not.toBeNull();
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: true }),
  );
  await act(async () => {
    aba("digitar").dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(aba("buscar"));
  await act(async () => {
    aba("buscar").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(aba("bipar"));
});

it("abre em Bipar, alterna um painel por vez e mantém teclado ligado com câmera desligada em Buscar", async () => {
  await montar();
  expect(
    host.querySelector('[role="tablist"]')?.getAttribute("aria-label"),
  ).toBe("Adicionar produto à venda");
  expect(aba("bipar").getAttribute("aria-selected")).toBe("true");
  expect(painelVisivel().querySelector("video")).not.toBeNull();
  expect(painelVisivel().textContent).not.toContain("Fechar");
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: true, lerTeclado: true }),
  );
  expect(rpc).not.toHaveBeenCalled();
  await selecionar("buscar");
  expect(aba("buscar").getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector("video")).toBeNull();
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: true }),
  );
  const campo = painelVisivel().querySelector("#busca-manual-de-produto")!;
  expect(campo.getAttribute("aria-describedby")).toBe("busca-produto-ajuda");
  expect(painelVisivel().textContent).toContain(
    "Nome ou código interno · mínimo de 2 letras",
  );
  expect(painelVisivel().textContent).not.toContain(
    "Nenhum produto encontrado",
  );
  expect(
    campo.compareDocumentPosition(
      host.querySelector('[aria-label="Itens da venda"]')!,
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_admin_products_paged", {
    p_search: "",
    p_category: "all",
    p_status: "active",
    p_stock: "all",
    p_page: 0,
    p_page_size: 8,
  });
  await montar(false);
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: false }),
  );
  await selecionar("bipar");
  await montar(false);
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: false }),
  );
  await montar();
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: true, lerTeclado: true }),
  );
});

it("abas funcionam pelo teclado e somem ao identificar o cliente, com câmera desligada", async () => {
  await montar();
  await act(async () => {
    aba("bipar").focus();
    aba("bipar").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(aba("digitar"));
  expect(aba("digitar").getAttribute("aria-selected")).toBe("true");
  await selecionar("bipar");
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Cliente (opcional)"))!
      .click();
  });
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.querySelector("video")).toBeNull();
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: false }),
  );
});

it("Buscar carrega a lista do servidor só quando visível e pagina de oito em oito sem usar o cache", async () => {
  catalogo.products = [
    produto("Inativo", { isActive: false }),
    ...Array.from({ length: 32 }, (_, i) =>
      produto(`Produto ${String(32 - i).padStart(2, "0")}`),
    ),
  ];
  const produtos = Array.from({ length: 8 }, (_, i) => ({
    ...produtoDoServidor,
    id: `servidor-${i}`,
    nome: `Servidor ${i + 1}`,
  }));
  rpc.mockResolvedValueOnce(pagina(produtos, 9));
  rpc.mockResolvedValueOnce(
    pagina([{ ...produtoDoServidor, nome: "Servidor 9" }], 9),
  );
  await montar();
  expect(rpc).not.toHaveBeenCalled();
  await selecionar("buscar");
  const nomes = [...painelVisivel().querySelectorAll("li strong")].map(
    (el) => el.textContent,
  );
  expect(nomes).toEqual(produtos.map((p) => p.nome));
  expect(painelVisivel().textContent).not.toContain("Inativo");
  expect(painelVisivel().textContent).not.toContain("Produto 01");
  expect(catalogo.products[1].name).toBe("Produto 32");
  expect(rpc).toHaveBeenCalledTimes(1);
  await act(async () => botao("Mostrar mais").click());
  expect(painelVisivel().querySelectorAll("li strong")).toHaveLength(9);
  expect(rpc).toHaveBeenLastCalledWith(
    "get_admin_products_paged",
    expect.objectContaining({
      p_search: "",
      p_page: 1,
      p_page_size: 8,
    }),
  );
  await selecionar("bipar");
  await selecionar("buscar");
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("adicionar pela lista inicial mantém Buscar e preserva variação, preço zero e soma de itens", async () => {
  catalogo.products = [
    produto("Camiseta", {
      variants: [
        {
          id: "p",
          productId: "Camiseta",
          name: "Tamanho",
          value: "P",
          stockIncrement: 3,
          priceOverride: 0,
          active: true,
        },
      ],
    }),
  ];
  rpc.mockResolvedValue({
    data: {
      data: [
        {
          ...produtoDoServidor,
          product_variants: [
            {
              id: "p",
              name: "Tamanho",
              value: "P",
              stock_increment: 3,
              price_override: 0,
              active: true,
              image_url: null,
            },
          ],
        },
      ],
      total_count: 1,
    },
    error: null,
  });
  await montar();
  await selecionar("buscar");
  const clicar = async (texto: string) =>
    act(async () => {
      [...painelVisivel().querySelectorAll("button")]
        .find((b) => b.textContent?.includes(texto))!
        .click();
    });
  await clicar("Camiseta");
  await clicar("Tamanho P");
  await clicar("Tamanho P");
  expect(aba("buscar").getAttribute("aria-selected")).toBe("true");
  const venda = host.querySelector('[aria-label="Itens da venda"]')!;
  expect(venda.querySelectorAll("li")).toHaveLength(1);
  expect(venda.textContent).toContain("Tamanho P");
  expect(venda.querySelector(".pdv-quantity span")?.textContent).toBe("2");
  expect(venda.textContent).toContain("R$ 0,00 / un.");
  await selecionar("bipar");
  await selecionar("buscar");
  expect(venda.querySelector(".pdv-quantity span")?.textContent).toBe("2");
});

function botao(texto: string): HTMLButtonElement {
  return [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  )!;
}

it("a lista inicial espera a tela ativa e mostra Buscando até a resposta, sem duplicar a RPC no StrictMode", async () => {
  let resolver!: (resposta: ReturnType<typeof pagina>) => void;
  rpc.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolver = resolve;
      }),
  );
  await montar(false);
  await selecionar("buscar");
  expect(rpc).not.toHaveBeenCalled();
  await montar();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(painelVisivel().textContent).toContain("Buscando…");
  expect(painelVisivel().textContent).not.toContain("Nenhum produto");
  await act(async () => resolver(pagina([])));
  expect(painelVisivel().textContent).not.toContain("Buscando…");
  expect(painelVisivel().textContent).toContain(
    "Nenhum produto ativo cadastrado",
  );
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("o cupom usa preço e estoque do servidor mesmo com valores diferentes no StoreContext", async () => {
  catalogo.products = [produto("Camiseta", { price: 1, stock: 30 })];
  rpc.mockResolvedValue(pagina());
  await montar();
  await selecionar("buscar");
  expect(painelVisivel().textContent).toContain("2 em estoque");
  await act(async () => botao("Camiseta").click());
  const venda = host.querySelector('[aria-label="Itens da venda"]')!;
  expect(venda.textContent).toContain("R$ 27,90 / un.");
  const aumentar = venda.querySelector<HTMLButtonElement>(
    '[aria-label="Aumentar quantidade de Camiseta"]',
  )!;
  await act(async () => aumentar.click());
  expect(venda.querySelector(".pdv-quantity span")?.textContent).toBe("2");
  expect(aumentar.disabled).toBe(true);
  expect(botao("Fechar venda").textContent).toContain("R$ 55,80");
  expect(catalogo.products[0]).toMatchObject({ price: 1, stock: 30 });
});

it("falha na lista inicial mostra alerta e permite tentar a página zero vazia de novo", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpc.mockRejectedValueOnce(new Error("Failed to fetch"));
  rpc.mockResolvedValue(pagina());
  await montar();
  await selecionar("buscar");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Falha na busca de produtos",
  );
  expect(host.textContent).not.toContain("Nenhum produto ativo cadastrado");
  await act(async () => botao("Tentar de novo").click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(painelVisivel().textContent).toContain("Camiseta");
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenLastCalledWith(
    "get_admin_products_paged",
    expect.objectContaining({ p_search: "", p_page: 0 }),
  );
});

it("cancelar e limpar a venda em Buscar volta para Bipar", async () => {
  rpc.mockResolvedValue(pagina());
  await montar();
  await selecionar("buscar");
  await act(async () => botao("Camiseta").click());
  await act(async () => botao("Cancelar venda").click());
  await act(async () => botao("Sim, cancelar venda").click());
  expect(aba("bipar").getAttribute("aria-selected")).toBe("true");
  expect(painelVisivel().querySelector("video")).not.toBeNull();
  expect(host.querySelector('[aria-label="Itens da venda"] li')).toBeNull();
});

it("registrar em Buscar e tocar Nova venda abre o próximo cupom em Bipar", async () => {
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "get_admin_products_paged") return pagina();
    if (nome === "registrar_venda_presencial")
      return {
        data: {
          ja_existia: false,
          order: {
            id: "venda-123",
            created_at: "2026-10-18T12:00:00Z",
            total: 27.9,
            subtotal: 27.9,
            discount: 0,
            payment_method: "cash",
            user_id: null,
            customer_name: "",
            customer_data: null,
          },
          items: [
            {
              product_id: "Camiseta",
              variant_id: null,
              product_name: "Camiseta",
              price: 27.9,
              quantity: 1,
            },
          ],
        },
        error: null,
      };
    throw new Error(`RPC inesperada: ${nome}`);
  });
  await montar();
  await selecionar("buscar");
  await act(async () => botao("Camiseta").click());
  await act(async () => botao("Fechar venda").click());
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: false }),
  );
  await act(async () => botao("Dinheiro").click());
  await act(async () => botao("Registrar venda").click());
  expect(host.textContent).toContain("Venda registrada");
  await act(async () => botao("Nova venda").click());
  expect(aba("bipar").getAttribute("aria-selected")).toBe("true");
  expect(painelVisivel().querySelector("video")).not.toBeNull();
  expect(host.querySelector('[aria-label="Itens da venda"] li')).toBeNull();
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: true, lerTeclado: true }),
  );
});
