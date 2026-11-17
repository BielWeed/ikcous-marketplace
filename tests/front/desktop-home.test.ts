/* eslint-disable security/detect-non-literal-fs-filename -- lê somente fontes locais enumeradas por este teste, sem caminhos de entrada externa */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fonte = (nome: string) =>
  readFileSync(new URL(`../../src/${nome}`, import.meta.url), "utf8");

describe("Home no computador", () => {
  it("banner e as duas reservas usam a mesma altura de computador", () => {
    const banner = fonte("components/ui/custom/BannerCarousel.tsx");
    const home = fonte("views/customer/HomeView.tsx");
    const geometria = "lg:aspect-[4/1] lg:h-auto";
    expect(home).toContain("lg:[container-type:inline-size]");
    expect(banner).toContain(`computador && "${geometria}"`);
    const reservas =
      home.match(/className="[^"]*aspect-\[2\/1\][^"]*animate-pulse[^"]*"/g) ??
      [];
    expect(reservas).toHaveLength(2);
    for (const reserva of reservas) {
      expect(reserva).toContain(geometria);
      expect(reserva).not.toContain("lg:h-[clamp(");
      expect(reserva).not.toContain("lg:aspect-auto");
    }
    for (const texto of [banner, home]) {
      expect(texto).toContain("lg:max-w-none");
      expect(texto).toContain("lg:rounded-3xl");
    }
    expect(banner.includes("lg:[&_img]:!object-contain")).toBe(true);
    expect(banner).toContain("lg:group-hover:scale-100");
    expect(banner).toContain("bg-zinc-100");
    const imagem = banner.match(/<LazyImage[\s\S]*?\/>/)?.[0] ?? "";
    expect(imagem).not.toBe("");
    expect(imagem).not.toMatch(/objectFit\s*=/);
    expect(fonte("components/LazyImage.tsx")).toContain('objectFit = "cover"');
  });

  it("grade pronta e carregando usam a constante de 4/5 colunas", () => {
    const lista = fonte("components/ui/custom/ProductList.tsx");
    expect(lista.match(/GRADE_DE_PRODUTOS_NO_COMPUTADOR/g)).toHaveLength(3);
  });

  it("frete e reserva têm a mesma largura contida", () => {
    for (const nome of [
      "components/ui/custom/InfoBlockCarousel.tsx",
      "views/customer/HomeView.tsx",
    ]) {
      expect(
        fonte(nome).includes('className="relative mt-2 w-full px-4 lg:px-0"'),
      ).toBe(true);
    }
  });

  it("filtros ficam junto das categorias e nomes não são truncados no PC", () => {
    const home = fonte("views/customer/HomeView.tsx");
    const categorias = fonte("components/ui/custom/CategoryFilter.tsx");
    expect(home).toContain("lg:w-fit lg:max-w-full");
    expect(home).toContain("lg:flex-initial");
    expect(categorias).toContain("lg:w-auto lg:min-w-[80px] lg:px-3");
    expect(categorias).toContain("lg:line-clamp-none lg:whitespace-nowrap");
  });

  it("vitrines mantêm os quatro layouts com larguras limitadas no computador", () => {
    const premium = fonte("components/ui/custom/PremiumOffers.tsx");
    const home = fonte("views/customer/HomeView.tsx");
    expect(premium.includes("lg:max-w-[800px]")).toBe(true);
    expect(home.includes("lg:max-w-[800px]")).toBe(true);
    expect(
      fonte("components/ui/custom/OfertasCompactas.tsx").includes(
        "lg:!w-[calc((100%-30px)/4)] xl:!w-[calc((100%-40px)/5)]",
      ),
    ).toBe(true);
    expect(
      fonte("components/ui/custom/OfertasLateral.tsx").includes(
        "lg:basis-[calc((100%-32px)/3)]",
      ),
    ).toBe(true);
    expect(
      fonte("components/ui/custom/OfertasLateralDuplo.tsx").includes(
        "lg:basis-[calc((100%-32px)/3)]",
      ),
    ).toBe(true);
  });

  it("carrossel padrão acompanha a grade no PC, com o mesmo tamanho na reserva", () => {
    const home = fonte("views/customer/HomeView.tsx");
    expect(
      home.includes("lg:[&_.snap-mandatory>div]:w-[calc((100%-48px)/4)]"),
    ).toBe(true);
    expect(
      home.includes("xl:[&_.snap-mandatory>div]:w-[calc((100%-64px)/5)]"),
    ).toBe(true);
    expect(
      home.includes("lg:w-[calc((100%-48px)/4)] xl:w-[calc((100%-64px)/5)]"),
    ).toBe(true);
    expect(home.includes("lg:[&_.snap-mandatory]:justify-center")).toBe(false);
  });

  it("preserva as classes do celular no banner e nas duas grades", () => {
    const banner = fonte("components/ui/custom/BannerCarousel.tsx");
    const classe = banner.match(/"(premium-shadow[^"]+)"/)?.[1] ?? "";
    expect(classesDoCelular(classe)).toBe(
      "premium-shadow relative aspect-[2/1] w-full touch-pan-y overflow-hidden bg-zinc-100 md:mx-auto md:max-w-[1040px]",
    );
    const lista = fonte("components/ui/custom/ProductList.tsx");
    expect(lista).toContain("grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3");
  });
});
