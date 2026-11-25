// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), FotoDoItemDoPedido (a foto do item no detalhe do pedido).
// O teste vizinho (order-details-foto-do-item-nunca-fica-quebrada) cobre só "sem foto" e "foto
// que falha" por dentro da tela do pedido. Aqui o próprio componente:
//  - sem foto (vazia, nula, indefinida) -> ícone do pacote, nunca uma imagem;
//  - foto do Supabase: pede a MINIATURA; no 1º erro tenta o arquivo ORIGINAL (a loja pode não
//    transformar imagem) e só no 2º erro mostra o ícone;
//  - foto externa (sem miniatura): o 1º erro já mostra o ícone;
//  - o erro de UMA foto não condena a SEGUINTE (mesmo componente reaproveitado para outro item);
//  - o texto alternativo e a classe de quem usa chegam à imagem.
import { FotoDoItemDoPedido } from "@/components/ui/custom/FotoDoItemDoPedido";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SUPABASE =
  "https://loja-de-teste.supabase.co/storage/v1/object/public/produtos/blusa.jpg";
const EXTERNA_A = "https://cdn.exemplo.test/a.jpg";
const EXTERNA_B = "https://cdn.exemplo.test/b.jpg";

describe("FotoDoItemDoPedido: sem foto, foto que falha e foto seguinte", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  function desenhar(
    src: string | null | undefined,
    extras: { alt?: string; className?: string } = {},
  ) {
    act(() => {
      raiz.render(
        <FotoDoItemDoPedido
          src={src}
          alt={extras.alt ?? "Blusa Teste"}
          className={extras.className}
        />,
      );
    });
  }
  const img = () => host.querySelector("img");
  const icone = () =>
    host.querySelector('[data-testid="foto-do-item-sem-imagem"]');
  const falhar = () =>
    act(() => {
      img()?.dispatchEvent(new Event("error"));
    });

  it.each([[""], [null], [undefined]])(
    "sem foto (%j): ícone do pacote escondido do leitor, sem imagem",
    (src) => {
      desenhar(src);
      expect(img()).toBeNull();
      expect(icone()).not.toBeNull();
      expect(icone()?.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("foto do Supabase: pede a miniatura e leva o alt e a classe de quem usa", () => {
    desenhar(SUPABASE, { alt: "Blusa Teste", className: "rounded-lg" });
    expect(icone()).toBeNull();
    expect(img()?.getAttribute("src")).toContain(
      "/storage/v1/render/image/public/",
    );
    expect(img()?.getAttribute("src")).toContain("width=160");
    expect(img()?.getAttribute("alt")).toBe("Blusa Teste");
    expect(img()?.className).toContain("size-full");
    expect(img()?.className).toContain("rounded-lg");
  });

  it("foto do Supabase que falha: 1º erro tenta o original; 2º erro mostra o ícone", () => {
    desenhar(SUPABASE);
    falhar();
    expect(icone()).toBeNull();
    expect(img()?.getAttribute("src")).toBe(SUPABASE);
    falhar();
    expect(img()).toBeNull();
    expect(icone()).not.toBeNull();
  });

  it("foto externa que falha: o 1º erro já mostra o ícone", () => {
    desenhar(EXTERNA_A);
    expect(img()?.getAttribute("src")).toBe(EXTERNA_A);
    falhar();
    expect(img()).toBeNull();
    expect(icone()).not.toBeNull();
  });

  it("o erro de uma foto não condena a seguinte; voltar à que falhou mostra o ícone", () => {
    desenhar(EXTERNA_A);
    falhar();
    expect(icone()).not.toBeNull();
    desenhar(EXTERNA_B);
    expect(icone()).toBeNull();
    expect(img()?.getAttribute("src")).toBe(EXTERNA_B);
    desenhar(EXTERNA_A);
    expect(img()).toBeNull();
    expect(icone()).not.toBeNull();
  });
});
