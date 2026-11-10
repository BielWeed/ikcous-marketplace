// @vitest-environment jsdom
//
// PREPARADO, AINDA NÃO EXECUTADO (onda54-A).
// CartProvider, mapeador, catálogo e avisos REAIS. Só as fronteiras de dados,
// autenticação e armazenamento são dubladas. A lê estoque 1 e espera pelas
// variantes; B lê estoque 5 e termina primeiro. Após a cliente escolher 5,
// a resposta antiga de A não pode reduzir nem persistir quantidade 1.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { mapProductFromDB } from "@/lib/mappers";
import type { CartItem } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;
type Resposta = { data: Linha[]; error: null };

const mundo = vi.hoisted(() => ({
  produtos: vi.fn(),
  variantes: vi.fn(),
  aviso: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: {
    warning: mundo.aviso,
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        in: (coluna: string, ids: string[]) => {
          if (tabela === "vw_produtos_public") {
            return mundo.produtos(coluna, ids);
          }
          if (tabela === "product_variants") {
            return mundo.variantes(coluna, ids);
          }
          throw new Error(`Consulta não prevista neste teste: ${tabela}`);
        },
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "produto-sintetico";
const CHAVE = "marketplace_cart_v1";
const SEM_VARIANTES: Resposta = { data: [], error: null };

function linhaDoProduto(estoque: number): Linha {
  return {
    id: ID,
    nome: "Caneca de Teste",
    descricao: "",
    preco_venda: 10,
    estoque,
    ativo: true,
    imagens: [],
    categoria: "geral",
  };
}

function respostaPendente<T>() {
  let terminar!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    terminar = resolve;
  });
  return { promessa, terminar };
}

function armazenamento(valores: Map<string, string>) {
  return {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void valores.set(chave, valor),
    removeItem: (chave: string) => void valores.delete(chave),
    clear: () => valores.clear(),
    key: (indice: number) => [...valores.keys()].at(indice) ?? null,
    get length() {
      return valores.size;
    },
  };
}

let atual!: ReturnType<typeof useCartContext>;
function Sonda() {
  const valor = useCartContext();
  useEffect(() => {
    atual = valor;
  });
  return (
    <output>
      {valor.cart.map((item) => (
        <span key={item.product.id}>{item.quantity}</span>
      ))}
    </output>
  );
}

describe("CartProvider — resposta antiga do catálogo não corta quantidade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let valores: Map<string, string>;
  let variantesA: ReturnType<typeof respostaPendente<Resposta>>;
  let variantesB: ReturnType<typeof respostaPendente<Resposta>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    valores = new Map();
    vi.stubGlobal("localStorage", armazenamento(valores));
    vi.stubGlobal("sessionStorage", armazenamento(new Map()));
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    variantesA = respostaPendente<Resposta>();
    variantesB = respostaPendente<Resposta>();
    mundo.produtos
      .mockReset()
      .mockResolvedValueOnce({ data: [linhaDoProduto(1)], error: null })
      .mockResolvedValueOnce({ data: [linhaDoProduto(5)], error: null });
    mundo.variantes
      .mockReset()
      .mockReturnValueOnce(variantesA.promessa)
      .mockReturnValueOnce(variantesB.promessa);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function esvaziarMicrotarefas() {
    await act(async () => {
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
  }

  function conferirCarrinho(quantidade: number, estoque: number) {
    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0].product.id).toBe(ID);
    expect(atual.cart[0].quantity).toBe(quantidade);
    expect(atual.cart[0].product.stock).toBe(estoque);
    expect(hospedeiro.querySelector("output")?.textContent).toBe(
      String(quantidade),
    );
    const salvo = valores.get(CHAVE);
    expect(salvo).toBeDefined();
    const persistidos = JSON.parse(salvo as string) as CartItem[];
    expect(persistidos).toHaveLength(1);
    expect(persistidos[0].product.id).toBe(ID);
    expect(persistidos[0].quantity).toBe(quantidade);
    expect(persistidos[0].product.stock).toBe(estoque);
  }

  async function abrir(quantidade = 1, estoque = 1) {
    valores.set(
      CHAVE,
      JSON.stringify([
        {
          product: mapProductFromDB({
            ...linhaDoProduto(estoque),
            product_variants: [],
          }),
          quantity: quantidade,
          lastModifiedAt: 1_760_000_000_000,
        },
      ]),
    );
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
        </CartProvider>,
      );
    });
    await esvaziarMicrotarefas();
    // A já leu o produto de estoque 1 e entrou na espera das variantes.
    expect(mundo.produtos).toHaveBeenCalledTimes(1);
    expect(mundo.produtos).toHaveBeenCalledWith("id", [ID]);
    expect(mundo.variantes).toHaveBeenCalledTimes(1);
    expect(mundo.variantes).toHaveBeenCalledWith("product_id", [ID]);
  }

  async function iniciarB() {
    let leitura!: Promise<void>;
    await act(async () => {
      leitura = atual.renovarCarrinhoPeloCatalogo();
    });
    await esvaziarMicrotarefas();
    expect(mundo.produtos).toHaveBeenCalledTimes(2);
    expect(mundo.produtos).toHaveBeenNthCalledWith(2, "id", [ID]);
    expect(mundo.variantes).toHaveBeenCalledTimes(2);
    expect(mundo.variantes).toHaveBeenNthCalledWith(2, "product_id", [ID]);
    return { leitura };
  }

  async function escolherCinco() {
    await act(async () => {
      atual.updateQuantity(ID, 5);
    });
    conferirCarrinho(5, 5);
  }

  it("B termina, a cliente escolhe 5 e A tardia não corta nem persiste quantidade antiga", async () => {
    await abrir();
    const b = await iniciarB();
    await act(async () => {
      variantesB.terminar(SEM_VARIANTES);
      await b.leitura;
    });
    conferirCarrinho(1, 5);
    await escolherCinco();
    expect(mundo.aviso).not.toHaveBeenCalled();

    await act(async () => {
      variantesA.terminar(SEM_VARIANTES);
    });
    await esvaziarMicrotarefas();

    conferirCarrinho(5, 5);
    expect(mundo.aviso).not.toHaveBeenCalled();
    expect(mundo.produtos).toHaveBeenCalledTimes(2);
    expect(mundo.variantes).toHaveBeenCalledTimes(2);
  });

  it("controle: na ordem normal A ajusta ao estoque legítimo e B permite escolher 5", async () => {
    await abrir(5, 5);
    await act(async () => {
      variantesA.terminar(SEM_VARIANTES);
    });
    await esvaziarMicrotarefas();
    // A é a leitura válida até aqui: a regra de reduzir ao estoque continua.
    conferirCarrinho(1, 1);
    expect(mundo.aviso).toHaveBeenCalledTimes(1);
    mundo.aviso.mockClear();

    const b = await iniciarB();
    await act(async () => {
      variantesB.terminar(SEM_VARIANTES);
      await b.leitura;
    });
    conferirCarrinho(1, 5);
    await escolherCinco();
    expect(mundo.aviso).not.toHaveBeenCalled();
  });
});
