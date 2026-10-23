// @vitest-environment jsdom
//
// Previa do painel alinhada a loja. Complemento de banner-sem-destino-nao-mostra-botao-morto: banner so com
// imagem e texto de botao SEM link (1) nao ganha pelicula escura sobre a foto
// na loja e (2) a previa do painel mostra o mesmo que a loja (sem o botao).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("prévia do painel sem destino", () => {
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
  const base: Banner = {
    id: "b1",
    imageUrl: "https://example.com/banner.jpg",
    title: "",
    position: "home_top",
    active: true,
    order: 1,
    link: "",
    buttonText: "Ver ofertas",
    templateType: "default",
  };

  it("prévia do painel: sem link não mostra o botão; com link mostra", async () => {
    const { PreviaImagemPropria } = await import(
      "@/components/admin/banners/PreviaImagemPropria"
    );
    act(() => {
      raiz.render(
        <PreviaImagemPropria
          formData={{ ...base, title: "Campanha" }}
          comTexto
        />,
      );
    });
    expect(hospedeiro.textContent).not.toContain("Ver ofertas");
    act(() => {
      raiz.render(
        <PreviaImagemPropria
          formData={{ ...base, title: "Campanha", link: "/checkout" }}
          comTexto
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("Ver ofertas");
  });
});
