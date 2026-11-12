// @vitest-environment jsdom
// Rede "pendurada": a gravação do carrinho no servidor (RPC `sync_cart_atomic`)
// conecta e nunca responde, sem erro. Sem prazo, `syncPending` ficava ligado
// para sempre: a tela mostrava a quantidade nova, mas nenhum envio acontecia
// até recarregar o app. Com prazo, o silêncio conta como falha recuperável: a
// trava solta e o reenvio usa o caminho de falha de sempre (backoff + evento
// `online`). A resposta tardia da gravação abandonada é ignorada.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { PRAZO_DE_GRAVAR_O_CARRINHO_MS } from "@/lib/prazo-da-requisicao";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: { id: "A" },
  rpc: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/lib/catalogo-do-carrinho", () => ({
  montarCatalogo: () => ({}),
  aplicarCatalogoAoCarrinho: (itens: unknown[]) => itens,
  avisosDoCarrinho: async () => [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { user: mundo.usuario } } }),
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: async () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = {
  id: "p1",
  name: "Produto",
  price: 10,
  images: [],
  stock: 10,
} as unknown as Product;
const observar = vi.fn();
function Sonda() {
  observar(useCartContext());
  return null;
}
const atual = () =>
  observar.mock.calls.at(-1)![0] as ReturnType<typeof useCartContext>;
const quantidadeNaTela = () => atual().cart[0]?.quantity;
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.rpc.mockResolvedValue({ error: null });
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => void valores.set(k, v),
    removeItem: (k: string) => void valores.delete(k),
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function montar() {
  await act(async () => {
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    );
  });
}
// Em passos curtos: o `act` só aplica o estado do React (o que reabre o
// efeito do reenvio) quando ele termina, e o reenvio nasce de um estado.
async function avancar(ms: number) {
  for (let t = 0; t < ms; t += 500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(500, ms - t));
    });
  }
}
/** Uma gravação que fica no ar até o teste decidir como (e se) ela termina. */
function gravacaoEmVoo() {
  let resolver!: (v: { error: unknown }) => void;
  const promessa = new Promise<{ error: unknown }>((r) => {
    resolver = r;
  });
  mundo.rpc.mockReturnValueOnce(promessa);
  return resolver;
}
const quantidadesEnviadas = (chamada: number) => {
  const [, argumentos] = mundo.rpc.mock.calls.at(chamada) ?? [];
  const linhas = (argumentos as { p_cart_items?: { quantity: number }[] })
    ?.p_cart_items;
  return (linhas ?? []).map((i) => i.quantity);
};

describe("gravação do carrinho que nunca responde", () => {
  it("passado o prazo a trava solta: a quantidade nova e o evento online levam um novo envio", async () => {
    await montar();
    gravacaoEmVoo(); // nunca resolve
    await act(async () => atual().addToCart(produto));
    await avancar(1100);
    expect(mundo.rpc).toHaveBeenCalledTimes(1);
    expect(quantidadesEnviadas(0)).toEqual([1]);

    // A cliente muda a quantidade com a gravação pendurada: a tela mostra 2 e
    // nenhum envio novo acontece enquanto a primeira ainda está dentro do prazo.
    await act(async () => atual().addToCart(produto));
    await avancar(1100);
    expect(quantidadeNaTela()).toBe(2);
    expect(mundo.rpc).toHaveBeenCalledTimes(1);

    // Passa o prazo (e a espera do reenvio de sempre): a gravação é dada como
    // falha, a quantidade que a cliente vê NÃO muda.
    await avancar(PRAZO_DE_GRAVAR_O_CARRINHO_MS + 1_000);
    expect(quantidadeNaTela()).toBe(2);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(2_500);

    expect(mundo.rpc.mock.calls.length).toBeGreaterThanOrEqual(2);
    // O novo envio leva o carrinho de AGORA (2), nunca o antigo (1).
    const ultima = mundo.rpc.mock.calls.length - 1;
    expect(quantidadesEnviadas(ultima)).toEqual([2]);
    expect(quantidadeNaTela()).toBe(2);
  });

  it("sem nenhum evento, a própria falha por prazo reagenda o envio (backoff de sempre)", async () => {
    await montar();
    gravacaoEmVoo(); // nunca resolve
    await act(async () => atual().addToCart(produto));
    await avancar(1100);
    expect(mundo.rpc).toHaveBeenCalledTimes(1);
    await avancar(PRAZO_DE_GRAVAR_O_CARRINHO_MS + 6_000);
    expect(mundo.rpc).toHaveBeenCalledTimes(2);
    expect(quantidadesEnviadas(1)).toEqual([1]);
    expect(quantidadeNaTela()).toBe(1);
  });

  it("resposta tardia da gravação abandonada é ignorada: não solta a trava da gravação nova nem duplica envio", async () => {
    await montar();
    const velhaTerminar = gravacaoEmVoo();
    await act(async () => atual().addToCart(produto));
    await avancar(1100);
    expect(mundo.rpc).toHaveBeenCalledTimes(1);

    // A segunda gravação também fica no ar (rede ainda ruim).
    const novaTerminar = gravacaoEmVoo();
    await avancar(PRAZO_DE_GRAVAR_O_CARRINHO_MS + 6_000);
    expect(mundo.rpc).toHaveBeenCalledTimes(2);

    // A resposta da PRIMEIRA chega agora, tarde e como falha: nada acontece.
    await act(async () => velhaTerminar({ error: { message: "tarde" } }));
    await avancar(5_000);
    expect(mundo.rpc).toHaveBeenCalledTimes(2);
    expect(quantidadeNaTela()).toBe(1);

    // A segunda termina bem (dentro do SEU prazo): fim, sem novos envios.
    await act(async () => novaTerminar({ error: null }));
    await avancar(40_000);
    expect(mundo.rpc).toHaveBeenCalledTimes(2);
    expect(quantidadeNaTela()).toBe(1);
  });

  it("controle: RPC rápida não mostra prazo nenhum — um envio só, sem reenvio, nada pendente", async () => {
    await montar();
    await act(async () => atual().addToCart(produto));
    await avancar(1100);
    expect(mundo.rpc).toHaveBeenCalledTimes(1);
    await avancar(PRAZO_DE_GRAVAR_O_CARRINHO_MS * 3);
    expect(mundo.rpc).toHaveBeenCalledTimes(1);
    expect(quantidadeNaTela()).toBe(1);
    // Nenhum temporizador de prazo ficou armado depois da resposta rápida.
    expect(vi.getTimerCount()).toBe(0);
  });
});
