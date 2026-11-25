// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), MiniaturaDoItemDevolvido (a foto que a cliente anexou à
// devolução, no formulário e na ficha). Nenhum teste a prendia pelo nome:
//  - com foto: `<img>` decorativa (alt vazio) que leva a classe de quem a usa;
//  - se a foto falha: some a imagem quebrada e entra o aviso "Sem foto", com papel de imagem
//    e nome falado "Foto indisponível" (o leitor de tela não fica sem saber que havia uma foto);
//  - a falha de UMA miniatura não afeta a vizinha.
import { MiniaturaDoItemDevolvido } from "@/components/devolucao/MiniaturaDoItemDevolvido";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("MiniaturaDoItemDevolvido: foto e aviso quando ela falha", () => {
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

  const imgs = () => [...host.querySelectorAll("img")];
  const avisos = () => [...host.querySelectorAll('[role="img"]')];

  it("com foto: imagem decorativa (alt vazio) com a url e a classe recebidas, sem aviso", () => {
    act(() => {
      raiz.render(
        <MiniaturaDoItemDevolvido
          url="https://cdn.exemplo.test/devolucao-1.jpg"
          className="size-full object-cover"
        />,
      );
    });
    expect(imgs()).toHaveLength(1);
    expect(imgs()[0]?.getAttribute("src")).toBe(
      "https://cdn.exemplo.test/devolucao-1.jpg",
    );
    expect(imgs()[0]?.getAttribute("alt")).toBe("");
    expect(imgs()[0]?.className).toBe("size-full object-cover");
    expect(avisos()).toHaveLength(0);
    expect(host.textContent).toBe("");
  });

  it("foto que falha: some a imagem e entra 'Sem foto', falado como 'Foto indisponível'", () => {
    act(() => {
      raiz.render(
        <MiniaturaDoItemDevolvido
          url="https://cdn.exemplo.test/devolucao-1.jpg"
          className="size-full object-cover"
        />,
      );
    });
    act(() => {
      imgs()[0]?.dispatchEvent(new Event("error"));
    });
    expect(imgs()).toHaveLength(0);
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]?.getAttribute("aria-label")).toBe("Foto indisponível");
    expect(avisos()[0]?.textContent).toBe("Sem foto");
  });

  it("a falha de uma miniatura não derruba a vizinha", () => {
    act(() => {
      raiz.render(
        <>
          <MiniaturaDoItemDevolvido
            url="https://cdn.exemplo.test/1.jpg"
            className="size-full"
          />
          <MiniaturaDoItemDevolvido
            url="https://cdn.exemplo.test/2.jpg"
            className="object-cover"
          />
        </>,
      );
    });
    act(() => {
      imgs()[0]?.dispatchEvent(new Event("error"));
    });
    expect(avisos()).toHaveLength(1);
    expect(imgs()).toHaveLength(1);
    expect(imgs()[0]?.getAttribute("src")).toBe(
      "https://cdn.exemplo.test/2.jpg",
    );
  });
});
