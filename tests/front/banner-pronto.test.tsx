import { BannerCarousel } from "@/components/ui/custom/BannerCarousel";
import type { Banner } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, undefined],
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const criarBanner = (extras: Partial<Banner> = {}): Banner => ({
  id: "b1",
  imageUrl: "https://example.com/produto.jpg",
  title: "Coleção de verão",
  subtitle: "A partir de R$ 89,90",
  buttonText: "Comprar agora",
  badgeText: "NOVO",
  link: "/product-detail?id=produto-teste",
  templateType: "pronto_destaque",
  overlayColor: "#2A2A31",
  position: "home_top",
  order: 1,
  active: true,
  ...extras,
});

function montar(extras: Partial<Banner> = {}) {
  act(() =>
    raiz.render(
      <BannerCarousel banners={[criarBanner(extras)]} autoPlay={false} />,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", ObserverStub);
  vi.stubGlobal("ResizeObserver", ObserverStub);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("banner pronto no carrossel", () => {
  it.each(["destaque", "claro", "vitrine", "promocao", "lancamento", "foto"])(
    "%s desenha textos e foto decorativa, sem botão interativo dentro do slide",
    (modelo) => {
      montar({ templateType: `pronto_${modelo}` });
      const pronto = hospedeiro.querySelector(`[data-modelo="${modelo}"]`);
      expect(pronto).not.toBeNull();
      expect(pronto?.textContent).toContain("Coleção de verão");
      expect(pronto?.textContent).toContain("A partir de R$ 89,90");
      expect(pronto?.textContent).toContain("Comprar agora");
      expect(pronto?.textContent).toContain("NOVO");
      const foto = pronto?.querySelector("img");
      expect(foto?.getAttribute("src")).toBe("https://example.com/produto.jpg");
      expect(foto?.getAttribute("alt")).toBe("");
      expect(foto?.getAttribute("fetchpriority")).toBe("high");
      expect(foto?.style.objectFit).toBe("cover");
      expect(pronto?.querySelector("button")).toBeNull();
    },
  );

  it.each(["", "   "])(
    "botão vazio (%s) não cria chamada visual",
    (buttonText) => {
      montar({ buttonText });
      expect(hospedeiro.querySelector("[data-botao]")).toBeNull();
    },
  );
  it("todos os textos vazios deixam apenas a foto", () => {
    montar({ title: null, subtitle: " ", buttonText: "", badgeText: " " });
    const pronto = hospedeiro.querySelector("[data-modelo]");
    expect(
      pronto?.querySelector("h2, p, [data-botao], [data-selo]"),
    ).toBeNull();
  });
  it.each([
    ["#2A2A31", "claro"],
    ["#fff", "escuro"],
  ])("a tinta sobre %s é %s", (overlayColor, tinta) => {
    montar({ overlayColor });
    expect(
      hospedeiro.querySelector("[data-modelo]")?.getAttribute("data-tinta"),
    ).toBe(tinta);
  });
  it("foto usa branco sobre véu escuro mesmo com cor de fundo clara", () => {
    montar({
      templateType: "pronto_foto",
      overlayColor: "#fff",
      overlayOpacity: 0,
    });
    expect(
      hospedeiro.querySelector("[data-modelo]")?.getAttribute("data-tinta"),
    ).toBe("claro");
    expect(
      hospedeiro.querySelector('[aria-hidden="true"].bg-black\\/70'),
    ).not.toBeNull();
  });

  it.each(["click", "Enter", " "])("%s no slide navega como antes", (acao) => {
    montar();
    const slide = hospedeiro.querySelector('[role="button"]')!;
    const evento =
      acao === "click"
        ? new MouseEvent("click", { bubbles: true })
        : new KeyboardEvent("keydown", { key: acao, bubbles: true });
    act(() => slide.dispatchEvent(evento));
    expect(location.pathname + location.search).toBe(
      "/product-detail?id=produto-teste",
    );
    expect(history.state).toEqual({
      view: "product-detail",
      id: "produto-teste",
    });
  });
  it("slide sem destino não se torna um botão", () => {
    montar({ link: "" });
    expect(hospedeiro.querySelector('[role="button"]')).toBeNull();
  });
  it.each(["glassmorphic", "pronto_desconhecido"])(
    "%s preserva o desenho antigo com seus textos e cores",
    (templateType) => {
      montar({ templateType, titleColor: "#123456", buttonBgColor: "#abcdef" });
      expect(hospedeiro.querySelector("[data-modelo]")).toBeNull();
      expect(hospedeiro.querySelector("img")?.alt).toBe("Coleção de verão");
      expect(hospedeiro.querySelector("h2")?.style.color).toBe(
        "rgb(18, 52, 86)",
      );
      expect(hospedeiro.querySelector("button")?.style.backgroundColor).toBe(
        "rgb(171, 205, 239)",
      );
      expect(
        hospedeiro
          .querySelector("div.transition-opacity")
          ?.getAttribute("style"),
      ).toContain("opacity: 0.4");
      if (templateType === "glassmorphic")
        expect(hospedeiro.querySelector(".backdrop-blur-md")).not.toBeNull();
    },
  );
});
