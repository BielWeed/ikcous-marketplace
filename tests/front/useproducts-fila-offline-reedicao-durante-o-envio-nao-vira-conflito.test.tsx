// @vitest-environment jsdom
//
// Fila offline de produtos: o lojista edita o produto sem internet (edicao A),
// a rede volta e o envio de A comeca; a conexao oscila e ele edita o MESMO
// produto de novo (edicao B). A reedicao funde os patches e guarda a base da
// PRIMEIRA edicao (V0). Mas o envio de A, ao dar certo, ja trocou a versao do
// produto no servidor (V1): na passada seguinte o UPDATE de B usava V0, dava 0
// linhas e B era descartada como "alterado em outro lugar" sem ninguem ter
// editado em outro aparelho. A base de B tem de avancar para V1 -- e so ela, e
// so quando o envio de A de fato gravou.
import { _syncOfflineUpdatesParaTeste, useProducts } from "@/hooks/useProducts";
import type { Product } from "@/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const V0 = "2026-11-01T10:00:00.000001+00:00";
const CHAVE = "products_offline_updates_queue:lojista-1";

const servidor = vi.hoisted(() => ({
  versoes: new Map<string, string>(),
  tentativas: [] as { id: string; base: unknown }[],
  gravacoes: [] as {
    id: string;
    base: unknown;
    payload: Record<string, unknown>;
  }[],
  segurar: new Map<string, Promise<void>>(),
  falhar: new Set<string>(),
  contador: 0,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: produtosDaTela,
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "sync"),
    dismiss: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: async () => ({
        data: { data: [], total_count: 0 },
        error: null,
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const filtros = new Map<string, unknown>();
        const consulta = {
          eq: (coluna: string, valor: unknown) => {
            filtros.set(coluna, valor);
            return consulta;
          },
          is: () => consulta,
          // Servidor de mentira: o UPDATE so grava se a versao-base casa, e
          // gravar troca a versao (como o gatilho de `ultima_atualizacao`).
          select: async () => {
            const id = String(filtros.get("id"));
            const base = filtros.get("ultima_atualizacao");
            servidor.tentativas.push({ id, base });
            await servidor.segurar.get(id);
            if (servidor.falhar.has(id)) {
              return { data: null, error: { message: "Failed to fetch" } };
            }
            if (servidor.versoes.get(id) !== base) {
              return { data: [], error: null };
            }
            servidor.contador += 1;
            const nova = `2026-11-01T11:00:0${servidor.contador}+00:00`;
            servidor.versoes.set(id, nova);
            servidor.gravacoes.push({ id, base, payload });
            return { data: [{ id, ultima_atualizacao: nova }], error: null };
          },
        };
        return consulta;
      },
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, name: string): Product {
  return {
    id,
    name,
    price: 30,
    stock: 8,
    description: "",
    category: "Casa",
    images: [],
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: V0,
    updatedAt: V0,
  };
}

// `vi.mock` e icado para o topo: a lista da tela e lida so na hora da chamada.
let produtosDaTela: Product[] = [];
let online = true;
type Api = ReturnType<typeof useProducts>;
let api: Api | undefined;

function Sonda() {
  const atual = useProducts({ autoFetch: true });
  useEffect(() => {
    api = atual;
  });
  return null;
}

type ItemDaFila = {
  id: string;
  updates: Record<string, unknown>;
  baseUpdatedAt?: string;
  timestamp: number;
};
const lerFila = (): ItemDaFila[] =>
  JSON.parse(localStorage.getItem(CHAVE) ?? "[]");

/** Edicao feita sem internet: o caminho real de `updateProduct` que enfileira. */
async function editarSemInternet(id: string, updates: Partial<Product>) {
  online = false;
  try {
    await act(async () => {
      await api?.updateProduct(id, updates);
    });
  } finally {
    online = true;
  }
}

/** Garante que o `timestamp` da reedicao seja maior que o do envio em curso. */
const passarUmInstante = () => new Promise((r) => setTimeout(r, 8));

function segurarEnvioDe(id: string) {
  let liberar!: () => void;
  servidor.segurar.set(
    id,
    new Promise<void>((resolve) => {
      liberar = resolve;
    }),
  );
  return liberar;
}

describe("fila offline de produtos — reedicao durante o envio do mesmo produto", () => {
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    servidor.versoes = new Map([
      ["p1", V0],
      ["p2", V0],
    ]);
    servidor.tentativas = [];
    servidor.gravacoes = [];
    servidor.segurar = new Map();
    servidor.falhar = new Set();
    servidor.contador = 0;
    produtosDaTela = [produto("p1", "Caneca"), produto("p2", "Bule")];
    root = createRoot(document.createElement("div"));
    // Monta sem internet: a tela nao dispara sincronizacao sozinha.
    await act(async () => root.render(<Sonda />));
    online = true;
  });

  afterEach(async () => {
    servidor.segurar.forEach((_, id) => {
      servidor.segurar.set(id, Promise.resolve());
    });
    await act(async () => root.unmount());
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("(1) a base da segunda edicao avanca para a versao que o envio da primeira criou", async () => {
    await editarSemInternet("p1", { price: 35 });
    expect(lerFila()).toHaveLength(1);
    expect(lerFila()[0].baseUpdatedAt).toBe(V0);

    const liberar = segurarEnvioDe("p1");
    const passada1 = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(servidor.tentativas).toHaveLength(1));
    await passarUmInstante();
    await editarSemInternet("p1", { name: "Caneca grande" });
    liberar();
    expect(await passada1).toBe(true);

    const v1 = servidor.versoes.get("p1");
    expect(v1).not.toBe(V0);
    expect(servidor.gravacoes).toEqual([
      { id: "p1", base: V0, payload: { preco_venda: 35 } },
    ]);
    // A fila guarda B com a base nova e os campos de A + B fundidos.
    expect(lerFila()).toEqual([
      expect.objectContaining({
        id: "p1",
        baseUpdatedAt: v1,
        updates: { price: 35, name: "Caneca grande" },
      }),
    ]);

    // Passada seguinte: o UPDATE de B usa V1, aplica e nao avisa conflito.
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(true);
    expect(servidor.tentativas[1]).toEqual({ id: "p1", base: v1 });
    expect(servidor.gravacoes[1]).toEqual({
      id: "p1",
      base: v1,
      payload: { preco_venda: 35, nome: "Caneca grande" },
    });
    expect(toast.warning).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("(2) edicao durante o envio de OUTRO produto nao mexe na base dele", async () => {
    await editarSemInternet("p1", { price: 35 });
    const liberar = segurarEnvioDe("p1");
    const passada = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(servidor.tentativas).toHaveLength(1));
    await passarUmInstante();
    await editarSemInternet("p2", { name: "Bule grande" });
    liberar();
    expect(await passada).toBe(true);

    expect(servidor.versoes.get("p1")).not.toBe(V0);
    expect(lerFila()).toEqual([
      expect.objectContaining({
        id: "p2",
        baseUpdatedAt: V0,
        updates: { name: "Bule grande" },
      }),
    ]);
    // E ela ainda sai: p2 nao foi tocado pela passada de p1.
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(true);
    expect(servidor.gravacoes[1]).toMatchObject({ id: "p2", base: V0 });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("(3) envio da primeira edicao falhou: ela volta com a base antiga, sem avancar", async () => {
    await editarSemInternet("p1", { price: 35 });
    servidor.falhar.add("p1");
    const liberar = segurarEnvioDe("p1");
    const passada = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(servidor.tentativas).toHaveLength(1));
    await passarUmInstante();
    await editarSemInternet("p1", { name: "Caneca grande" });
    liberar();
    expect(await passada).toBe(false);

    expect(servidor.gravacoes).toEqual([]);
    expect(servidor.versoes.get("p1")).toBe(V0);
    expect(lerFila()).toEqual([
      expect.objectContaining({
        id: "p1",
        baseUpdatedAt: V0,
        updates: { price: 35, name: "Caneca grande" },
      }),
    ]);

    // Rede boa de novo: a base antiga ainda e a certa e tudo sai de uma vez.
    servidor.falhar.clear();
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(true);
    expect(servidor.gravacoes).toEqual([
      {
        id: "p1",
        base: V0,
        payload: { preco_venda: 35, nome: "Caneca grande" },
      },
    ]);
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("(3b) sobra de uma passada anterior nao vale para um envio que falhou agora", async () => {
    // Uma passada que grava p1 e e interrompida antes de a tela limpar o
    // registro das versoes deixa p1 -> versao nova la dentro. Aqui a passada
    // direta do teste faz o mesmo (nada a limpa).
    await editarSemInternet("p1", { price: 35 });
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(true);
    const sobra = servidor.versoes.get("p1") as string;

    // O servidor e a tela voltam a uma versao conhecida; nova edicao de p1.
    servidor.versoes.set("p1", V0);
    await editarSemInternet("p1", { price: 40 });
    servidor.falhar.add("p1");
    const liberar = segurarEnvioDe("p1");
    const passada = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(servidor.tentativas).toHaveLength(2));
    await passarUmInstante();
    await editarSemInternet("p1", { name: "Caneca grande" });
    liberar();
    await passada;

    const [item] = lerFila();
    expect(item.baseUpdatedAt).toBe(V0);
    expect(item.baseUpdatedAt).not.toBe(sobra);
  });

  it("(4) outro aparelho editou: a primeira conflita, nada avanca e o conflito segue como antes", async () => {
    await editarSemInternet("p1", { price: 35 });
    servidor.versoes.set("p1", "2026-11-01T09:00:00+00:00");
    const liberar = segurarEnvioDe("p1");
    const passada = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(servidor.tentativas).toHaveLength(1));
    await passarUmInstante();
    await editarSemInternet("p1", { name: "Caneca grande" });
    liberar();
    expect(await passada).toBe(false);

    const aviso =
      "O produto Caneca foi alterado em outro lugar; sua edição offline não foi aplicada.";
    expect(toast.warning).toHaveBeenCalledWith(aviso);
    expect(servidor.gravacoes).toEqual([]);
    // B segue com a base que tinha (V0): quem decide e o conflito de verdade.
    expect(lerFila()).toEqual([
      expect.objectContaining({ id: "p1", baseUpdatedAt: V0 }),
    ]);
    expect(await _syncOfflineUpdatesParaTeste("lojista-1")).toBe(false);
    expect(servidor.gravacoes).toEqual([]);
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it("(5) item legado sem base continua sem base, mesmo reeditado durante o envio de outro", async () => {
    localStorage.setItem(
      CHAVE,
      JSON.stringify([
        {
          id: "p1",
          productName: "Caneca",
          updates: { price: 35 },
          baseUpdatedAt: V0,
          timestamp: Date.now() - 5000,
        },
        {
          id: "p2",
          productName: "Bule",
          updates: { stock: 3 },
          timestamp: Date.now() - 5000,
        },
      ]),
    );
    const liberar = segurarEnvioDe("p1");
    const passada = _syncOfflineUpdatesParaTeste("lojista-1");
    await vi.waitFor(() => expect(servidor.tentativas).toHaveLength(1));
    await editarSemInternet("p2", { name: "Bule grande" });
    liberar();
    await passada;

    expect(servidor.gravacoes).toHaveLength(1);
    const final = lerFila();
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe("p2");
    expect(final[0].baseUpdatedAt).toBeUndefined();
    expect(final[0].updates).toEqual({ stock: 3, name: "Bule grande" });
  });
});
