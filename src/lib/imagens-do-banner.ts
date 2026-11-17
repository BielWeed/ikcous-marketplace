import type { Banner } from "@/types";

export type CampoDeImagemDoBanner = "imageUrl" | "desktopImageUrl";

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
