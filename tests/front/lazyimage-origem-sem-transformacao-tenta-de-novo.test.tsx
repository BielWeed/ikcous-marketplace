// @vitest-environment jsdom
import { LazyImage } from "@/components/LazyImage";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_IKCOUS =
  "https://cafkrminfnokvgjqtkle.supabase.co/storage/v1/object/public/produtos/camisa.png";
const URL_TRANSFORMAVEL =
  "https://loja.supabase.co/storage/v1/object/public/produtos/camisa.png";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

function imagem(): HTMLImageElement {
  const img = hospedeiro.querySelector("img");
  if (!img) throw new Error("A imagem deveria estar montada");
  return img;
}

function montar(src: string) {
  act(() => {
    raiz.render(
      <LazyImage src={src} alt="Camisa azul" priority sizes="50vw" />,
    );
  });
}

function dispararErro(img: HTMLImageElement) {
  act(() => {
    img.dispatchEvent(new Event("error"));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Fator 1,0 na variacao: a primeira espera fica exatamente em 1500 ms.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LazyImage — origem sem transformacao", () => {
  it("com sizes, a primeira falha da origem IKCOUS agenda nova tentativa", async () => {
    montar(URL_IKCOUS);
    const primeira = imagem();
    expect(primeira.getAttribute("src")).toBe(URL_IKCOUS);
    expect(primeira.getAttribute("srcset") || "").toBe("");

    dispararErro(primeira);
    expect(hospedeiro.querySelector("button")).toBeNull();
    await avancar(1_499);
    expect(imagem()).toBe(primeira);
    expect(imagem().getAttribute("src")).toBe(URL_IKCOUS);
    await avancar(1);

    const segunda = imagem();
    expect(segunda).not.toBe(primeira);
    expect(segunda.getAttribute("src")).toBe(`${URL_IKCOUS}?_r=1`);
    expect(hospedeiro.querySelector("button")).toBeNull();

    act(() => {
      segunda.dispatchEvent(new Event("load"));
    });
    expect(segunda.className).toContain("opacity-100");
  });

  it("preserva a tentativa imediata da original quando a transformacao estava em uso", async () => {
    montar(URL_TRANSFORMAVEL);
    const primeira = imagem();
    expect(primeira.getAttribute("src")).toContain("/render/image/public/");
    expect(primeira.getAttribute("srcset")).toContain("/render/image/public/");

    dispararErro(primeira);

    expect(imagem()).toBe(primeira);
    expect(imagem().getAttribute("src")).toBe(URL_TRANSFORMAVEL);
    expect(imagem().getAttribute("srcset")).toBeNull();
    expect(imagem().getAttribute("sizes")).toBeNull();
    expect(hospedeiro.querySelector("button")).toBeNull();
    await avancar(1_500);
    expect(imagem()).toBe(primeira);
    expect(imagem().getAttribute("src")).toBe(URL_TRANSFORMAVEL);
  });
});
