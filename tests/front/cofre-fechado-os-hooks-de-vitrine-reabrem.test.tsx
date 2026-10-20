// @vitest-environment jsdom
//
// COFRE FECHADO NÃO DEIXA A VITRINE PRESA NO HANDLE MORTO (revisão da 1.5.33,
// 16/10/2026).
//
// `useBanners` e `useCategories` guardam o cofre que acharam ao montar. Depois
// de uma saída cancelada (ou de outra aba subir a versão) essa conexão está
// fechada e `isClosed()` diz isso: reler ficava no handle morto (a lista não
// atualizava) e gravar o cache falhava calado. Agora os dois reabrem o cofre.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ouvintes: [] as Array<() => unknown>,
  morta: {
    isClosed: () => true,
    getAll: vi.fn(async () => []),
    getAllOrThrow: vi.fn(async () => {
      throw new Error("InvalidStateError");
    }),
    replaceAll: vi.fn(async () => {
      throw new Error("InvalidStateError");
    }),
    setLastSync: vi.fn(),
  },
  nova: {
    isClosed: () => false,
    getAll: vi.fn(async () => []),
    getAllOrThrow: vi.fn(async () => [] as unknown[]),
    replaceAll: vi.fn(async () => {}),
    setLastSync: vi.fn(),
  },
  chamadasDeInit: 0,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({
  useSyncListener: (_stores: string[], cb: () => unknown) => {
    h.ouvintes.push(cb);
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    // A 1ª abertura (no mount) devolve a conexão que depois morre; as
    // seguintes, a reaberta.
    init: async () => (++h.chamadasDeInit === 1 ? h.morta : h.nova),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    // A rede nunca responde: o que se mede é só o caminho do cofre.
    from: () => ({ select: () => ({ order: () => new Promise(() => {}) }) }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
let atual: { tamanho: number };

beforeEach(() => {
  vi.resetModules();
  h.ouvintes.length = 0;
  h.chamadasDeInit = 0;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

async function montar(hook: "banners" | "categorias") {
  const Sonda =
    hook === "banners"
      ? (await import("@/hooks/useBanners")).useBanners
      : (await import("@/hooks/useCategories")).useCategories;
  function Componente() {
    const r = Sonda() as {
      banners?: unknown[];
      categories?: unknown[];
    };
    useEffect(() => {
      atual = { tamanho: (r.banners ?? r.categories ?? []).length };
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Componente />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe.each([
  ["banners", "banners"],
  ["categorias", "categories"],
] as const)("%s", (hook, loja) => {
  it("o aviso de sincronização relê do cofre REABERTO, não do handle morto", async () => {
    await montar(hook);
    h.nova.getAllOrThrow.mockResolvedValue([
      { id: "x1", name: "N1", title: "T1", isActive: true },
    ]);

    await act(async () => {
      for (const ouvinte of h.ouvintes) await ouvinte();
    });

    expect(h.morta.getAllOrThrow).not.toHaveBeenCalled();
    expect(h.nova.getAllOrThrow).toHaveBeenCalledWith(loja);
    expect(atual.tamanho).toBe(1);
  });
});
