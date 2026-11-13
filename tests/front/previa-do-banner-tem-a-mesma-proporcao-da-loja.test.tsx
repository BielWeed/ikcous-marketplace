// @vitest-environment jsdom
//
// A previa da imagem propria no painel tem de ter a MESMA proporcao do banner
// da loja (2:1, BannerCarousel). Em 21:9 a lojista aprovava a imagem inteira
// e a cliente recebia as laterais cortadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import carrossel from "@/components/ui/custom/BannerCarousel.tsx?raw";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("prévia da imagem própria do banner", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("usa a proporção 2:1 do banner da loja", async () => {
    const { PreviaImagemPropria } = await import(
      "@/components/admin/banners/PreviaImagemPropria"
    );
    const banner: Banner = {
      id: "b1",
      imageUrl: "https://example.com/banner.jpg",
      title: "",
      position: "home_top",
      active: true,
      order: 1,
      link: "",
      templateType: "default",
    };
    act(() => {
      raiz.render(<PreviaImagemPropria formData={banner} comTexto={false} />);
    });
    const caixa = hospedeiro.firstElementChild as HTMLElement;
    expect(caixa.className).toContain("aspect-[2/1]");
    expect(caixa.className).not.toContain("aspect-[21/9]");
  });

  it("a loja desenha o carrossel na mesma proporção", () => {
    expect(carrossel).toContain("aspect-[2/1]");
  });
});
