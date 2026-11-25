// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) no CartContext: bordas que nenhum teste vizinho
// derrubava (cada uma foi um defeito plantado de uma linha que a suíte do
// carrinho deixou passar):
//
//   1. Somar ao item que já está no carrinho troca a cópia do produto pela
//      ATUAL (preço novo vale no total) — antes o carrinho ficava preso no
//      preço do dia em que o item entrou.
//   2. "Grátis" só existe depois de a cliente (ou a regra da casa) ESCOLHER uma
//      opção: loja com frete fixo R$ 0 e nenhuma escolha não pode dizer
//      "frete grátis" (o aviso e o selo saem do `freteGratis`).
//   3. A lápide ("esta linha foi tirada às T") vale 7 dias EXATOS: com
//      exatamente 7 dias ela já expirou e sai do disco na próxima gravação.
//   4. A lápide da conta só vale para a conta que a gravou: a de outra conta
//      (aba antiga que trocou de conta sem limpar) nunca se mistura na desta.
//   5. "Desfazer" só apaga a lápide que ESTA tirada gravou. Se outra aba tirou
//      a mesma linha depois (lápide com outro carimbo), o Desfazer devolve a
//      linha mas NÃO apaga a lápide da outra aba.
//
// Mutantes equivalentes (sem teste possível, anotados de propósito):
//   - `Array.isArray(parsed)` na leitura das lápides do VISITANTE, o
//     `!Array.isArray(entradas)` em `lerConfirmado` e o `Array.isArray(parsed)`
//     de `carrinhoDoTextoSalvo`: os três ficam dentro de um `try`/`catch`; sem a
//     guarda o `.forEach`/`.filter`/`.map` lança TypeError e cai no mesmo
//     resultado (lápides vazias / `null`) que a guarda devolvia;
//   - `estoque <= 1` por `estoque === 1` em `unidadesDisponiveis`: só é
//     chamada com estoque inteiro maior que zero;
//   - `Array.isArray(parsed) ||` na leitura das lápides da CONTA: um array não
//     tem `.uid`, então `parsed?.uid !== uid` já o recusa (guarda em dobro).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product, ShippingOption } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  toastInfo: [] as unknown[][],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: (...args: unknown[]) => {
      mundo.toastInfo.push(args);
    },
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  const vazio = async () => ({ data: [], error: null });
  const consulta = {
    eq: vazio,
    in: () => ({ order: () => ({ range: vazio }) }),
  };
  return {
    supabase: {
      from: () => ({ select: () => consulta }),
      auth: {
        getSession: async () => ({
          data: { session: mundo.usuario ? { user: mundo.usuario } : null },
        }),
      },
      rpc: async () => ({ error: null }),
      channel: () => canal,
      removeChannel: async () => {},
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIA = 24 * 60 * 60 * 1000;
const LAPIDES_DA_CONTA = "marketplace_cart_account_tombstones_v1";
const LAPIDES_DO_VISITANTE = "marketplace_cart_tombstones_v1";

function produto(id: string, preco = 10, estoque = 50): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: preco,
    images: [],
    category: "geral",
    stock: estoque,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function abrir() {
  await act(async () => {
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

beforeAll(async () => {
  // Aquece o import pesado do provider (a 1ª compilação do Vite é lenta).
  await import("@/contexts/CartContext");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mundo.usuario = null;
  mundo.toastInfo = [];
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
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

describe("somar ao item que já está no carrinho", () => {
  it("troca a cópia do produto pela atual: o preço novo entra no total", async () => {
    await abrir();
    await act(async () => {
      atual.addToCart(produto("p1", 10), 1);
    });
    expect(atual.cartTotal).toBe(10);

    // A lojista subiu o preço; a cliente volta à vitrine e soma mais um.
    await act(async () => {
      atual.addToCart({ ...produto("p1", 12), name: "Produto p1 (novo)" }, 1);
    });

    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0].quantity).toBe(2);
    expect(atual.cart[0].product.price).toBe(12);
    expect(atual.cart[0].product.name).toBe("Produto p1 (novo)");
    expect(atual.cartTotal).toBe(24);
  });
});

describe("frete grátis só depois de uma escolha", () => {
  const OPCAO_GRATIS: ShippingOption = {
    id: "transp-sedex",
    name: "SEDEX",
    price: 0,
    deliveryDays: 3,
    provider: "frenet",
    precoCheio: 25,
    estrategiaNacional: {
      estrategia: "sempre",
      minimo: 0,
      tipoDesconto: null,
      valorDesconto: 0,
      alcance: "todas",
    },
  };

  it("loja com frete fixo R$ 0 e nenhuma opção escolhida: indefinido, NÃO grátis", async () => {
    await abrir();
    await act(async () => {
      atual.addToCart(produto("p1"), 1);
    });

    expect(atual.shippingFee).toBe(0);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.freteGratis).toBe(false);
    expect(atual.freteIndefinido).toBe(true);
    expect(atual.descontoDoFrete).toBe(0);
  });

  it("escolhida a opção de R$ 0: aí sim é grátis, com a economia do preço cheio", async () => {
    await abrir();
    await act(async () => {
      atual.addToCart(produto("p1"), 1);
    });
    await act(async () => {
      atual.setSelectedShippingOption(OPCAO_GRATIS, "cliente");
    });

    expect(atual.freteGratis).toBe(true);
    expect(atual.freteIndefinido).toBe(false);
    expect(atual.descontoDoFrete).toBe(25);
  });

  it("carrinho vazio nunca é grátis nem indefinido", async () => {
    await abrir();
    expect(atual.freteGratis).toBe(false);
    expect(atual.freteIndefinido).toBe(false);
    expect(atual.shippingFee).toBe(0);
  });
});

describe("lápides no aparelho: validade e dono", () => {
  const lerLapidesDaConta = () =>
    JSON.parse(localStorage.getItem(LAPIDES_DA_CONTA) ?? "null") as {
      uid: string;
      marcas: { key: string; deletedAt: number }[];
    } | null;

  it("com EXATOS 7 dias a lápide já expirou; com 7 dias menos 1 ms ainda vale", async () => {
    mundo.usuario = { id: "u1" };
    await abrir();
    const agora = Date.now();
    localStorage.setItem(
      LAPIDES_DA_CONTA,
      JSON.stringify({
        uid: "u1",
        marcas: [
          { key: "no-limite-", deletedAt: agora - 7 * DIA },
          { key: "quase-", deletedAt: agora - 7 * DIA + 1 },
          { key: "velha-", deletedAt: agora - 8 * DIA },
        ],
      }),
    );

    // `removeFromCart` lê as lápides do disco e regrava com a nova: o que
    // expirou não volta ao disco.
    await act(async () => {
      atual.removeFromCart("nova");
    });

    expect(lerLapidesDaConta()?.marcas.map((m) => m.key)).toEqual([
      "quase-",
      "nova-",
    ]);
  });

  it("lápide guardada por OUTRA conta não se mistura na lápide desta", async () => {
    mundo.usuario = { id: "u1" };
    await abrir();
    localStorage.setItem(
      LAPIDES_DA_CONTA,
      JSON.stringify({
        uid: "u2",
        marcas: [{ key: "de-outra-conta-", deletedAt: Date.now() - 1000 }],
      }),
    );

    await act(async () => {
      atual.removeFromCart("nova");
    });

    const guardado = lerLapidesDaConta();
    expect(guardado?.uid).toBe("u1");
    expect(guardado?.marcas.map((m) => m.key)).toEqual(["nova-"]);
  });

  it("lápide da conta em formato antigo (lista solta, sem dono) não vale", async () => {
    mundo.usuario = { id: "u1" };
    await abrir();
    localStorage.setItem(
      LAPIDES_DA_CONTA,
      JSON.stringify([{ key: "sem-dono-", deletedAt: Date.now() - 1000 }]),
    );

    await act(async () => {
      atual.removeFromCart("nova");
    });

    expect(lerLapidesDaConta()?.marcas.map((m) => m.key)).toEqual(["nova-"]);
  });

  it("o visitante usa a lápide DELE, e a da conta fica intocada", async () => {
    const daConta = JSON.stringify({
      uid: "u1",
      marcas: [{ key: "da-conta-", deletedAt: Date.now() - 1000 }],
    });
    localStorage.setItem(LAPIDES_DA_CONTA, daConta);
    await abrir();

    await act(async () => {
      atual.removeFromCart("nova");
    });

    const dele = JSON.parse(
      localStorage.getItem(LAPIDES_DO_VISITANTE) ?? "[]",
    ) as { key: string }[];
    expect(dele.map((m) => m.key)).toEqual(["nova-"]);
    expect(localStorage.getItem(LAPIDES_DA_CONTA)).toBe(daConta);
  });
});

describe("Desfazer da lixeira e a lápide de outra aba", () => {
  async function tirarComDesfazer() {
    await abrir();
    await act(async () => {
      atual.addToCart(produto("p1", 10), 2);
    });
    await act(async () => {
      atual.removeFromCart("p1", undefined, { comDesfazer: true });
    });
    const aviso = mundo.toastInfo.find(
      (args) => args[0] === "Produto removido do carrinho",
    );
    const acao = (
      aviso?.[1] as { action?: { onClick: () => void } } | undefined
    )?.action;
    expect(acao).toBeDefined();
    return acao as { onClick: () => void };
  }

  const lapidesDoVisitante = () =>
    JSON.parse(localStorage.getItem(LAPIDES_DO_VISITANTE) ?? "[]") as {
      key: string;
      deletedAt: number;
    }[];

  it("a lápide desta tirada some quando a linha volta", async () => {
    const desfazer = await tirarComDesfazer();
    expect(lapidesDoVisitante().map((m) => m.key)).toEqual(["p1-"]);

    await act(async () => {
      desfazer.onClick();
    });

    expect(atual.cart.map((l) => [l.product.id, l.quantity])).toEqual([
      ["p1", 2],
    ]);
    expect(lapidesDoVisitante()).toEqual([]);
  });

  it("a lápide de OUTRA tirada (outro carimbo) continua depois do Desfazer", async () => {
    const desfazer = await tirarComDesfazer();
    // Outra aba tirou a mesma linha logo depois: lápide com outro carimbo.
    const [propria] = lapidesDoVisitante();
    const daOutraAba = {
      key: propria.key,
      deletedAt: propria.deletedAt + 1234,
    };
    localStorage.setItem(LAPIDES_DO_VISITANTE, JSON.stringify([daOutraAba]));

    await act(async () => {
      desfazer.onClick();
    });

    // A linha volta, mas a lápide da outra aba segue valendo.
    expect(atual.cart.map((l) => l.product.id)).toEqual(["p1"]);
    expect(lapidesDoVisitante()).toEqual([daOutraAba]);
  });
});
