// @vitest-environment jsdom
import {
  _syncOfflineUpdatesParaTeste,
  copiarImagemParaDuplicacao,
  useProducts,
} from "@/hooks/useProducts";
import {
  assinarOperacoesSensiveis,
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const rede = vi.hoisted(() => ({
  copy: vi.fn(),
  upload: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
}));
const foto =
  "https://proj.supabase.co/storage/v1/object/public/products/foto.jpg";
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        copy: rede.copy,
        upload: rede.upload,
        getPublicUrl: () => ({ data: { publicUrl: "copia.jpg" } }),
      }),
    },
    from: () => ({ update: () => ({ eq: rede.update }) }),
    rpc: () => ({
      abortSignal: async () => ({
        data: {
          data: [{ id: "produto-1", images: [foto] }],
          total_count: 1,
        },
        error: null,
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: rede.refresh,
  }),
}));
vi.mock("@/lib/mappers", () => ({ mapProductFromDB: (p: unknown) => p }));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: async (arquivo: File) => arquivo,
}));
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useProducts>;
function Sonda() {
  const valor = useProducts({ autoFetch: false });
  useEffect(() => {
    api = valor;
  });
  return null;
}

describe("produtos vetam atualização nas imagens e na fila offline", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  const chave = "products_offline_updates_queue:lojista-1";
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    rede.update.mockResolvedValue({ error: null });
    rede.refresh.mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "duplicação pendente veta e libera (erro=%s)",
    async (erro) => {
      const envio = adiar<{ error: null }>();
      rede.copy.mockReturnValue(envio.promessa);
      const resultado = copiarImagemParaDuplicacao(foto).catch(
        (e: unknown) => e,
      );
      try {
        expect(rede.copy).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "copia-de-imagem-do-produto",
        ]);
      } finally {
        if (erro) envio.rejeitar(new Error("falha simulada"));
        else envio.resolver({ error: null });
        await resultado;
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "upload pendente veta e libera (erro=%s)",
    async (erro) => {
      await act(async () => {
        raiz.render(<Sonda />);
      });
      const envio = adiar<{ error: null }>();
      rede.upload.mockReturnValue(envio.promessa);
      let resultado!: Promise<string[]>;
      await act(async () => {
        resultado = api.uploadProductImages([
          new File(["foto"], "f.jpg", { type: "image/jpeg" }),
        ]);
      });
      try {
        expect(rede.upload).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "upload-de-imagem-do-produto",
        ]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver({ error: null });
          await resultado;
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "cópia para backup pendente veta e libera (erro=%s)",
    async (erro) => {
      await act(async () => {
        raiz.render(<Sonda />);
      });
      await act(async () => {
        await api.loadProducts();
      });
      const envio = adiar<{ error: null }>();
      rede.copy.mockReturnValue(envio.promessa);
      let resultado!: Promise<unknown>;
      await act(async () => {
        resultado = api.deleteProduct("produto-1");
      });
      try {
        expect(rede.copy).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "backup-de-imagem-do-produto",
        ]);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver({ error: null });
          await resultado;
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "fila pendente veta e libera sem perder falhas (erro=%s)",
    async (erro) => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      localStorage.setItem(
        chave,
        JSON.stringify([
          {
            id: "produto-1",
            updates: { stock: 2 },
            timestamp: Date.now(),
          },
        ]),
      );
      const envio = adiar<{ error: null }>();
      rede.update.mockReturnValue(envio.promessa);
      const resultado = _syncOfflineUpdatesParaTeste("lojista-1");
      await Promise.resolve();
      await Promise.resolve();
      try {
        expect(rede.update).toHaveBeenCalledTimes(1);
        expect(haOperacaoSensivel()).toBe(true);
        expect(motivosDeOperacaoSensivel()).toEqual([
          "fila-offline-de-produtos",
        ]);
      } finally {
        if (erro) envio.rejeitar(new Error("falha simulada"));
        else envio.resolver({ error: null });
        await resultado;
      }
      expect(haOperacaoSensivel()).toBe(false);
      expect(localStorage.getItem(chave) !== null).toBe(erro);
    },
  );

  it("a fila mantém a marca entre dois produtos", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    localStorage.setItem(
      chave,
      JSON.stringify([
        { id: "produto-1", updates: { stock: 2 }, timestamp: Date.now() },
        { id: "produto-2", updates: { stock: 3 }, timestamp: Date.now() },
      ]),
    );
    const primeiro = adiar<{ error: null }>();
    const segundo = adiar<{ error: null }>();
    rede.update
      .mockReturnValueOnce(primeiro.promessa)
      .mockReturnValueOnce(segundo.promessa);
    const estados: boolean[] = [];
    const desassinar = assinarOperacoesSensiveis(() => {
      estados.push(haOperacaoSensivel());
    });
    const resultado = _syncOfflineUpdatesParaTeste("lojista-1");
    try {
      await act(async () => {
        primeiro.resolver({ error: null });
      });
      expect(rede.update).toHaveBeenCalledTimes(2);
      expect(haOperacaoSensivel()).toBe(true);
      expect(estados).toEqual([true]);
    } finally {
      primeiro.resolver({ error: null });
      segundo.resolver({ error: null });
      await resultado;
      desassinar();
    }
    expect(estados).toEqual([true, false]);
    expect(haOperacaoSensivel()).toBe(false);
  });
});
