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
  observe() {}
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
async function mostrar(b = banner) {
  const { BannerCarousel } = await import(
    "@/components/ui/custom/BannerCarousel"
  );
  await act(async () =>
    root.render(
      <BannerCarousel banners={[b]} autoPlay={false} primeiraSemFade />,
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
it("computador sem versão própria mantém imagem legada", async () => {
  h.desktop = true;
  await mostrar({ ...banner, desktopImageUrl: null });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(banner.imageUrl);
});
