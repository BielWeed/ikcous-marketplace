// @vitest-environment jsdom
import { LazyImage } from "@/components/LazyImage";
import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import { conjuntoDeImagens, imagemRedimensionada } from "@/lib/imageUrl";
import type { Banner } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dados } = vi.hoisted(() => ({
  dados: {
    rede: [] as Banner[] | null,
    vault: [] as Banner[],
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: dados.rede?.map(({ imageUrl, ...banner }) => ({
              ...banner,
              image_url: imageUrl,
            })),
            error: null,
          }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => dados.vault,
      replaceAll: async () => {},
      setLastSync: () => {},
    }),
  },
}));
// Só o motor de movimento exige layout que o jsdom não calcula.
// BannerCarousel, LazyImage e a seleção de URLs permanecem reais.
vi.mock("embla-carousel-react", () => ({ default: () => [null, undefined] }));

const URL_BANNER =
  "https://loja.supabase.co/storage/v1/object/public/banners/topo.png";
const LARGURAS = [200, 320, 480, 640, 960, 1280];

class ImagemRegistrada {
  static instancias: ImagemRegistrada[] = [];
  atribuicoes: string[] = [];
  onerror: (() => void) | null = null;
  private fonte = "";
  private conjunto = "";
  private tamanho = "";

  constructor() {
    ImagemRegistrada.instancias.push(this);
  }

  set sizes(valor: string) {
    this.atribuicoes.push("sizes");
    this.tamanho = valor;
  }
  get sizes() {
    return this.tamanho;
  }
  set srcset(valor: string) {
    this.atribuicoes.push("srcset");
    this.conjunto = valor;
  }
  get srcset() {
    return this.conjunto;
  }
  set src(valor: string) {
    this.atribuicoes.push("src");
    this.fonte = valor;
  }
  get src() {
    return this.fonte;
  }
}

function criarBanner(overrides: Partial<Banner> = {}): Banner {
  return {
    id: "topo",
    imageUrl: URL_BANNER,
    title: "Promoção",
    position: "home_top",
    active: true,
    order: 1,
    ...overrides,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  // Cada cenário começa sem cache de módulo ou fetch pendente do anterior.
  vi.resetModules();
  dados.rede = [];
  dados.vault = [];
  ImagemRegistrada.instancias = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Image", ImagemRegistrada);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montarHome() {
  const { useBanners } = await import("@/hooks/useBanners");
  function Home() {
    const { getBannersByPosition } = useBanners();
    return (
      <BannerCarousel
        banners={getBannersByPosition("home_top")}
        autoPlay={false}
      />
    );
  }
  await act(async () => raiz.render(<Home />));
}

function imagemDoPreload() {
  expect(ImagemRegistrada.instancias).toHaveLength(1);
  return ImagemRegistrada.instancias[0];
}

function imagemDaTela() {
  const imagem = hospedeiro.querySelector("img");
  expect(imagem).not.toBeNull();
  return imagem!;
}

describe("preload do topo e carrossel pedem a mesma foto", () => {
  it("preload recebe srcset, sizes e src redimensionados, nunca o src cru", async () => {
    dados.rede = [criarBanner()];
    await montarHome();
    const imagem = imagemDoPreload();
    expect(imagem.srcset).toBe(conjuntoDeImagens(URL_BANNER, LARGURAS, 70));
    expect(imagem.sizes).toBe("100vw");
    expect(imagem.src).toBe(
      imagemRedimensionada(URL_BANNER, { width: 640, quality: 70 }),
    );
    expect(imagem.src).not.toBe(URL_BANNER);
  });

  it("declara sizes e srcset antes de src para escolher a primeira requisição", async () => {
    dados.rede = [criarBanner()];
    await montarHome();
    expect(imagemDoPreload().atribuicoes).toEqual(["sizes", "srcset", "src"]);
  });

  it("contrato: atributos do carrossel real são idênticos aos do preload", async () => {
    dados.rede = [criarBanner()];
    await montarHome();
    const preload = imagemDoPreload();
    const renderizada = imagemDaTela();
    expect(renderizada.getAttribute("src")).toBe(preload.src);
    expect(renderizada.getAttribute("srcset")).toBe(preload.srcset);
    expect(renderizada.getAttribute("sizes")).toBe(preload.sizes);
  });

  it("também pré-carrega os mesmos atributos quando o banner vem do vault", async () => {
    dados.rede = null;
    dados.vault = [criarBanner()];
    await montarHome();
    const preload = imagemDoPreload();
    expect(preload.srcset).toBe(conjuntoDeImagens(URL_BANNER, LARGURAS, 70));
    expect(preload.sizes).toBe("100vw");
    expect(preload.src).toBe(
      imagemRedimensionada(URL_BANNER, { width: 640, quality: 70 }),
    );
  });

  it.each(["https://cdn.exemplo.com/a.png", "data:image/png;base64,AAAA"])(
    "preserva URL não transformável %s sem candidatas no srcset",
    async (url) => {
      dados.rede = [criarBanner({ imageUrl: url })];
      await montarHome();
      expect(imagemDoPreload().src).toBe(url);
      expect(imagemDoPreload().srcset).toBe("");
      expect(imagemDaTela().getAttribute("src")).toBe(url);
      expect(imagemDaTela().getAttribute("srcset")).toBe("");
    },
  );

  it.each([
    { caso: "lista vazia", banners: [] },
    { caso: "banner inativo", banners: [criarBanner({ active: false })] },
    {
      caso: "outra posição",
      banners: [criarBanner({ position: "home_middle" })],
    },
    { caso: "sem URL", banners: [criarBanner({ imageUrl: "" })] },
  ])("não cria preload para $caso", async ({ banners }) => {
    dados.rede = banners;
    await montarHome();
    expect(ImagemRegistrada.instancias).toHaveLength(0);
    expect(hospedeiro.querySelector("img")).toBeNull();
  });
});

describe("preload tenta a original quando a transformação falha", () => {
  it("erro cria uma segunda imagem com a URL crua e sem nova recuperação", async () => {
    dados.rede = [criarBanner()];
    await montarHome();
    const preload = imagemDoPreload();

    preload.onerror?.();

    expect(ImagemRegistrada.instancias).toHaveLength(2);
    const original = ImagemRegistrada.instancias[1];
    expect(original.src).toBe(URL_BANNER);
    expect(original.srcset).toBe("");
    expect(original.sizes).toBe("");
    expect(original.atribuicoes).toEqual(["src"]);
    expect(original.onerror).toBeNull();
    original.onerror?.();
    expect(ImagemRegistrada.instancias).toHaveLength(2);
  });

  it("dois erros no preload criam apenas uma tentativa da original", async () => {
    dados.rede = [criarBanner()];
    await montarHome();
    const preload = imagemDoPreload();

    preload.onerror?.();
    preload.onerror?.();

    expect(ImagemRegistrada.instancias).toHaveLength(2);
    expect(ImagemRegistrada.instancias[1].src).toBe(URL_BANNER);
  });

  it("sem erro mantém só o preload redimensionado", async () => {
    dados.rede = [criarBanner()];
    await montarHome();

    expect(imagemDoPreload().src).not.toBe(URL_BANNER);
    expect(ImagemRegistrada.instancias).toHaveLength(1);
  });

  it("URL não transformável não registra recuperação nem repete a original", async () => {
    dados.rede = [criarBanner({ imageUrl: "https://cdn.exemplo.com/a.png" })];
    await montarHome();
    const preload = imagemDoPreload();

    expect(preload.onerror).toBeNull();
    preload.onerror?.();

    expect(ImagemRegistrada.instancias).toHaveLength(1);
  });
});

describe("LazyImage preserva os atributos anteriores", () => {
  it.each([
    { sizes: undefined, quality: undefined },
    { sizes: "", quality: 90 },
    { sizes: "100vw", quality: undefined },
    { sizes: "50vw", quality: 83 },
  ])("preserva sizes=$sizes e quality=$quality", ({ sizes, quality }) => {
    act(() => {
      raiz.render(
        <LazyImage
          src={URL_BANNER}
          alt="Foto"
          priority
          sizes={sizes}
          quality={quality}
        />,
      );
    });
    const imagem = imagemDaTela();
    expect(imagem.getAttribute("src")).toBe(
      sizes
        ? imagemRedimensionada(URL_BANNER, {
            width: 640,
            quality: quality ?? 75,
          })
        : URL_BANNER,
    );
    expect(imagem.getAttribute("srcset")).toBe(
      sizes ? conjuntoDeImagens(URL_BANNER, LARGURAS, quality ?? 75) : null,
    );
    expect(imagem.getAttribute("sizes")).toBe(sizes || null);
  });

  it("após erro na transformação tenta o original sem srcset nem sizes", () => {
    act(() => {
      raiz.render(
        <LazyImage src={URL_BANNER} alt="Foto" priority sizes="100vw" />,
      );
    });
    act(() => imagemDaTela().dispatchEvent(new Event("error")));
    const imagem = imagemDaTela();
    expect(imagem.getAttribute("src")).toBe(URL_BANNER);
    expect(imagem.getAttribute("srcset")).toBeNull();
    expect(imagem.getAttribute("sizes")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Erro ao carregar");
    act(() => imagem.dispatchEvent(new Event("error")));
    expect(hospedeiro.textContent).toContain("Erro ao carregar");
  });
});
