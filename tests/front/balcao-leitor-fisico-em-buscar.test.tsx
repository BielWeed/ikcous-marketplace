// @vitest-environment jsdom
// View, leitor, hook e buffer reais; só o banco e o contexto são dublados.
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "operador" } }),
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = {
  id: "linha",
  nome: "Produto da linha",
  preco_venda: 10,
  estoque: 5,
  imagem_url: null,
  imagem_urls: [],
  product_variants: [],
};
const variacao = {
  ...linha,
  id: "variavel",
  nome: "Produto com variação",
  product_variants: [
    {
      id: "p",
      name: "Tamanho",
      value: "P",
      price_override: 0,
      stock_increment: 5,
      active: true,
      image_url: null,
    },
  ],
};
const respostaDoBipe = {
  encontrado: true,
  origem: "produto",
  codigo: "78912345",
  produto: {
    id: "bipado",
    nome: "Produto bipado",
    ativo: true,
    preco_venda: 35,
    estoque: 7,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 35,
  estoque: 7,
  variacoes: [],
};

let host: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  vi.useFakeTimers();
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "get_admin_products_paged")
      return {
        data: { data: [linha, variacao], total_count: 2 },
        error: null,
      };
    if (nome === "buscar_por_codigo_barras")
      return { data: respostaDoBipe, error: null };
    throw new Error(`RPC inesperada: ${nome}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "");
});

const botao = (texto: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  )!;
async function montar() {
  await act(async () =>
    raiz.render(<AdminPdvView active onNavigate={vi.fn()} />),
  );
  await act(async () => botao("Buscar produto").click());
}

async function bipar(alvo: HTMLElement) {
  let enterConsumido = false;
  await act(async () => {
    for (const key of [..."78912345", "Enter"]) {
      vi.advanceTimersByTime(5);
      const evento = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      const executarAcaoPadrao = alvo.dispatchEvent(evento);
      if (key === "Enter") {
        enterConsumido = evento.defaultPrevented;
        // jsdom não gera o clique padrão do Enter num botão. Reproduzimos
        // essa ação só quando o leitor não a cancelou, como no navegador.
        if (executarAcaoPadrao) alvo.click();
      }
    }
  });
  return enterConsumido;
}

it("em Buscar, o bipe adiciona uma vez o produto lido e não repete a linha com foco", async () => {
  await montar();
  const focado = botao("Produto da linha");
  await act(async () => {
    focado.click();
    focado.focus();
  });
  expect(document.activeElement).toBe(focado);
  expect(host.querySelector("video")).toBeNull();
  expect(await bipar(focado)).toBe(true);
  const itens = host.querySelectorAll('[aria-label="Itens da venda"] li');
  expect(itens).toHaveLength(2);
  expect(itens[0].textContent).toContain("Produto da linha");
  expect(itens[0].querySelector(".pdv-quantity span")?.textContent).toBe("1");
  expect(itens[1].textContent).toContain("Produto bipado");
  expect(itens[1].querySelector(".pdv-quantity span")?.textContent).toBe("1");
  expect(
    rpc.mock.calls.filter(([nome]) => nome === "buscar_por_codigo_barras"),
  ).toEqual([["buscar_por_codigo_barras", { p_codigo: "78912345" }]]);
});

it("em Buscar, o bipe com foco na variação aberta não adiciona a variação por engano", async () => {
  await montar();
  await act(async () => botao("Produto com variação").click());
  const focado = botao("Tamanho P");
  await act(async () => focado.focus());
  expect(document.activeElement).toBe(focado);
  expect(await bipar(focado)).toBe(true);
  const itens = host.querySelectorAll('[aria-label="Itens da venda"] li');
  expect(itens).toHaveLength(1);
  expect(itens[0].textContent).toContain("Produto bipado");
  expect(itens[0].textContent).not.toContain("Tamanho P");
  expect(itens[0].querySelector(".pdv-quantity span")?.textContent).toBe("1");
  expect(
    rpc.mock.calls.filter(([nome]) => nome === "buscar_por_codigo_barras"),
  ).toHaveLength(1);
});

it("a escuta em Buscar ignora as teclas dentro do campo de busca", async () => {
  await montar();
  const campo = host.querySelector<HTMLInputElement>(
    "#busca-manual-de-produto",
  )!;
  await act(async () => campo.focus());
  expect(await bipar(campo)).toBe(false);
  expect(
    rpc.mock.calls.filter(([nome]) => nome === "buscar_por_codigo_barras"),
  ).toHaveLength(0);
  expect(host.querySelector('[aria-label="Itens da venda"] li')).toBeNull();
});
