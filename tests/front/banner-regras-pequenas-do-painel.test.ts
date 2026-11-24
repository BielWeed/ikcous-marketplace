import {
  imagemDoBannerEmUso,
  imagemDoBannerParaTela,
  imagensDoBanner,
} from "@/lib/imagens-do-banner";
// Regras pequenas e puras que decidem o que a lojista e a cliente veem do banner:
//  - qual foto vale em cada tela (sem trocar a do celular pela do computador);
//  - quais fotos um banner usa, para o arquivo só ser apagado quando NINGUÉM mais
//    o usa;
//  - se o banner tem texto, e em que modo o editor abre;
//  - quanto tempo vale o pedido de "Novo banner" feito antes de a tela carregar.
import {
  bannerTemTexto,
  modoAoAbrirOBanner,
} from "@/lib/modo-do-editor-de-banner";
import {
  EVENTO_NOVO_BANNER,
  consumirPedidoDeNovoBanner,
  pedirNovoBanner,
} from "@/lib/novo-banner-pendente";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CELULAR = "https://x.test/celular.jpg";
const COMPUTADOR = "https://x.test/computador.jpg";

describe("a foto que vale em cada tela", () => {
  it("o celular usa a foto do celular e o computador a do computador", () => {
    const banner = { imageUrl: CELULAR, desktopImageUrl: COMPUTADOR };
    expect(imagemDoBannerParaTela(banner, false)).toBe(CELULAR);
    expect(imagemDoBannerParaTela(banner, true)).toBe(COMPUTADOR);
  });

  it("foto ausente numa tela NÃO é emprestada da outra", () => {
    expect(imagemDoBannerParaTela({ imageUrl: CELULAR }, true)).toBeNull();
    expect(
      imagemDoBannerParaTela({ desktopImageUrl: COMPUTADOR }, false),
    ).toBeNull();
  });

  it("endereço vazio ou só com espaços é foto ausente", () => {
    expect(imagemDoBannerParaTela({ imageUrl: "   " }, false)).toBeNull();
    expect(imagemDoBannerParaTela({ desktopImageUrl: "" }, true)).toBeNull();
    expect(imagemDoBannerParaTela({ desktopImageUrl: null }, true)).toBeNull();
    expect(imagemDoBannerParaTela({}, false)).toBeNull();
  });
});

describe("as fotos que o banner usa", () => {
  it("lista celular e computador, sem repetir quando é o mesmo arquivo", () => {
    expect(
      imagensDoBanner({ imageUrl: CELULAR, desktopImageUrl: COMPUTADOR }),
    ).toEqual([CELULAR, COMPUTADOR]);
    expect(
      imagensDoBanner({ imageUrl: CELULAR, desktopImageUrl: CELULAR }),
    ).toEqual([CELULAR]);
  });

  it("deixa de fora o que está ausente, vazio ou nulo", () => {
    expect(
      imagensDoBanner({ imageUrl: CELULAR, desktopImageUrl: null }),
    ).toEqual([CELULAR]);
    expect(
      imagensDoBanner({ imageUrl: "", desktopImageUrl: COMPUTADOR }),
    ).toEqual([COMPUTADOR]);
    expect(imagensDoBanner({})).toEqual([]);
  });

  it("uma foto em uso por QUALQUER campo de QUALQUER banner não pode ser apagada", () => {
    const outros = [
      { imageUrl: "https://x.test/a.jpg" },
      { imageUrl: "https://x.test/b.jpg", desktopImageUrl: COMPUTADOR },
    ];
    expect(imagemDoBannerEmUso(COMPUTADOR, outros)).toBe(true); // pelo campo do computador
    expect(imagemDoBannerEmUso("https://x.test/a.jpg", outros)).toBe(true); // pelo do celular
    expect(imagemDoBannerEmUso(CELULAR, outros)).toBe(false);
    expect(imagemDoBannerEmUso(CELULAR, [])).toBe(false);
  });
});

describe("o banner tem texto?", () => {
  it("qualquer um dos quatro textos basta", () => {
    expect(bannerTemTexto({ title: "Natal" })).toBe(true);
    expect(bannerTemTexto({ subtitle: "Até 50%" })).toBe(true);
    expect(bannerTemTexto({ buttonText: "Ver" })).toBe(true);
    expect(bannerTemTexto({ badgeText: "Novo" })).toBe(true);
  });

  it("vazio, só espaço, nulo ou ausente não é texto", () => {
    expect(
      bannerTemTexto({
        title: "  ",
        subtitle: "",
        buttonText: null,
        badgeText: undefined,
      }),
    ).toBe(false);
    expect(bannerTemTexto({})).toBe(false);
  });
});

describe("em que modo o editor abre", () => {
  it("textos escondidos abrem em Simples, mesmo com texto escrito e preferência Completo", () => {
    expect(
      modoAoAbrirOBanner(
        { title: "Natal", showTextOverlay: false },
        "complete",
      ),
    ).toBe("simple");
  });

  it("banner com texto visível abre em Completo, mesmo com preferência Simples", () => {
    expect(modoAoAbrirOBanner({ title: "Natal" }, "simple")).toBe("complete");
    expect(
      modoAoAbrirOBanner({ title: "Natal", showTextOverlay: true }, "simple"),
    ).toBe("complete");
    expect(
      modoAoAbrirOBanner({ title: "Natal", showTextOverlay: null }, "simple"),
    ).toBe("complete");
  });

  it("banner novo ou sem texto segue a preferência deste aparelho", () => {
    expect(modoAoAbrirOBanner(null, "complete")).toBe("complete");
    expect(modoAoAbrirOBanner(undefined, "simple")).toBe("simple");
    expect(modoAoAbrirOBanner({ title: "" }, "complete")).toBe("complete");
    expect(modoAoAbrirOBanner({ title: "" }, "simple")).toBe("simple");
  });
});

describe("o pedido de 'Novo banner' feito antes de a tela carregar", () => {
  beforeEach(() => {
    // O teste roda em Node: a janela é só um alvo de eventos.
    vi.stubGlobal("window", new EventTarget());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
    // Esvazia qualquer pedido que um teste anterior tenha deixado.
    consumirPedidoDeNovoBanner();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sem pedido não abre nada", () => {
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("avisa a tela pelo evento e vale uma vez só", () => {
    const ouvinte = vi.fn();
    window.addEventListener(EVENTO_NOVO_BANNER, ouvinte);
    pedirNovoBanner();
    window.removeEventListener(EVENTO_NOVO_BANNER, ouvinte);

    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(consumirPedidoDeNovoBanner()).toBe(true);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("vale 8 s, até o último milissegundo; 1 ms depois é pedido velho", () => {
    pedirNovoBanner();
    vi.advanceTimersByTime(8000); // validade do pedido: 8 s
    expect(consumirPedidoDeNovoBanner()).toBe(true);

    pedirNovoBanner();
    vi.advanceTimersByTime(8001);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("o pedido velho é jogado fora: não reaparece depois", () => {
    pedirNovoBanner();
    vi.advanceTimersByTime(8001);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
    expect(consumirPedidoDeNovoBanner()).toBe(false);
  });

  it("um pedido novo renova a validade do anterior", () => {
    pedirNovoBanner();
    vi.advanceTimersByTime(7000);
    pedirNovoBanner();
    vi.advanceTimersByTime(7000);
    expect(consumirPedidoDeNovoBanner()).toBe(true);
  });
});
