// @vitest-environment jsdom
//
// DEFEITO: banner com foto quebrada mostra o botão "Toque para tentar de novo"
// DENTRO do slide. Pelo teclado, Enter nesse botão abria o destino do banner em
// vez de tentar de novo: o `onKeyDown` do slide pegava Enter/Espaço de qualquer
// filho e ainda dava `preventDefault`, o que cancelava o clique nativo do botão.
//
// Correção: o slide só reage ao teclado quando o foco está nele mesmo
// (`e.target === e.currentTarget`). Enter no slide continua abrindo o destino.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("embla-carousel-react", () => ({
  default: () => [
    vi.fn(),
    {
      scrollNext: vi.fn(),
      scrollTo: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      selectedScrollSnap: () => 0,
    },
  ],
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("BannerCarousel: teclado dentro do slide", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    globalThis.history.replaceState({}, "", "/");
    abrir = vi.spyOn(globalThis.history, "pushState");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.history.replaceState({}, "", "/");
  });

  async function montar() {
    const banner: Banner = {
      id: "b1",
      imageUrl: "https://example.com/banner.jpg",
      title: "Campanha",
      position: "home_top",
      active: true,
      order: 1,
      link: "/profile",
    };
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(
        <BannerCarousel primeiraSemFade banners={[banner]} autoPlay={false} />,
      );
    });
  }

  // Foto que falha de verdade: 2 tentativas automáticas e depois o botão.
  async function quebrarAFoto() {
    const falhar = () =>
      act(() => {
        hospedeiro.querySelector("img")?.dispatchEvent(new Event("error"));
      });
    falhar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    falhar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    falhar();
  }

  const enter = () =>
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

  it("Enter no botão 'tentar de novo' não abre o destino e deixa o clique nativo valer", async () => {
    await montar();
    await quebrarAFoto();
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label*="Toque para tentar de novo"]',
    );
    expect(botao).not.toBeNull();

    const evento = enter();
    act(() => {
      botao?.dispatchEvent(evento);
    });

    expect(abrir).not.toHaveBeenCalled();
    // `preventDefault` aqui cancelaria o clique que o navegador faz no Enter.
    expect(evento.defaultPrevented).toBe(false);
  });

  it("Espaço no botão 'tentar de novo' também não abre o destino", async () => {
    await montar();
    await quebrarAFoto();
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label*="Toque para tentar de novo"]',
    );

    const evento = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      botao?.dispatchEvent(evento);
    });

    expect(abrir).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it("Enter no próprio slide continua abrindo o destino", async () => {
    await montar();
    const slide = hospedeiro.querySelector<HTMLElement>('[role="button"]');
    expect(slide).not.toBeNull();

    const evento = enter();
    act(() => {
      slide?.dispatchEvent(evento);
    });

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(evento.defaultPrevented).toBe(true);
  });
});
