import type { Banner } from "@/types";

export type CampoDeImagemDoBanner = "imageUrl" | "desktopImageUrl";

/** Sem substituição entre telas: arte ausente não vira banner no outro aparelho. */
export function imagemDoBannerParaTela(
  banner: Partial<Banner>,
  computador: boolean,
): string | null {
  const imagem = computador ? banner.desktopImageUrl : banner.imageUrl;
  return imagem?.trim() ? imagem : null;
}

/** As duas versões podem usar o mesmo arquivo: descartar exige olhar o conjunto. */
export function imagensDoBanner(banner: Partial<Banner>): string[] {
  return [
    ...new Set(
      [banner.imageUrl, banner.desktopImageUrl].filter((url): url is string =>
        Boolean(url),
      ),
    ),
  ];
}

export function imagemDoBannerEmUso(
  url: string,
  banners: Partial<Banner>[],
): boolean {
  return banners.some((banner) => imagensDoBanner(banner).includes(url));
}
