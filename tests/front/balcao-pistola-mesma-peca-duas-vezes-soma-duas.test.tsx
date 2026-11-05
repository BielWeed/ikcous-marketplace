// @vitest-environment jsdom
//
// Balcão — duas peças IGUAIS bipadas com a pistola, uma logo atrás da outra,
// são 2 unidades no cupom. Antes, a guarda de "leitura repetida" do carrinho
// (1,5 s) comia a segunda bipada: o cupom ficava com 1 unidade, aparecia o
// aviso "Leitura repetida" e a venda saía cobrada a menos.
//
// View, leitor, hook e buffer reais; só o banco e o contexto são dublados
// (molde: balcao-leitor-fisico-em-buscar.test.tsx).
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

async function montar() {
  await act(async () =>
    raiz.render(<AdminPdvView active onNavigate={vi.fn()} />),
  );
}

// Uma bipada de pistola: dígitos rápidos (5 ms) e Enter, como o leitor USB.
async function bipar() {
  await act(async () => {
    for (const key of [..."78912345", "Enter"]) {
      vi.advanceTimersByTime(5);
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }
  });
}

async function esperar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const quantidades = () =>
  [...host.querySelectorAll('[aria-label="Itens da venda"] li')].map(
    (li) => li.querySelector(".pdv-quantity span")?.textContent,
  );

it("a mesma peça bipada duas vezes com 300 ms de diferença vira 2 unidades, sem aviso de repetida", async () => {
  await montar();
  await bipar();
  await esperar(300);
  await bipar();
  await esperar(0);

  expect(quantidades()).toEqual(["2"]);
  expect(host.textContent).not.toContain("Leitura repetida");
  expect(
    rpc.mock.calls.filter(([nome]) => nome === "buscar_por_codigo_barras"),
  ).toHaveLength(2);
});

it("três bipadas seguidas da mesma peça somam 3", async () => {
  await montar();
  for (let i = 0; i < 3; i++) {
    await bipar();
    await esperar(200);
  }

  expect(quantidades()).toEqual(["3"]);
  expect(host.textContent).not.toContain("Leitura repetida");
});
