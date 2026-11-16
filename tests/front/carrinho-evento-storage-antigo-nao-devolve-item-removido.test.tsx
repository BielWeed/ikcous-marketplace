// @vitest-environment jsdom
// Contraprova isolada: o evento guarda um retrato anterior à remoção.
// Sua entrega NÃO regrava o armazenamento com aquele retrato antigo.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { chaveDoItem } from "@/lib/escolhas-do-item";
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "marketplace_cart_v1";
const CHAVE_DAS_EXCLUSOES = "marketplace_cart_tombstones_v1";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

function produto(id: string): Product {
  return {
    id,
    name: `Produto fictício ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("evento storage antigo depois da remoção no carrinho visitante", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  let armazem: Map<string, string>;
  const buscar = vi.fn(() => Promise.reject(new Error("REDE_REAL_PROIBIDA")));

  beforeEach(() => {
    armazem = new Map<string, string>();
    buscar.mockClear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", buscar);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, String(valor));
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function esperar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }

  const ids = () => atual.cart.map((linha) => linha.product.id);
  const linhasSalvas = () =>
    JSON.parse(armazem.get(CHAVE) ?? "[]") as CartItem[];
  const idsSalvos = () => linhasSalvas().map((linha) => linha.product.id);

  async function removerXDeVerdade() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    await esperar();
    expect(atual.isLoading).toBe(false);
    expect(ids()).toEqual([]);

    await act(async () => {
      atual.addToCart(produto("X"), 1);
    });
    await esperar();
    expect(ids()).toEqual(["X"]);
    expect(idsSalvos()).toEqual(["X"]);

    const linhaAntes = linhasSalvas()[0];
    const retratoComX = armazem.get(CHAVE) as string;
    const eventoAntigo = new StorageEvent("storage", {
      key: CHAVE,
      newValue: retratoComX,
    });

    await act(async () => {
      atual.removeFromCart("X");
    });
    await esperar();
    expect(ids()).toEqual([]);
    expect(idsSalvos()).toEqual([]);
    expect(JSON.parse(armazem.get(CHAVE_DAS_EXCLUSOES) ?? "[]")).toContainEqual(
      {
        key: chaveDoItem(linhaAntes),
        deletedAt: expect.any(Number),
      },
    );
    expect(buscar).not.toHaveBeenCalled();
    return eventoAntigo;
  }

  it("controle: um evento atual continua trazendo o carrinho novo da outra aba", async () => {
    await removerXDeVerdade();
    const retratoAtual = JSON.stringify([
      { product: produto("Y"), quantity: 1, lastModifiedAt: Date.now() },
    ]);
    // Neste controle, a outra aba acabou de gravar o valor atual.
    armazem.set(CHAVE, retratoAtual);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: CHAVE, newValue: retratoAtual }),
      );
    });
    await esperar();

    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["Y"],
      persistido: ["Y"],
    });
    expect(buscar).not.toHaveBeenCalled();
  });

  async function prepararY() {
    const eventoAntigo = await removerXDeVerdade();
    await act(async () => {
      atual.addToCart(produto("Y"), 1);
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["Y"],
      persistido: ["Y"],
    });
    return eventoAntigo;
  }

  it("um aviso antigo de clear não apaga Y que está salvo agora", async () => {
    await prepararY();
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: null, newValue: null }),
      );
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["Y"],
      persistido: ["Y"],
    });
  });

  it("ausência atual no disco esvazia mesmo com payload antigo contendo X", async () => {
    const eventoAntigo = await prepararY();
    armazem.delete(CHAVE);
    await act(async () => {
      window.dispatchEvent(eventoAntigo);
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: [],
      persistido: [],
    });
  });

  it("falha de leitura atual preserva Y em vez de interpretar erro como vazio", async () => {
    const eventoAntigo = await prepararY();
    const leitura = vi
      .spyOn(localStorage, "getItem")
      .mockImplementation((chave) => {
        if (chave === CHAVE) throw new Error("LEITURA_FICTICIA_INDISPONIVEL");
        return armazem.get(chave) ?? null;
      });
    await act(async () => {
      window.dispatchEvent(eventoAntigo);
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["Y"],
      persistido: ["Y"],
    });
    expect(leitura).toHaveBeenCalledWith(CHAVE);
  });

  it.each([
    ["JSON quebrado", "{quebrado"],
    ["objeto em vez de lista", JSON.stringify({ nao: "lista" })],
    ["null em texto", "null"],
  ])(
    "texto atual inválido (%s) preserva o carrinho em memória",
    async (_nome, texto) => {
      const eventoAntigo = await prepararY();
      armazem.set(CHAVE, texto);
      await act(async () => {
        window.dispatchEvent(eventoAntigo);
      });
      await esperar();
      expect(ids()).toEqual(["Y"]);
      expect(armazem.get(CHAVE)).toBe(texto);
    },
  );

  it("outra chave não dispara adoção mesmo quando o disco do carrinho diverge", async () => {
    const eventoAntigo = await prepararY();
    armazem.set(CHAVE, eventoAntigo.newValue as string);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "outra_chave",
          newValue: eventoAntigo.newValue,
        }),
      );
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["Y"],
      persistido: ["X"],
    });
  });

  it("outra área de armazenamento não altera o estado deste carrinho", async () => {
    const eventoAntigo = await prepararY();
    armazem.set(CHAVE, eventoAntigo.newValue as string);
    const eventoOutraArea = new StorageEvent("storage", {
      key: CHAVE,
      newValue: eventoAntigo.newValue,
    });
    // O setup fornece Storage de reserva; o construtor nativo não a aceita.
    // Dublê só da área informada pelo evento, sem alterar o listener real.
    vi.spyOn(eventoOutraArea, "storageArea", "get").mockReturnValue(
      sessionStorage,
    );
    await act(async () => {
      window.dispatchEvent(eventoOutraArea);
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["Y"],
      persistido: ["X"],
    });
  });

  it("reinclusão legítima de X na escrita atual não é bloqueada pela exclusão antiga", async () => {
    const eventoAntigo = await removerXDeVerdade();
    const atualComX = JSON.stringify([
      { product: produto("X"), quantity: 1, lastModifiedAt: Date.now() },
    ]);
    armazem.set(CHAVE, atualComX);
    await act(async () => {
      window.dispatchEvent(eventoAntigo);
    });
    await esperar();
    expect({ estado: ids(), persistido: idsSalvos() }).toEqual({
      estado: ["X"],
      persistido: ["X"],
    });
  });

  it("não devolve X quando o evento antigo chega depois de sua remoção persistida", async () => {
    const eventoAntigo = await removerXDeVerdade();
    const antesDoEvento = {
      estado: ids(),
      persistido: idsSalvos(),
      exclusoes: JSON.parse(armazem.get(CHAVE_DAS_EXCLUSOES) ?? "[]"),
    };
    // Deliberadamente NÃO chama armazem.set antes de entregar este evento.
    // O disco já está sem X, e a exclusão foi gravada pelo Provider real.
    await act(async () => {
      window.dispatchEvent(eventoAntigo);
    });
    await esperar();
    expect(buscar).not.toHaveBeenCalled();

    const depoisDoEvento = { estado: ids(), persistido: idsSalvos() };
    expect(
      depoisDoEvento,
      JSON.stringify({ antesDoEvento, depoisDoEvento }),
    ).toEqual({ estado: [], persistido: [] });
  });
});
