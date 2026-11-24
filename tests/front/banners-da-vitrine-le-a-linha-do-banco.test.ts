// @vitest-environment jsdom
//
// Como a vitrine LÊ a linha de banner do banco: o que vira o que a cliente vê.
// Cada valor "falso mas legítimo" precisa sobreviver à leitura -- banner PAUSADO
// continua pausado (`active: false` não vira ligado), opacidade 0 é uma escolha
// da lojista (não cai no padrão), textos escondidos continuam escondidos -- e a
// coluna antiga (`imagem_url`, `ativo`) ainda vale em loja que não migrou.
// Linha sem foto nenhuma não vira banner.
//
// Cada caso monta o módulo do zero (o cache e a consulta em voo são do módulo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  persistir: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ order: h.consultar }),
      }),
    }),
  },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      replaceAll: h.persistir,
      setLastSync: vi.fn(),
    }),
  },
}));

const FOTO = "https://loja.test/storage/v1/object/public/banners/a.png";
const FOTO_PC = "https://loja.test/storage/v1/object/public/banners/pc.png";

type Linha = Record<string, unknown>;

const linha = (extra: Linha = {}): Linha => ({
  id: "b1",
  image_url: FOTO,
  position: "home_top",
  ...extra,
});

async function ler(linhas: Linha[] | null) {
  h.consultar.mockResolvedValue({ data: linhas, error: null });
  vi.resetModules();
  const { pedirBanners } = await import("@/lib/banners-da-vitrine");
  return pedirBanners();
}

/** A primeira linha lida; falha com frase clara se nenhuma virou banner. */
async function lerUm(linhas: Linha[]) {
  const [primeiro] = await ler(linhas);
  if (!primeiro) throw new Error("nenhum banner foi lido");
  return primeiro;
}

beforeEach(() => {
  h.consultar.mockReset();
  h.persistir.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a linha do banco vira o banner da vitrine", () => {
  it("lê todas as colunas, nos nomes do app", async () => {
    const banner = await lerUm([
      linha({
        desktop_image_url: FOTO_PC,
        title: "Natal",
        link: "/?category=Natal",
        active: true,
        order: 3,
        subtitle: "Até 50%",
        title_color: "#111111",
        subtitle_color: "#222222",
        button_text: "Ver",
        button_bg_color: "#333333",
        button_text_color: "#444444",
        font_family: "Inter",
        overlay_color: "#000000",
        overlay_opacity: 55,
        badge_text: "NOVO",
        template_type: "modelo-foto",
        product_id: "p9",
        start_date: "2026-12-01T09:00:00.000Z",
        end_date: "2026-12-25T23:00:00.000Z",
        show_text_overlay: false,
      }),
    ]);

    expect(banner).toEqual({
      id: "b1",
      imageUrl: FOTO,
      desktopImageUrl: FOTO_PC,
      title: "Natal",
      link: "/?category=Natal",
      position: "home_top",
      active: true,
      order: 3,
      subtitle: "Até 50%",
      titleColor: "#111111",
      subtitleColor: "#222222",
      buttonText: "Ver",
      buttonBgColor: "#333333",
      buttonTextColor: "#444444",
      fontFamily: "Inter",
      overlayColor: "#000000",
      overlayOpacity: 55,
      badgeText: "NOVO",
      templateType: "modelo-foto",
      productId: "p9",
      startDate: "2026-12-01T09:00:00.000Z",
      endDate: "2026-12-25T23:00:00.000Z",
      showTextOverlay: false,
    });
  });

  it("coluna ausente ou nula vira o padrão da vitrine", async () => {
    const banner = await lerUm([linha()]);

    expect(banner).toMatchObject({
      desktopImageUrl: null,
      title: "",
      link: undefined,
      active: true,
      order: 0,
      subtitle: "",
      titleColor: "",
      subtitleColor: "",
      buttonText: "",
      buttonBgColor: "",
      buttonTextColor: "",
      fontFamily: "",
      overlayColor: "",
      overlayOpacity: undefined,
      badgeText: "",
      templateType: "default",
      productId: undefined,
      startDate: null,
      endDate: null,
      showTextOverlay: true,
    });
  });

  it("link e produto vazios ou nulos viram 'sem destino' (ausente), nunca texto vazio", async () => {
    const vazios = await lerUm([linha({ link: "", product_id: "" })]);
    expect(vazios.link).toBeUndefined();
    expect(vazios.productId).toBeUndefined();

    const nulos = await lerUm([linha({ link: null, product_id: null })]);
    expect(nulos.link).toBeUndefined();
    expect(nulos.productId).toBeUndefined();

    const cheios = await lerUm([linha({ link: "/cart", product_id: "p1" })]);
    expect(cheios.link).toBe("/cart");
    expect(cheios.productId).toBe("p1");
  });

  it("banner PAUSADO continua pausado, na coluna nova e na antiga", async () => {
    const novo = await lerUm([linha({ active: false })]);
    expect(novo.active).toBe(false);

    const antigo = await lerUm([linha({ active: null, ativo: false })]);
    expect(antigo.active).toBe(false);
  });

  it("a coluna `active` vale mais que a antiga `ativo`", async () => {
    const banner = await lerUm([linha({ active: true, ativo: false })]);
    expect(banner.active).toBe(true);
  });

  it("loja que ainda usa `imagem_url` mostra a foto", async () => {
    const banners = await ler([
      { id: "b1", imagem_url: FOTO, position: "home_top" },
    ]);

    expect(banners).toHaveLength(1);
    expect(banners[0]?.imageUrl).toBe(FOTO);
  });

  it("a coluna `image_url` vale mais que a antiga `imagem_url`", async () => {
    const banner = await lerUm([
      linha({ imagem_url: "https://loja.test/antiga.png" }),
    ]);
    expect(banner.imageUrl).toBe(FOTO);
  });

  it("opacidade 0 é uma escolha: não vira o padrão nem some", async () => {
    const zero = await lerUm([linha({ overlay_opacity: 0 })]);
    expect(zero.overlayOpacity).toBe(0);

    const texto = await lerUm([linha({ overlay_opacity: "35" })]);
    expect(texto.overlayOpacity).toBe(35);
  });

  it("textos escondidos continuam escondidos; ausente vale 'visíveis'", async () => {
    const escondido = await lerUm([linha({ show_text_overlay: false })]);
    expect(escondido.showTextOverlay).toBe(false);

    const ausente = await lerUm([linha({ show_text_overlay: null })]);
    expect(ausente.showTextOverlay).toBe(true);
  });

  it("ordem zero ou nula vira 0, e a ordem da lojista é mantida", async () => {
    const nula = await lerUm([linha({ order: null })]);
    expect(nula.order).toBe(0);

    const quatro = await lerUm([linha({ order: 4 })]);
    expect(quatro.order).toBe(4);
  });

  it("linha sem foto nenhuma não vira banner; as outras continuam", async () => {
    const banners = await ler([
      linha({ id: "sem-foto", image_url: null }),
      linha({ id: "foto-vazia", image_url: "" }),
      linha({ id: "com-foto" }),
    ]);

    expect(banners.map((b) => b.id)).toEqual(["com-foto"]);
  });

  it("loja sem banner devolve lista vazia; resposta sem dados também, e esta não grava no cofre", async () => {
    expect(await ler([])).toEqual([]);

    h.persistir.mockClear();
    expect(await ler(null)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.persistir).not.toHaveBeenCalled();
  });

  it("a lista lida vai para o cofre do aparelho, já no formato do app", async () => {
    const banners = await ler([linha({ title: "Natal" })]);

    await vi.waitFor(() =>
      expect(h.persistir).toHaveBeenCalledWith("banners", banners),
    );
    expect(banners[0]?.title).toBe("Natal");
  });
});

describe("a foto que a vitrine baixa antes de a Home montar", () => {
  const imagens: { src: string }[] = [];

  beforeEach(() => {
    imagens.length = 0;
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        srcset = "";
        sizes = "";
        onerror: (() => void) | null = null;
        constructor() {
          imagens.push(this);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("só a foto do banner do TOPO é antecipada, não a do meio nem a do rodapé", async () => {
    await ler([
      linha({ id: "meio", position: "home_middle", image_url: `${FOTO}?meio` }),
      linha({
        id: "rodape",
        position: "home_bottom",
        image_url: `${FOTO}?rodape`,
      }),
    ]);

    expect(imagens).toEqual([]);
  });

  it("a foto do banner do topo que está no ar é pedida", async () => {
    await ler([
      linha({ id: "meio", position: "home_middle", image_url: `${FOTO}?meio` }),
      linha({ id: "topo" }),
    ]);

    // A loja redimensiona: o endereço pedido é o da MESMA foto, já reduzida.
    expect(imagens).toHaveLength(1);
    expect(imagens[0]?.src).toContain("/banners/a.png");
  });
});
