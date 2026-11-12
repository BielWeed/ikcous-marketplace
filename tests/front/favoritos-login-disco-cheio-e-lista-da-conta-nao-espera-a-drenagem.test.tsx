// @vitest-environment jsdom
//
// Favoritos no login — dois defeitos do mesmo efeito de sincronização:
//
//  1. DISCO CHEIO: o write-ahead (gravar a fila da conta antes de apagar o
//     balde do visitante) engolia o erro do `setItem`. Aparelho com o
//     armazenamento no limite: a fila não entrava, o balde era apagado do mesmo
//     jeito e, com a rede ruim (upsert falhando), a retentativa lia o disco,
//     achava a fila vazia e os favoritos do visitante sumiam para sempre —
//     com o aviso dizendo "continuam salvos".
//  2. LOADING LONGO: o login drenava os favoritos do visitante UM A UM (até 20 s
//     cada) e só depois lia a lista da conta. Com N favoritos locais e rede
//     lenta a aba Favoritos ficava só esqueleto por até N x 20 s.
import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAVORITES_KEY = "ikcous_favorites";
const pendenteDe = (uid: string) => `ikcous_favorites_pendentes:${uid}`;

const mundo = vi.hoisted(() => ({
  usuario: { id: "A" } as { id: string },
  upsert: vi.fn(),
  select: vi.fn(),
  ordem: [] as string[],
  toastErro: vi.fn(),
  toastSucesso: vi.fn(),
}));

const produtos = ["p1", "p2", "p3", "conta1"].map(
  (id) =>
    ({
      id,
      name: `Produto ${id}`,
      price: 10,
      images: [],
    }) as unknown as Product,
);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mundo.toastSucesso(...a),
    error: (...a: unknown[]) => mundo.toastErro(...a),
    warning: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => {
          mundo.ordem.push("select");
          return mundo.select();
        },
      }),
      upsert: (o: unknown) => {
        mundo.ordem.push("upsert");
        return mundo.upsert(o);
      },
    }),
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda({
  observar,
}: {
  observar: (valor: React.ContextType<typeof FavoritesContext>) => void;
}) {
  observar(useContext(FavoritesContext));
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const observar = vi.fn();
const atual = () =>
  observar.mock.calls.at(-1)![0] as NonNullable<
    React.ContextType<typeof FavoritesContext>
  >;
const renderizar = async () => {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda observar={observar} />
      </FavoritesProvider>,
    );
  });
};
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
const FALHA = { error: { message: "sem rede" } };
const OK = { error: null };

/**
 * Armazenamento com CAPACIDADE (soma dos valores, em caracteres) e/ou chaves
 * que sempre estouram a cota: `setItem` lança `QuotaExceededError`.
 */
function criarArmazem(opcoes: {
  capacidade?: number;
  chavesQueEstouram?: string[];
}) {
  const mapa = new Map<string, string>();
  const total = (exceto: string) =>
    [...mapa.entries()]
      .filter(([k]) => k !== exceto)
      .reduce((s, [, v]) => s + v.length, 0);
  return {
    mapa,
    api: {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => {
        const estoura =
          opcoes.chavesQueEstouram?.includes(k) ||
          (opcoes.capacidade !== undefined &&
            total(k) + v.length > opcoes.capacidade);
        if (estoura) {
          throw new DOMException("cota estourada", "QuotaExceededError");
        }
        mapa.set(k, v);
      },
      removeItem: (k: string) => void mapa.delete(k),
    },
  };
}

let armazem: ReturnType<typeof criarArmazem>;
function instalarArmazem(opcoes: Parameters<typeof criarArmazem>[0]) {
  armazem = criarArmazem(opcoes);
  vi.stubGlobal("localStorage", armazem.api);
}
const idsDoBalde = (): string[] =>
  JSON.parse(armazem.mapa.get(FAVORITES_KEY) ?? "[]").map(
    (e: string | Product) => (typeof e === "string" ? e : e.id),
  );
const idsDaFila = (uid: string): string[] =>
  (JSON.parse(armazem.mapa.get(pendenteDe(uid)) ?? "[]") as Product[]).map(
    (p) => p.id,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "A" };
  mundo.ordem = [];
  mundo.select.mockImplementation(async () => ({ data: [], error: null }));
  mundo.upsert.mockImplementation(async () => OK);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      close() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function visitanteEntra(ids: string[]) {
  // Visitante (sem conta) com favoritos no balde, depois o login.
  mundo.usuario = undefined as unknown as { id: string };
  armazem.mapa.set(FAVORITES_KEY, JSON.stringify(ids));
  await renderizar();
  await flush();
  mundo.usuario = { id: "A" };
  await renderizar();
  await flush();
}

describe("login com o disco cheio e o servidor falhando", () => {
  it("fila e salvamento reduzido estouram: o balde do visitante NAO e apagado e o aviso nao promete 'continuam salvos'", async () => {
    instalarArmazem({ chavesQueEstouram: [pendenteDe("A")] });
    mundo.upsert.mockImplementation(async () => FALHA);

    await visitanteEntra(["p1", "p2"]);

    // Nada ficou na fila da conta (o disco recusou), mas os favoritos NAO sumiram:
    expect(idsDaFila("A")).toEqual([]);
    expect(idsDoBalde()).toEqual(["p1", "p2"]);
    // O aviso e honesto: nao diz que estao salvos / que vai tentar sozinho.
    expect(mundo.toastErro).toHaveBeenCalledTimes(1);
    const aviso = String(mundo.toastErro.mock.calls[0][0]);
    expect(aviso).not.toMatch(/continuam salvos/i);
    expect(aviso).not.toMatch(/vamos tentar de novo/i);
    expect(mundo.toastSucesso).not.toHaveBeenCalled();

    // Recuperavel: abrir o app de novo (F5) com a rede boa sobe os dois.
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    mundo.upsert.mockClear();
    mundo.upsert.mockImplementation(async () => OK);
    await renderizar();
    await flush();
    const subidos = mundo.upsert.mock.calls.map(
      (c) => (c[0] as { product_id: string }).product_id,
    );
    expect(subidos).toEqual(["p1", "p2"]);
    // Confirmado no servidor: agora sim o balde some (nao fica para o proximo visitante).
    expect(armazem.mapa.has(FAVORITES_KEY)).toBe(false);
  });

  it("sem espaco para o Product inteiro, a fila guarda so os ids e o balde sai: a retentativa recupera", async () => {
    // Capacidade pequena: o balde de ids (11 car.) + a fila so de ids (~25)
    // nao cabem juntos, e a fila com o Product inteiro nunca cabe. Trocar o
    // balde pela fila de ids cabe.
    instalarArmazem({ capacidade: 30 });
    mundo.upsert.mockImplementation(async () => FALHA);

    await visitanteEntra(["p1", "p2"]);

    expect(idsDaFila("A")).toEqual(["p1", "p2"]);
    expect(armazem.mapa.has(FAVORITES_KEY)).toBe(false);
    // Os ids estao na fila, entao a promessa do aviso e verdadeira.
    expect(mundo.toastErro).toHaveBeenCalledTimes(1);

    // A rede volta: o evento `online` sobe os dois a partir da fila de ids.
    mundo.upsert.mockClear();
    mundo.upsert.mockImplementation(async () => OK);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    expect(
      mundo.upsert.mock.calls.map(
        (c) => (c[0] as { product_id: string }).product_id,
      ),
    ).toEqual(["p1", "p2"]);
    expect(idsDaFila("A")).toEqual([]);
  });
});

describe("login com muitos favoritos do visitante e rede lenta", () => {
  it("a lista da conta e o fim do loading nao esperam a drenagem (3 x 20 s)", async () => {
    instalarArmazem({});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Os 3 upserts do visitante ficam pendurados (rede lenta, nunca respondem).
    mundo.upsert.mockImplementation(() => new Promise(() => {}));
    mundo.select.mockImplementation(async () => ({
      data: [{ product_id: "conta1", created_at: "2026-01-01T00:00:00Z" }],
      error: null,
    }));

    await visitanteEntra(["p1", "p2", "p3"]);

    // Sem avancar o relogio: a lista da conta ja esta na tela e o esqueleto saiu.
    expect(atual().loading).toBe(false);
    expect(atual().isFavorite("conta1")).toBe(true);
    // A leitura da conta veio ANTES do primeiro upsert da drenagem.
    expect(mundo.ordem.indexOf("select")).toBeGreaterThanOrEqual(0);
    expect(mundo.ordem.indexOf("select")).toBeLessThan(
      mundo.ordem.indexOf("upsert"),
    );
    // A drenagem segue em segundo plano (so o primeiro esta no ar: serial).
    expect(mundo.upsert).toHaveBeenCalledTimes(1);
    expect(mundo.toastErro).not.toHaveBeenCalled();

    // Os 3 prazos de 20 s vencem, um por vez, e o fim relê a conta e avisa.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      await flush();
    }
    expect(mundo.upsert).toHaveBeenCalledTimes(3);
    expect(mundo.toastErro).toHaveBeenCalledTimes(1);
    expect(atual().loading).toBe(false);
    // Nada sumiu: os 3 seguem na fila em disco para a retentativa.
    expect(idsDaFila("A")).toEqual(["p1", "p2", "p3"]);
    // Nada subiu, entao nao ha o que mesclar: so a leitura inicial da conta.
    expect(mundo.select).toHaveBeenCalledTimes(1);
  });

  it("quando a drenagem termina, o que subiu e mesclado a lista da conta, na ordem de created_at", async () => {
    instalarArmazem({});
    const linhas: Array<{ product_id: string; created_at: string }> = [
      { product_id: "conta1", created_at: "2026-01-01T00:00:00Z" },
    ];
    mundo.select.mockImplementation(async () => ({
      data: linhas.map((l) => ({ ...l })),
      error: null,
    }));
    let terminarP1!: () => void;
    mundo.upsert.mockImplementation((o: { product_id: string }) => {
      const gravar = () => {
        linhas.push({
          product_id: o.product_id,
          created_at: `2026-02-0${linhas.length}T00:00:00Z`,
        });
        return OK;
      };
      if (o.product_id !== "p1") return Promise.resolve(gravar());
      return new Promise((resolve) => {
        terminarP1 = () => resolve(gravar());
      });
    });

    await visitanteEntra(["p1", "p2"]);

    // Drenagem ainda no primeiro upsert: a lista da conta ja esta na tela.
    expect(atual().loading).toBe(false);
    expect(atual().favorites.map((p) => p.id)).toEqual(["conta1"]);

    await act(async () => terminarP1());
    await flush();

    expect(atual().favorites.map((p) => p.id)).toEqual(["conta1", "p1", "p2"]);
    expect(mundo.toastSucesso).toHaveBeenCalledTimes(1);
    expect(armazem.mapa.has(FAVORITES_KEY)).toBe(false);
    expect(idsDaFila("A")).toEqual([]);
  });
});
