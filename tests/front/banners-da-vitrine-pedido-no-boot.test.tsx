// @vitest-environment jsdom
//
// PRIMEIRA VISITA LENTA: O BANNER DO TOPO ERA O ÚLTIMO ELO DE UMA FILA EM SÉRIE.
//
// O DEFEITO (medido na Savy, 375x812, 4G, CPU 4x): o hook `useBanners` só
// pedia os banners depois que a Home montava (~5,6 s), e a foto do topo só
// começava a descer depois disso. O LCP (a foto do banner) ficava em ~7,2 s.
//
// O CONSERTO: o módulo `banners-da-vitrine` é dono do cache, da consulta, do
// mapeamento e do pré-carregamento da foto, e o StoreProvider o aciona UMA vez
// no boot (junto da configuração). O hook nasce do cache do módulo.
//
// O QUE ESTE ARQUIVO TRAVA (cada caso cai se a peça correspondente sair):
//  - o boot pede os banners uma vez só, e o hook montado depois NÃO repete;
//  - o cache é COMPARTILHADO com o painel: mutação local durante o pedido do
//    boot vence a resposta velha (contador de geração único);
//  - falha de rede no boot não trava a Home em esqueleto e o hook tenta de novo;
//  - a FOTO só é antecipada na rota `/` ou `/home` E quando a URL passa pelo
//    endpoint de redimensionamento (loja sem ele não rouba o cano do JS).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  persistir: vi.fn(),
  de: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      h.de(tabela);
      return { select: () => ({ order: h.consultar }) };
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO_REDIMENSIONAVEL =
  "https://loja.supabase.co/storage/v1/object/public/banners/topo.png";
// Origem do projeto sem o recurso de redimensionamento (a loja IKCOUS).
const FOTO_SEM_REDIMENSIONAMENTO =
  "https://cafkrminfnokvgjqtkle.supabase.co/storage/v1/object/public/banners/topo.png";

function linha(id: string, imagem = FOTO_REDIMENSIONAVEL, extra = {}) {
  return {
    id,
    image_url: imagem,
    title: `Banner ${id}`,
    position: "home_top",
    active: true,
    order: 1,
    ...extra,
  };
}

function bannerLocal(id: string): Banner {
  return {
    id,
    imageUrl: FOTO_REDIMENSIONAVEL,
    title: `Local ${id}`,
    position: "home_top",
    active: true,
    order: 1,
  };
}

class ImagemRegistrada {
  static instancias: ImagemRegistrada[] = [];
  sizes = "";
  srcset = "";
  src = "";
  onerror: (() => void) | null = null;
  constructor() {
    ImagemRegistrada.instancias.push(this);
  }
}

/** Resposta da consulta que só chega quando o teste mandar. */
function respostaPendente() {
  let liberar!: (valor: unknown) => void;
  const promessa = new Promise((resolve) => {
    liberar = resolve;
  });
  return { promessa, liberar };
}

function irParaRota(caminho: string) {
  globalThis.history.pushState({}, "", caminho);
}

describe("banners da vitrine — pedido no boot", () => {
  const raizes: Root[] = [];
  const alvos: HTMLDivElement[] = [];
  let modulo: typeof import("@/lib/banners-da-vitrine");
  let useBanners: typeof import("@/hooks/useBanners").useBanners;

  async function montarHook() {
    const retrato = { banners: [] as Banner[], isLoaded: false };
    function Sonda() {
      const { banners, isLoaded } = useBanners();
      useEffect(() => {
        retrato.banners = banners;
        retrato.isLoaded = isLoaded;
      });
      return null;
    }
    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    const raiz = createRoot(alvo);
    raizes.push(raiz);
    alvos.push(alvo);
    await act(async () => raiz.render(<Sonda />));
    return retrato;
  }

  beforeEach(async () => {
    vi.resetModules();
    ImagemRegistrada.instancias = [];
    vi.stubGlobal("Image", ImagemRegistrada);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.consultar.mockReset();
    h.persistir.mockReset().mockResolvedValue(undefined);
    h.de.mockReset();
    irParaRota("/");
    modulo = await import("@/lib/banners-da-vitrine");
    ({ useBanners } = await import("@/hooks/useBanners"));
  });

  afterEach(() => {
    act(() => {
      for (const raiz of raizes.splice(0)) raiz.unmount();
    });
    for (const alvo of alvos.splice(0)) alvo.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o boot pede os banners UMA vez, mesmo chamado de novo", async () => {
    h.consultar.mockResolvedValue({ data: [linha("a")], error: null });
    modulo.pedirBannersNoBoot();
    modulo.pedirBannersNoBoot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.consultar).toHaveBeenCalledTimes(1);
    expect(h.de).toHaveBeenCalledWith("banners");
    expect(modulo.bannersEmCache()?.map((b) => b.id)).toEqual(["a"]);
    // Mapeado como o hook sempre mapeou (image_url -> imageUrl).
    expect(modulo.bannersEmCache()?.[0].imageUrl).toBe(FOTO_REDIMENSIONAVEL);
    // E gravado no cofre para a próxima visita.
    expect(h.persistir).toHaveBeenCalledTimes(1);
  });

  it("o boot não repete o pedido nem depois que o primeiro terminou (StrictMode, efeito refeito)", async () => {
    h.consultar.mockResolvedValue({ data: [linha("a")], error: null });
    modulo.pedirBannersNoBoot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(modulo.consultaDeBannersEmVoo()).toBeNull();
    modulo.pedirBannersNoBoot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.consultar).toHaveBeenCalledTimes(1);
  });

  it("o hook montado DEPOIS do boot nasce do cache e não repete o pedido", async () => {
    h.consultar.mockResolvedValue({ data: [linha("a")], error: null });
    modulo.pedirBannersNoBoot();
    await act(async () => {
      await Promise.resolve();
    });
    const tela = await montarHook();
    expect(tela.isLoaded).toBe(true);
    expect(tela.banners.map((b) => b.id)).toEqual(["a"]);
    expect(h.consultar).toHaveBeenCalledTimes(1);
  });

  it("o hook que monta com o pedido do boot ainda em voo pega carona nele", async () => {
    const lenta = respostaPendente();
    h.consultar.mockReturnValue(lenta.promessa);
    modulo.pedirBannersNoBoot();
    const tela = await montarHook();
    expect(tela.isLoaded).toBe(false);
    expect(h.consultar).toHaveBeenCalledTimes(1);
    await act(async () => {
      lenta.liberar({ data: [linha("a")], error: null });
    });
    expect(tela.isLoaded).toBe(true);
    expect(tela.banners.map((b) => b.id)).toEqual(["a"]);
    expect(h.consultar).toHaveBeenCalledTimes(1);
  });

  it("mutação local durante o pedido do boot NÃO é sobrescrita pela resposta velha", async () => {
    const lenta = respostaPendente();
    h.consultar.mockReturnValue(lenta.promessa);
    modulo.pedirBannersNoBoot();
    // Uma tela já montada divide a consulta (a Home, por exemplo).
    const tela = await montarHook();
    // O painel cria um banner enquanto o boot ainda espera a rede.
    modulo.gravarBannersLocais([bannerLocal("novo")]);
    h.persistir.mockClear();
    await act(async () => {
      lenta.liberar({ data: [linha("velho")], error: null });
    });
    expect(modulo.bannersEmCache()?.map((b) => b.id)).toEqual(["novo"]);
    expect(tela.banners.map((b) => b.id)).toEqual(["novo"]);
    // A resposta velha também não vai para o cofre.
    expect(h.persistir).not.toHaveBeenCalled();
    // Nem a próxima montagem enxerga o banner velho.
    const proxima = await montarHook();
    expect(proxima.banners.map((b) => b.id)).toEqual(["novo"]);
  });

  it("falha de rede no boot não deixa a Home em esqueleto: o hook tenta de novo ao montar", async () => {
    h.consultar.mockResolvedValueOnce({
      data: null,
      error: { message: "rede caiu" },
    });
    modulo.pedirBannersNoBoot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(modulo.bannersEmCache()).toBeNull();
    // A Home monta depois e a rede voltou: o hook pede de novo, como antes.
    h.consultar.mockResolvedValue({ data: [linha("a")], error: null });
    const tela = await montarHook();
    expect(h.consultar).toHaveBeenCalledTimes(2);
    expect(tela.isLoaded).toBe(true);
    expect(tela.banners.map((b) => b.id)).toEqual(["a"]);
  });

  it("falha do boot com a Home já esperando a carona libera o esqueleto", async () => {
    const lenta = respostaPendente();
    h.consultar.mockReturnValueOnce(lenta.promessa);
    modulo.pedirBannersNoBoot();
    h.consultar.mockResolvedValue({ data: [], error: null });
    const tela = await montarHook();
    expect(tela.isLoaded).toBe(false);
    await act(async () => {
      lenta.liberar({ data: null, error: { message: "rede caiu" } });
    });
    expect(tela.isLoaded).toBe(true);
  });

  it("falha que estoura na hora de montar a consulta não derruba o boot", async () => {
    h.consultar.mockImplementation(() => {
      throw new Error("cliente quebrado");
    });
    expect(() => modulo.pedirBannersNoBoot()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(modulo.bannersEmCache()).toBeNull();
  });

  it("o DADO é pedido em qualquer rota, mesmo sem redimensionamento", async () => {
    irParaRota("/produto/123");
    h.consultar.mockResolvedValue({
      data: [linha("a", FOTO_SEM_REDIMENSIONAMENTO)],
      error: null,
    });
    modulo.pedirBannersNoBoot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.consultar).toHaveBeenCalledTimes(1);
    expect(modulo.bannersEmCache()).toHaveLength(1);
    expect(ImagemRegistrada.instancias).toHaveLength(0);
  });

  describe("a FOTO do topo só é antecipada na Home e quando redimensiona", () => {
    it.each(["/", "/home", "/home/"])(
      "rota %s com foto redimensionável pré-carrega a foto",
      async (rota) => {
        irParaRota(rota);
        h.consultar.mockResolvedValue({ data: [linha("a")], error: null });
        modulo.pedirBannersNoBoot();
        await act(async () => {
          await Promise.resolve();
        });
        expect(ImagemRegistrada.instancias).toHaveLength(1);
        const foto = ImagemRegistrada.instancias[0];
        // A mesma foto que o carrossel vai pedir (srcset e sizes do banner).
        expect(foto.sizes).toBe("100vw");
        expect(foto.srcset).toContain("/render/image/public/");
        expect(foto.src).toContain("/render/image/public/");
      },
    );

    it.each(["/produto/123", "/carrinho", "/admin", "/profile"])(
      "rota %s não pré-carrega a foto (mas o dado vem)",
      async (rota) => {
        irParaRota(rota);
        h.consultar.mockResolvedValue({ data: [linha("a")], error: null });
        modulo.pedirBannersNoBoot();
        await act(async () => {
          await Promise.resolve();
        });
        expect(modulo.bannersEmCache()).toHaveLength(1);
        expect(ImagemRegistrada.instancias).toHaveLength(0);
      },
    );

    it.each([
      ["origem sem redimensionamento (IKCOUS)", FOTO_SEM_REDIMENSIONAMENTO],
      ["URL externa", "https://cdn.exemplo.com/a.png"],
      ["data URL", "data:image/png;base64,AAAA"],
    ])(
      "%s não pré-carrega a foto cedo: não rouba o cano da 2a leva de JS",
      async (_caso, url) => {
        irParaRota("/");
        h.consultar.mockResolvedValue({
          data: [linha("a", url)],
          error: null,
        });
        modulo.pedirBannersNoBoot();
        await act(async () => {
          await Promise.resolve();
        });
        expect(modulo.bannersEmCache()).toHaveLength(1);
        expect(ImagemRegistrada.instancias).toHaveLength(0);
      },
    );

    it("o caminho do hook (sem boot) segue pré-carregando como antes", async () => {
      h.consultar.mockResolvedValue({
        data: [linha("a", "https://cdn.exemplo.com/a.png")],
        error: null,
      });
      await montarHook();
      expect(ImagemRegistrada.instancias).toHaveLength(1);
      expect(ImagemRegistrada.instancias[0].src).toBe(
        "https://cdn.exemplo.com/a.png",
      );
    });
  });
});
