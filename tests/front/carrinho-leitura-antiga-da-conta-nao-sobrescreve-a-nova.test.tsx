// @vitest-environment jsdom
//
// Onda 121, achado 1: DUAS leituras da MESMA conta em voo (o aviso ao vivo do
// banco + a rede que volta, a volta do segundo plano...) e a ANTIGA terminando
// por último. A leitura do catálogo (`renovarPeloCatalogo`) já descarta a
// resposta superada; a leitura da conta (`syncFromDB`) só conferia se a conta
// era a mesma. A leitura velha, chegando depois, sobrescrevia a nova:
//
//  A) cortava a quantidade pelo estoque de ANTES da reposição, e a gravação
//     seguinte levava o corte ao banco, com o aviso falso "Ajustamos a
//     quantidade";
//  B) devolvia ao carrinho a linha que o outro aparelho acabara de tirar -- e a
//     próxima edição a regravava no banco, ressuscitando o item nos dois
//     aparelhos.
//
// CartProvider, mapeador, catálogo e avisos REAIS. Só as fronteiras (banco,
// sessão, notificação) são dubladas, e cada leitura é segurada por uma promessa
// que o teste solta na ordem que quiser.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Portao = { promessa: Promise<void>; liberar: () => void };
type LinhaDoBanco = Record<string, unknown>;

const mundo = vi.hoisted(() => ({
  // Resposta da leitura inicial e de toda leitura que não foi roteirizada.
  itens: [] as Record<string, unknown>[],
  estoque: 10,
  // Leituras roteirizadas: cada chamada ao banco tira a PRIMEIRA da fila. O
  // retrato (linhas/estoque) é o de quando a leitura COMEÇOU; o portão a deixa
  // em voo até o teste soltá-lo.
  filaDoCarrinho: [] as {
    linhas: Record<string, unknown>[];
    portao: null | { promessa: Promise<void>; liberar: () => void };
  }[],
  filaDoCatalogo: [] as {
    estoque: number;
    portao: null | { promessa: Promise<void>; liberar: () => void };
  }[],
  // A PRÓXIMA conferência da sessão fica em voo até o teste soltar (uma vez só).
  portaoDaSessao: null as null | Promise<void>,
  rpc: vi.fn(),
  aviso: vi.fn(),
  evento: (_payload: unknown) => {},
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
const usuario = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: mundo.aviso,
  },
}));

function linhaDoProduto(id: string, nome: string, estoque: number) {
  return {
    id,
    nome,
    preco_venda: 10,
    estoque,
    ativo: true,
    imagens: [],
  };
}
const NOMES = new Map([
  ["p1", "Camiseta"],
  ["p2", "Bermuda"],
  ["p3", "Boné"],
]);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: async () => {
          const roteiro = mundo.filaDoCarrinho.shift();
          if (!roteiro) return { data: mundo.itens.slice(), error: null };
          const dados = { data: roteiro.linhas.slice(), error: null };
          if (roteiro.portao) await roteiro.portao.promessa;
          return dados;
        },
        in: async (_coluna: string, ids: string[]) => {
          if (tabela === "product_variants") return { data: [], error: null };
          const roteiro = mundo.filaDoCatalogo.shift();
          const estoque = roteiro ? roteiro.estoque : mundo.estoque;
          const dados = {
            data: ids
              .filter((id) => NOMES.has(id))
              .map((id) => linhaDoProduto(id, NOMES.get(id) ?? id, estoque)),
            error: null,
          };
          if (roteiro?.portao) await roteiro.portao.promessa;
          return dados;
        },
      }),
    }),
    auth: {
      getSession: async () => {
        const portao = mundo.portaoDaSessao;
        mundo.portaoDaSessao = null;
        if (portao) await portao;
        return { data: { session: { user: usuario } } };
      },
    },
    rpc: mundo.rpc,
    channel: () => ({
      on: (_tipo: unknown, _filtro: unknown, evento: typeof mundo.evento) => {
        mundo.evento = evento;
        return { subscribe: () => ({}) };
      },
    }),
    removeChannel: async () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let atual: ReturnType<typeof useCartContext>;
function Sonda() {
  const contexto = useCartContext();
  useEffect(() => {
    atual = contexto;
  }, [contexto]);
  return <output>{contexto.cartTotal}</output>;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mundo.itens = [];
  mundo.estoque = 10;
  mundo.filaDoCarrinho = [];
  mundo.filaDoCatalogo = [];
  mundo.portaoDaSessao = null;
  mundo.rpc.mockResolvedValue({ error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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

function portao(): Portao {
  let liberar = () => {};
  const promessa = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  return { promessa, liberar };
}
async function montar() {
  await act(async () =>
    raiz.render(
      <CartProvider>
        <Sonda />
      </CartProvider>,
    ),
  );
}
// Passa o tempo de espera da gravação (1 s) e deixa as promessas se resolverem.
async function sincronizar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
}
// Deixa as promessas encadeadas andarem sem passar o tempo da gravação.
async function andar() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}
async function chegaEventoDoBanco() {
  await act(async () => {
    mundo.evento({ eventType: "UPDATE" });
    await vi.advanceTimersByTimeAsync(50);
  });
}
async function redeVoltou() {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(50);
  });
}
async function soltar(p: Portao) {
  await act(async () => {
    p.liberar();
    await vi.advanceTimersByTimeAsync(50);
  });
}
function linhaDoBanco(productId: string, quantity = 1): LinhaDoBanco {
  return {
    product_id: productId,
    variant_id: "",
    quantity,
    updated_at: new Date(Date.now() - 60_000).toISOString(),
  };
}
const quantidades = () =>
  atual.cart.map((i) => [i.product.id, i.quantity] as const);
const avisosDeAjuste = () =>
  mundo.aviso.mock.calls
    .map((c) => String(c[0]))
    .filter((f) => f.includes("Ajustamos"));
// Tudo o que foi mandado ao banco pela RPC de gravação, linha a linha.
const linhasGravadas = () =>
  mundo.rpc.mock.calls.flatMap(
    (c) =>
      (c[1] as { p_cart_items: { product_id: string; quantity: number }[] })
        .p_cart_items,
  );

describe("carrinho: a leitura ANTIGA da conta, chegando por último, não sobrescreve a NOVA", () => {
  describe("A) estoque: o catálogo velho não corta a quantidade", () => {
    async function abrirComCinco() {
      mundo.itens = [linhaDoBanco("p1", 5)];
      await montar();
      await sincronizar();
      expect(quantidades()).toEqual([["p1", 5]]);
      expect(avisosDeAjuste()).toEqual([]);
      mundo.rpc.mockClear();
    }

    it("a 1ª leitura viu estoque 1 (antes da reposição), a 2ª viu 10: resolvida a 2ª e depois a 1ª, a quantidade segue 5", async () => {
      await abrirComCinco();
      const g1 = portao();
      const g2 = portao();
      mundo.filaDoCatalogo = [
        { estoque: 1, portao: g1 },
        { estoque: 10, portao: g2 },
      ];

      // Duas leituras forçadas da MESMA conta: o aviso ao vivo e a rede.
      await chegaEventoDoBanco(); // leitura 1: catálogo com estoque 1, em voo
      await redeVoltou(); // leitura 2: catálogo com estoque 10, em voo
      expect(mundo.filaDoCatalogo).toEqual([]); // as duas já saíram

      await soltar(g2); // a mais NOVA termina primeiro
      expect(quantidades()).toEqual([["p1", 5]]);
      await soltar(g1); // a ANTIGA termina por último

      expect(quantidades()).toEqual([["p1", 5]]);
      expect(avisosDeAjuste()).toEqual([]);
      // E o corte não foi levado ao banco.
      await sincronizar();
      expect(linhasGravadas().filter((l) => l.quantity === 1)).toEqual([]);
      expect(quantidades()).toEqual([["p1", 5]]);
    });

    it("controle: uma leitura só, com estoque 1, corta para 1, avisa e grava 1 (o corte legítimo continua)", async () => {
      await abrirComCinco();
      mundo.filaDoCatalogo = [{ estoque: 1, portao: null }];

      await chegaEventoDoBanco();
      await sincronizar();

      expect(quantidades()).toEqual([["p1", 1]]);
      expect(avisosDeAjuste()).toHaveLength(1);
      expect(linhasGravadas().map((l) => l.quantity)).toContain(1);
    });

    it("controle: na ordem NORMAL (a antiga termina antes) vale a mais nova, mesmo que ela corte", async () => {
      await abrirComCinco();
      const g1 = portao();
      const g2 = portao();
      // Desta vez a estoque 10 é a antiga e a estoque 1 é a mais nova.
      mundo.filaDoCatalogo = [
        { estoque: 10, portao: g1 },
        { estoque: 1, portao: g2 },
      ];

      await chegaEventoDoBanco();
      await redeVoltou();
      await soltar(g1);
      await soltar(g2);

      expect(quantidades()).toEqual([["p1", 1]]);
      expect(avisosDeAjuste()).toHaveLength(1);
    });
  });

  describe("B) linha tirada em outro aparelho: o retrato velho não a ressuscita", () => {
    async function abrirComDuasLinhas() {
      mundo.itens = [linhaDoBanco("p1"), linhaDoBanco("p2")];
      await montar();
      await sincronizar();
      expect(quantidades()).toEqual([
        ["p1", 1],
        ["p2", 1],
      ]);
      mundo.rpc.mockClear();
    }

    it("a 1ª leitura (retrato com p1 e p2) fica em voo, a 2ª (só p2) resolve antes: p1 NÃO volta e a edição seguinte não o envia", async () => {
      await abrirComDuasLinhas();
      const g1 = portao();
      // O outro aparelho tira p1 DEPOIS de a leitura 1 ter tirado o retrato.
      mundo.filaDoCarrinho = [
        { linhas: [linhaDoBanco("p1"), linhaDoBanco("p2")], portao: g1 },
        { linhas: [linhaDoBanco("p2")], portao: null },
      ];

      await chegaEventoDoBanco(); // leitura 1: retrato velho, em voo
      await redeVoltou(); // leitura 2: retrato novo, termina já
      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2"]);

      await soltar(g1); // a ANTIGA termina por último

      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2"]);

      // A cliente mexe no p2: o que sobe ao banco não pode trazer o p1 de volta.
      await act(async () => atual.updateQuantity("p2", 3));
      await sincronizar();
      expect(mundo.rpc).toHaveBeenCalled();
      expect(linhasGravadas().map((l) => l.product_id)).not.toContain("p1");
      expect(linhasGravadas()).toEqual([
        expect.objectContaining({ product_id: "p2", quantity: 3 }),
      ]);
      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2"]);
    });

    it("a 1ª leitura espera a conferência da sessão, a 2ª (que já viu o p3 posto no outro aparelho) termina antes: o p3 NÃO some", async () => {
      await abrirComDuasLinhas();
      const gSessao = portao();
      mundo.filaDoCarrinho = [
        { linhas: [linhaDoBanco("p2")], portao: null },
        { linhas: [linhaDoBanco("p2"), linhaDoBanco("p3")], portao: null },
      ];
      mundo.portaoDaSessao = gSessao.promessa;

      // Leitura 1: o p1 não está no banco, então ela confere a sessão antes de
      // tirá-lo, e fica parada aí.
      await chegaEventoDoBanco();
      // Leitura 2: começa depois, já vê o p3, e termina.
      await redeVoltou();
      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2", "p3"]);

      await soltar(gSessao); // a ANTIGA retoma, com um retrato sem o p3

      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2", "p3"]);
    });

    it("controle: sem leitura sobreposta, a remoção feita no outro aparelho continua valendo", async () => {
      await abrirComDuasLinhas();
      mundo.filaDoCarrinho = [{ linhas: [linhaDoBanco("p2")], portao: null }];

      await chegaEventoDoBanco();

      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2"]);
    });

    it("controle: ordem NORMAL (a antiga termina antes da nova) -> vale o retrato mais novo", async () => {
      await abrirComDuasLinhas();
      const g1 = portao();
      const g2 = portao();
      mundo.filaDoCarrinho = [
        { linhas: [linhaDoBanco("p1"), linhaDoBanco("p2")], portao: g1 },
        { linhas: [linhaDoBanco("p2")], portao: g2 },
      ];

      await chegaEventoDoBanco();
      await redeVoltou();
      await soltar(g1);
      await soltar(g2);
      await andar();

      expect(atual.cart.map((i) => i.product.id)).toEqual(["p2"]);
    });
  });
  describe("C) leitura inicial superada não destrava a tela antes da mais nova", () => {
    it("a 1ª leitura (a de abrir o app) termina e é descartada: a tela segue 'lendo' até a 2ª juntar o carrinho do banco", async () => {
      const g1 = portao();
      const g2 = portao();
      mundo.filaDoCarrinho = [
        { linhas: [linhaDoBanco("p1", 2)], portao: g1 },
        { linhas: [linhaDoBanco("p1", 2)], portao: g2 },
      ];
      await montar();
      expect(atual.isLoading).toBe(true);

      await chegaEventoDoBanco(); // 2ª leitura sai com a 1ª ainda em voo
      await soltar(g1); // a velha termina: nada de junção, nada de destravar
      expect(atual.cart).toEqual([]);
      expect(atual.isLoading).toBe(true);

      await soltar(g2);
      expect(quantidades()).toEqual([["p1", 2]]);
      expect(atual.isLoading).toBe(false);
    });
  });
});
