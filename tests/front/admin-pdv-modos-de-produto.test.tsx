// @vitest-environment jsdom
import { useLeitorDeCodigo } from "@/hooks/useLeitorDeCodigo";
import type { Product } from "@/types";
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { catalogo, rpc } = vi.hoisted(() => ({
  catalogo: { products: [] as Product[] },
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, products: catalogo.products }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "operador" } }),
}));
vi.mock("@/hooks/useLeitorDeCodigo", () => ({ useLeitorDeCodigo: vi.fn() }));
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

beforeEach(() => {
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  catalogo.products = [];
  rpc.mockReset();
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
    raiz.render(<AdminPdvView onNavigate={vi.fn()} active={active} />),
  );
}

function aba(modo: "bipar" | "buscar") {
  return host.querySelector<HTMLButtonElement>(`#modo-${modo}-produto`)!;
}

async function selecionar(modo: "bipar" | "buscar") {
  await act(async () => aba(modo).click());
}

const painelVisivel = () =>
  host.querySelector('[role="tabpanel"]:not([hidden])')!;

it("abre em Bipar, alterna um painel por vez e desliga câmera e teclado em Buscar", async () => {
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
  await selecionar("buscar");
  expect(aba("buscar").getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector("video")).toBeNull();
  expect(hook).toHaveBeenLastCalledWith(
    expect.objectContaining({ ativo: false, lerTeclado: false }),
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
  expect(rpc).not.toHaveBeenCalled();
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
  expect(document.activeElement).toBe(aba("buscar"));
  expect(aba("buscar").getAttribute("aria-selected")).toBe("true");
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

it("Buscar oferece até 30 produtos ativos já carregados, em ordem, sem consultar nem alterar o catálogo", async () => {
  catalogo.products = [
    produto("Inativo", { isActive: false }),
    ...Array.from({ length: 32 }, (_, i) =>
      produto(`Produto ${String(32 - i).padStart(2, "0")}`),
    ),
  ];
  await montar();
  await selecionar("buscar");
  const nomes = [...painelVisivel().querySelectorAll("li strong")].map(
    (el) => el.textContent,
  );
  expect(nomes).toHaveLength(30);
  expect(nomes[0]).toBe("Produto 01");
  expect(nomes[29]).toBe("Produto 30");
  expect(painelVisivel().textContent).not.toContain("Inativo");
  expect(catalogo.products[1].name).toBe("Produto 32");
  expect(rpc).not.toHaveBeenCalled();
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
