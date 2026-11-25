// @vitest-environment jsdom
//
// Prova do canal de tempo real das avaliações (`subscribeToReviews`):
//  - a aba LÍDER abre UM canal com o nome certo: `reviews_prod_<id>` filtrado
//    pelo produto na página do produto, `reviews_all` SEM filtro no painel.
//    Nome ou filtro errado fazia a página de um produto acordar com avaliação
//    de OUTRO produto (ou duas telas dividirem o mesmo canal, o que o servidor
//    de tempo real recusa);
//  - visitante SEM login não abre canal nenhum (teto de conexões do plano);
//  - aba SEGUIDORA não abre canal: ouve o aviso da líder, e a página de um
//    produto só acorda com o aviso do PRÓPRIO produto, enquanto o painel
//    acorda com o de qualquer produto.
vi.hoisted(() => {
  class BroadcastChannelFalso {
    static ouvintes: ((evento: { data: unknown }) => void)[] = [];
    static enviadas: unknown[] = [];
    nome: string;
    constructor(nome: string) {
      this.nome = nome;
    }
    postMessage(mensagem: unknown): void {
      BroadcastChannelFalso.enviadas.push({ nome: this.nome, mensagem });
    }
    addEventListener(
      _tipo: string,
      ouvinte: (evento: { data: unknown }) => void,
    ): void {
      BroadcastChannelFalso.ouvintes.push(ouvinte);
    }
    removeEventListener(
      _tipo: string,
      ouvinte: (evento: { data: unknown }) => void,
    ): void {
      BroadcastChannelFalso.ouvintes = BroadcastChannelFalso.ouvintes.filter(
        (o) => o !== ouvinte,
      );
    }
    close(): void {}
  }
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
    BroadcastChannelFalso;
});

const h = vi.hoisted(() => ({
  user: { id: "cliente-1" } as { id: string } | null,
  isLeader: true,
  isAdmin: false,
  canais: [] as { nome: string; on: unknown[][]; removido: boolean }[],
  removeChannel: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: h.isAdmin }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: h.isLeader }),
}));
vi.mock("@/utils/admin_cache", () => ({
  lerGeracaoDosCachesDeAdmin: () => 0,
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (nome: string) => {
      const registro = { nome, on: [] as unknown[][], removido: false };
      h.canais.push(registro);
      const canal: Record<string, unknown> = { __registro: registro };
      canal.on = (...args: unknown[]) => {
        registro.on.push(args);
        return canal;
      };
      canal.subscribe = () => canal;
      return canal;
    },
    removeChannel: (canal: { __registro: { removido: boolean } }) => {
      canal.__registro.removido = true;
      h.removeChannel(canal);
      return Promise.resolve();
    },
    from: (...a: unknown[]) => h.from(...a),
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FalsoBC = {
  ouvintes: ((evento: { data: unknown }) => void)[];
  enviadas: unknown[];
};
const bc = () =>
  (globalThis as unknown as { BroadcastChannel: FalsoBC }).BroadcastChannel;

describe("useReviews.subscribeToReviews: nome, filtro e quem ouve", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoMudar: Mock<() => void>;

  async function montar(productId?: string, comAoMudar = true) {
    function Prova() {
      const { subscribeToReviews } = useReviews();
      useEffect(
        () => subscribeToReviews(comAoMudar ? aoMudar : undefined, productId),
        // montagem única de propósito: o hook real muda de identidade por render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
      );
      return null;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.user = { id: "cliente-1" };
    h.isLeader = true;
    h.isAdmin = false;
    h.canais = [];
    h.removeChannel.mockClear();
    h.from.mockReset().mockImplementation(() => {
      throw new Error("sem leitura neste teste");
    });
    h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    bc().ouvintes = [];
    bc().enviadas = [];
    aoMudar = vi.fn<() => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("líder na página do produto: canal do produto, filtrado pelo produto", async () => {
    await montar("prod-1");

    expect(h.canais.map((c) => c.nome)).toEqual(["reviews_prod_prod-1"]);
    expect(h.canais[0].on).toHaveLength(1);
    expect(h.canais[0].on[0].slice(0, 2)).toEqual([
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "reviews",
        filter: "product_id=eq.prod-1",
      },
    ]);
  });

  it("líder no painel (sem produto): canal geral e SEM filtro", async () => {
    await montar(undefined);

    expect(h.canais.map((c) => c.nome)).toEqual(["reviews_all"]);
    expect(h.canais[0].on[0].slice(0, 2)).toEqual([
      "postgres_changes",
      { event: "*", schema: "public", table: "reviews" },
    ]);
  });

  it("uma mudança chega: relê pelo chamador e avisa as outras abas com o produto", async () => {
    await montar("prod-1");
    const aoReceber = h.canais[0].on[0][2] as (p: unknown) => void;

    act(() => aoReceber({ eventType: "INSERT" }));

    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(bc().enviadas).toEqual([
      {
        nome: "ikcous_reviews_sync",
        mensagem: {
          type: "reviews_change",
          productId: "prod-1",
          payload: { eventType: "INSERT" },
        },
      },
    ]);
  });

  it("sem chamador na página do produto: relê a lista DAQUELE produto", async () => {
    await montar("prod-1", false);
    const aoReceber = h.canais[0].on[0][2] as (p: unknown) => void;

    await act(async () => aoReceber({ eventType: "UPDATE" }));

    expect(h.from).toHaveBeenCalledWith("reviews");
  });

  it("sem chamador no painel de admin: relê a página 0 do painel, em silêncio", async () => {
    h.isAdmin = true;
    await montar(undefined, false);
    const aoReceber = h.canais[0].on[0][2] as (p: unknown) => void;

    await act(async () => aoReceber({ eventType: "UPDATE" }));

    expect(h.rpc).toHaveBeenCalledWith(
      "get_admin_reviews_paged",
      expect.objectContaining({ p_page: 0, p_page_size: 20 }),
    );
  });

  it("ao sair da tela fecha o canal que abriu", async () => {
    await montar("prod-1");
    expect(h.canais[0].removido).toBe(false);

    await act(async () => raiz.unmount());

    expect(h.canais[0].removido).toBe(true);
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
    // recria a raiz para o afterEach desmontar sem erro
    raiz = createRoot(hospedeiro);
  });

  it("visitante sem login não abre canal nenhum", async () => {
    h.user = null;
    await montar("prod-1");

    expect(h.canais).toEqual([]);
    expect(bc().ouvintes).toHaveLength(0);
  });

  it("aba seguidora não abre canal: página de produto só acorda com o aviso do PRÓPRIO produto", async () => {
    h.isLeader = false;
    await montar("prod-1");

    expect(h.canais).toEqual([]);
    expect(bc().ouvintes).toHaveLength(1);
    const [ouvinte] = bc().ouvintes;

    act(() =>
      ouvinte({ data: { type: "reviews_change", productId: "prod-2" } }),
    );
    expect(aoMudar).not.toHaveBeenCalled();

    act(() => ouvinte({ data: { type: "outro_aviso", productId: "prod-1" } }));
    expect(aoMudar).not.toHaveBeenCalled();

    act(() =>
      ouvinte({ data: { type: "reviews_change", productId: "prod-1" } }),
    );
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("aba seguidora no painel acorda com o aviso de QUALQUER produto, mas não com outro tipo de aviso", async () => {
    h.isLeader = false;
    await montar(undefined);
    const [ouvinte] = bc().ouvintes;

    act(() =>
      ouvinte({ data: { type: "reviews_change", productId: "prod-9" } }),
    );
    expect(aoMudar).toHaveBeenCalledTimes(1);

    act(() => ouvinte({ data: { type: "outro_aviso" } }));
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("aba seguidora que sai da tela para de ouvir", async () => {
    h.isLeader = false;
    await montar("prod-1");
    expect(bc().ouvintes).toHaveLength(1);

    await act(async () => raiz.unmount());

    expect(bc().ouvintes).toHaveLength(0);
    raiz = createRoot(hospedeiro);
  });
});
