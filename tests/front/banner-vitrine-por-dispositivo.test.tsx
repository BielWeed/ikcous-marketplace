import type { Banner } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  desktop: false,
  listeners: new Set<() => void>(),
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [
    vi.fn(),
    { on: vi.fn(), off: vi.fn(), selectedScrollSnap: () => 0 },
  ],
}));
// @ts-expect-error flag de testes do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  private callback: (entries: { isIntersecting: boolean }[]) => void;
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    this.callback = callback;
  }
  observe() {
    this.callback([{ isIntersecting: true }]);
  }
  disconnect() {}
}
let root: Root;
let host: HTMLDivElement;
const banner: Banner = {
  id: "b1",
  title: "Campanha",
  imageUrl: "https://example.com/celular.webp",
  desktopImageUrl: "https://example.com/computador.webp",
  active: true,
  position: "home_top",
  order: 1,
  showTextOverlay: false,
};
beforeEach(() => {
  h.desktop = false;
  h.listeners.clear();
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: media === "(min-width: 1024px)" && h.desktop,
    addEventListener: (_: string, cb: () => void) => {
      if (media === "(min-width: 1024px)") h.listeners.add(cb);
    },
    removeEventListener: (_: string, cb: () => void) => {
      h.listeners.delete(cb);
    },
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mostrar(b = banner, lista = [b]) {
  const { BannerCarousel } = await import(
    "@/components/ui/custom/BannerCarousel"
  );
  await act(async () =>
    root.render(
      <BannerCarousel banners={lista} autoPlay={false} primeiraSemFade />,
    ),
  );
}
it("celular pede a arte de celular e computador pede somente a arte própria", async () => {
  await mostrar();
  expect(host.querySelector("img")?.getAttribute("src")).toBe(banner.imageUrl);
  await act(async () => {
    h.desktop = true;
    h.listeners.forEach((cb) => cb());
  });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    banner.desktopImageUrl,
  );
  expect(host.querySelectorAll("img")).toHaveLength(1);
  await act(async () => {
    h.desktop = false;
    h.listeners.forEach((cb) => cb());
  });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(banner.imageUrl);
});
it.each([null, undefined, "", "   "])(
  "computador não exibe banner sem imagem própria (%s), nem reserva espaço",
  async (desktopImageUrl) => {
    h.desktop = true;
    await mostrar({ ...banner, desktopImageUrl });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[role="region"]')).toBeNull();
    await act(async () => {
      h.desktop = false;
      h.listeners.forEach((cb) => cb());
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      banner.imageUrl,
    );
  },
);
it("lista mista mostra só computador no PC, sem pontos extras; celular mantém todas", async () => {
  const lista = [
    { ...banner, id: "celular-antes", desktopImageUrl: null },
    banner,
    { ...banner, id: "celular-depois", desktopImageUrl: null },
  ];
  h.desktop = true;
  await mostrar(banner, lista);
  expect(
    [...host.querySelectorAll("img")].map((img) => img.getAttribute("src")),
  ).toEqual(["https://example.com/computador.webp"]);
  expect(
    host.querySelectorAll('button[aria-label^="Ir para slide"]'),
  ).toHaveLength(0);
  expect(
    host
      .querySelector('[aria-roledescription="slide"]')
      ?.getAttribute("aria-label"),
  ).toBe("1 de 1: Campanha");
  await act(async () => {
    h.desktop = false;
    h.listeners.forEach((cb) => cb());
  });
  expect(
    [...host.querySelectorAll("img")].map((img) => img.getAttribute("src")),
  ).toEqual([banner.imageUrl, banner.imageUrl, banner.imageUrl]);
  expect(
    host.querySelectorAll('button[aria-label^="Ir para slide"]'),
  ).toHaveLength(3);
});
