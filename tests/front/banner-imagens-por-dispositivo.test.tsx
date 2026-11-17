import {
  baseDoRascunho,
  rascunhoSobreOBannerDeHoje,
} from "@/lib/rascunho-do-banner";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  atualizar: vi.fn(),
  inserir: vi.fn(),
  excluir: vi.fn(),
  remover: vi.fn(),
  persistir: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: h.consultar,
        eq: () => ({
          order: () => ({ order: async () => ({ data: [], error: null }) }),
        }),
      }),
      update: h.atualizar,
      insert: h.inserir,
      delete: h.excluir,
    }),
    storage: { from: () => ({ remove: h.remover }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: h.persistir,
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag do React para testes.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const celular = "https://example.com/banners/celular.webp";
const desktop = "https://example.com/banners/computador.webp";
const linha = {
  id: "b1",
  image_url: celular,
  desktop_image_url: desktop,
  title: "Campanha",
  position: "home_top",
  active: true,
  order: 1,
};
let root: Root;
let host: HTMLDivElement;
let atual: ReturnType<typeof import("@/hooks/useBanners").useBanners>;
async function montar(linhas = [linha], adminMode = true) {
  h.consultar.mockResolvedValue({ data: linhas, error: null });
  const { useBanners } = await import("@/hooks/useBanners");
  function Sonda() {
    const valor = useBanners(adminMode);
    useEffect(() => {
      atual = valor;
    });
    return null;
  }
  await act(async () => {
    root.render(<Sonda />);
  });
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.remover.mockResolvedValue({ error: null });
  h.persistir.mockResolvedValue(undefined);
  h.atualizar.mockReturnValue({
    eq: () => ({ select: async () => ({ data: [{ id: "b1" }], error: null }) }),
  });
  h.excluir.mockReturnValue({
    eq: () => ({ select: async () => ({ data: [{ id: "b1" }], error: null }) }),
  });
  h.inserir.mockImplementation((rows) => ({
    select: () => ({
      single: async () => ({ data: { ...linha, ...rows[0] }, error: null }),
    }),
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("imagens de banner independentes", () => {
  it("a Home recebe só banners com imagem de computador, mas painel mantém todos", async () => {
    const ouvir = new Set<() => void>();
    let pc = true;
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return pc;
      },
      addEventListener: (_: string, cb: () => void) => ouvir.add(cb),
      removeEventListener: (_: string, cb: () => void) => ouvir.delete(cb),
    }));
    const soCelular = { ...linha, id: "celular", desktop_image_url: "" };
    try {
      await montar([soCelular, linha], false);
      expect(atual.getBannersByPosition("home_top").map((b) => b.id)).toEqual([
        "b1",
      ]);
      await act(async () => {
        pc = false;
        ouvir.forEach((cb) => cb());
      });
      expect(atual.getBannersByPosition("home_top").map((b) => b.id)).toEqual([
        "celular",
        "b1",
      ]);
      await act(async () => {
        pc = true;
        ouvir.forEach((cb) => cb());
      });
      await montar([soCelular, linha], true);
      expect(atual.getBannersByPosition("home_top").map((b) => b.id)).toEqual([
        "celular",
        "b1",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("a consulta preserva as duas imagens no estado e no cofre", async () => {
    await montar();
    expect(atual.banners[0]).toMatchObject({
      imageUrl: celular,
      desktopImageUrl: desktop,
    });
    expect(h.persistir).toHaveBeenCalledWith(
      "banners",
      expect.arrayContaining([
        expect.objectContaining({ desktopImageUrl: desktop }),
      ]),
    );
  });
  // Dublê fiel ao banco: a linha devolvida nasce com id NOVO e só traz a
  // imagem de computador se o INSERT a gravou. Com o id repetido de "b1", o
  // teste olharia o banner antigo (de imagem já certa) e não o recém-criado.
  function bancoCriaBannerNovo() {
    h.inserir.mockImplementation((rows) => ({
      select: () => ({
        single: async () => ({
          data: { ...linha, id: "novo", desktop_image_url: null, ...rows[0] },
          error: null,
        }),
      }),
    }));
  }
  it("criar grava e devolve a versão de computador no banner recém-criado", async () => {
    bancoCriaBannerNovo();
    await montar();
    await act(async () => {
      await atual.addBanner({
        imageUrl: celular,
        desktopImageUrl: desktop,
        title: "Nova",
        position: "home_top",
        order: 2,
        active: true,
      });
    });
    expect(h.inserir.mock.calls[0][0][0]).toMatchObject({
      image_url: celular,
      desktop_image_url: desktop,
    });
    expect(atual.banners.map((b) => b.id).sort()).toEqual(["b1", "novo"]);
    const novo = atual.banners.find((b) => b.id === "novo");
    expect(novo?.imageUrl).toBe(celular);
    expect(novo?.desktopImageUrl).toBe(desktop);
  });
  it("criar só com imagem de celular deixa o computador null no banner recém-criado", async () => {
    bancoCriaBannerNovo();
    await montar();
    await act(async () => {
      await atual.addBanner({
        imageUrl: celular,
        desktopImageUrl: "",
        title: "Só celular",
        position: "home_top",
        order: 2,
        active: true,
      });
    });
    expect(h.inserir.mock.calls[0][0][0]).toMatchObject({
      image_url: celular,
      desktop_image_url: null,
    });
    const novo = atual.banners.find((b) => b.id === "novo");
    expect(novo?.imageUrl).toBe(celular);
    expect(novo?.desktopImageUrl).toBeNull();
  });
  it("trocar só computador não envia nem apaga a imagem de celular", async () => {
    await montar();
    await act(async () => {
      await atual.updateBanner("b1", {
        desktopImageUrl: "https://example.com/banners/nova.webp",
      });
    });
    expect(h.atualizar).toHaveBeenCalledWith({
      desktop_image_url: "https://example.com/banners/nova.webp",
    });
    expect(atual.banners[0].imageUrl).toBe(celular);
    expect(h.remover).not.toHaveBeenCalledWith(["celular.webp"]);
  });
  it("limpar computador grava null e mantém a imagem compartilhada pelo celular", async () => {
    await montar([{ ...linha, desktop_image_url: celular }]);
    await act(async () => {
      await atual.updateBanner("b1", { desktopImageUrl: null });
    });
    expect(h.atualizar).toHaveBeenCalledWith({ desktop_image_url: null });
    expect(h.remover).not.toHaveBeenCalled();
    expect(atual.banners[0].imageUrl).toBe(celular);
  });
  it("trocar celular não apaga a imagem ainda usada no computador", async () => {
    await montar([{ ...linha, desktop_image_url: celular }]);
    await act(async () => {
      await atual.updateBanner("b1", {
        imageUrl: "https://example.com/banners/nova.webp",
      });
    });
    expect(h.remover).not.toHaveBeenCalled();
    expect(atual.banners[0].desktopImageUrl).toBe(celular);
  });
  it("excluir remove as duas imagens exclusivas", async () => {
    await montar();
    await act(async () => {
      await atual.deleteBanner("b1", celular);
    });
    expect(h.remover).toHaveBeenCalledWith(["celular.webp"]);
    expect(h.remover).toHaveBeenCalledWith(["computador.webp"]);
  });
  it("excluir não apaga a imagem usada no computador de outro banner", async () => {
    await montar([
      linha,
      { ...linha, id: "b2", image_url: desktop, desktop_image_url: celular },
    ]);
    await act(async () => {
      await atual.deleteBanner("b1", celular);
    });
    expect(h.remover).not.toHaveBeenCalled();
  });
  it("rascunho só de computador não desfaz a imagem de celular alterada depois", () => {
    const base = { imageUrl: celular, desktopImageUrl: desktop };
    const recuperado = rascunhoSobreOBannerDeHoje(
      {
        base: baseDoRascunho(base),
        formData: { ...base, desktopImageUrl: "desktop-editado" },
      },
      { ...base, imageUrl: "celular-atual" },
    );
    expect(recuperado).toMatchObject({
      imageUrl: "celular-atual",
      desktopImageUrl: "desktop-editado",
    });
  });
});
