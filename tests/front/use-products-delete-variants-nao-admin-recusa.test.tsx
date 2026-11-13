// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProducts } from "@/hooks/useProducts";

const h = vi.hoisted(() => ({
  admin: false,
  from: vi.fn(),
  select: vi.fn(),
  filtroIds: vi.fn(),
  delete: vi.fn(),
  filtroId: vi.fn(),
  storage: vi.fn(),
  rpc: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
  atualizar: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "usuario-teste" },
    isAdmin: h.admin,
    loading: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: h.atualizar,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: h.sucesso, info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: h.from,
    rpc: h.rpc,
    storage: { from: h.storage },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("deleteVariants exige administrador antes de acessar o Supabase", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let produtos: ReturnType<typeof useProducts>;

  function Sonda() {
    const valor = useProducts({ autoFetch: false });
    useEffect(() => {
      produtos = valor;
    });
    return null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    h.admin = false;
    h.filtroIds.mockResolvedValue({ data: [], error: null });
    // `.select("id")` depois do `.eq()`: devolve a linha que o banco apagou.
    h.filtroId.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: "v-1" }], error: null }),
    });
    h.select.mockReturnValue({ in: h.filtroIds });
    h.delete.mockReturnValue({ eq: h.filtroId });
    h.from.mockReturnValue({ select: h.select, delete: h.delete });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(admin: boolean) {
    h.admin = admin;
    await act(async () => {
      raiz.render(<Sonda />);
    });
    vi.clearAllMocks();
  }

  it("não-admin recebe false e permissão negada sem consulta, exclusão ou storage", async () => {
    await montar(false);
    let retorno: unknown;
    await act(async () => {
      retorno = await produtos.deleteVariants(["v-1"]);
    });

    // Primeiro o efeito proibido: false sozinho também poderia vir do banco.
    for (const chamada of [
      h.from,
      h.select,
      h.filtroIds,
      h.delete,
      h.filtroId,
      h.storage,
      h.rpc,
    ]) {
      expect(chamada).not.toHaveBeenCalled();
    }
    expect(retorno).toBe(false);
    expect(h.erro).toHaveBeenCalledExactlyOnceWith("Permissão negada");
    expect(h.sucesso).not.toHaveBeenCalled();
    expect(h.atualizar).not.toHaveBeenCalled();
  });

  it("administrador consulta e apaga a variante solicitada (controle do dublê)", async () => {
    await montar(true);
    let retorno: unknown;
    await act(async () => {
      retorno = await produtos.deleteVariants(["v-1"]);
    });

    expect(h.from).toHaveBeenCalledTimes(2);
    expect(h.from).toHaveBeenNthCalledWith(1, "product_variants");
    expect(h.from).toHaveBeenNthCalledWith(2, "product_variants");
    expect(h.select).toHaveBeenCalledExactlyOnceWith("id, image_url");
    expect(h.filtroIds).toHaveBeenCalledExactlyOnceWith("id", ["v-1"]);
    expect(h.delete).toHaveBeenCalledExactlyOnceWith();
    expect(h.filtroId).toHaveBeenCalledExactlyOnceWith("id", "v-1");
    expect(retorno).toBe(true);
    expect(h.erro).not.toHaveBeenCalled();
    expect(h.sucesso).toHaveBeenCalledExactlyOnceWith("Variações removidas");
  });
});
