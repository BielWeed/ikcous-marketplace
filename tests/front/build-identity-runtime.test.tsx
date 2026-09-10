// @vitest-environment jsdom
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

let config: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));

describe("a identidade compilada permanece na apresentação", () => {
  let root: Root | undefined;
  beforeEach(() => {
    vi.resetModules();
    config = {};
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("style");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
  });
  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["Aurora", "Horizonte"])(
    "applyBranding mantém o kit de %s e seus MIME, mesmo rodando duas vezes",
    async (name) => {
      const snapshot = criarBuildIdentity(name, name.toLowerCase());
      vi.stubGlobal("__STORE_IDENTITY__", snapshot);
      vi.stubEnv("VITE_APP_NAME", "Marca errada do env");
      vi.stubEnv("VITE_BRAND_PRIMARY", "#ff0000");
      document.head.innerHTML =
        '<link rel="apple-touch-icon" href="/antigo.png"><link rel="mask-icon" href="/nao-tocar.svg"><link rel="icon" href="/antigo.ico">';
      document.body.innerHTML =
        '<div class="guardian-brand-text"></div><div class="guardian-logo-icon"><img src="/loader-preparado.png"><span></span></div>';
      const { applyBranding, branding } = await import("@/config/branding");
      applyBranding();
      applyBranding();
      expect(branding.appName).toBe(name);
      expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
        "210 65% 20%",
      );
      expect(
        document.documentElement.style.getPropertyValue("--secondary"),
      ).toBe("120 100% 25%");
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe(
        "30 100% 50%",
      );
      expect(
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content"),
      ).toBe("#123456");
      for (const [rel, href, type] of [
        ["icon", snapshot.localUrls.favicon, "image/svg+xml"],
        ["apple-touch-icon", snapshot.localUrls.apple_touch, "image/png"],
      ]) {
        const links = document.querySelectorAll(`link[rel="${rel}"]`);
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toBe(href);
        expect(links[0].getAttribute("type")).toBe(type);
      }
      expect(
        document.querySelector('link[rel="mask-icon"]')?.getAttribute("href"),
      ).toBe("/nao-tocar.svg");
      expect(document.querySelector(".guardian-brand-text")?.textContent).toBe(
        name,
      );
      expect(
        document.querySelector(".guardian-logo-icon span")?.textContent,
      ).toBe(name[0]);
      expect(
        document.querySelector(".guardian-logo-icon img")?.getAttribute("src"),
      ).toBe("/loader-preparado.png");
      expect(document.documentElement.innerHTML).not.toContain("/branding/");
    },
  );

  it("cria os ícones ausentes sem duplicar nem depender de DOM inicial", async () => {
    const { applyBranding } = await import("@/config/branding");
    applyBranding();
    applyBranding();
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(
      document.querySelectorAll('link[rel="apple-touch-icon"]'),
    ).toHaveLength(1);
  });

  it("constante ausente falha claramente em vez de buscar marca no env ou JSON", async () => {
    vi.stubGlobal("__STORE_IDENTITY__", undefined);
    vi.stubEnv("VITE_APP_NAME", "Marca proibida");
    await expect(import("@/config/branding")).rejects.toThrow(
      "IDENTITY_BUILD_MISSING",
    );
  });

  it.each(["Aurora", "Horizonte"])(
    "HomeView usa OG local de %s e aceita nome válido que chega depois",
    async (name) => {
      const snapshot = criarBuildIdentity(name, name.toLowerCase());
      vi.stubGlobal("__STORE_IDENTITY__", snapshot);
      const { HomeView } = await import("@/views/customer/HomeView");
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      async function render() {
        await act(async () => {
          root?.render(
            <HomeView
              products={[]}
              favorites={[]}
              onToggleFavorite={() => {}}
              onProductClick={() => {}}
              onNavigate={() => {}}
              searchQuery=""
              selectedCategory="Todas"
              onCategoryChange={() => {}}
              sortBy="default"
              onSortByChange={() => {}}
            />,
          );
        });
      }
      config = { storeName: "  " };
      await render();
      expect(document.title).toBe(name);
      for (const selector of [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
      ]) {
        expect(document.querySelector(selector)?.getAttribute("content")).toBe(
          `${location.origin}/identity/${name.toLowerCase()}/social.jpg`,
        );
      }
      config = {
        storeName: "Nome do banco",
        storeCity: "Cidade",
        storeState: "MG",
      };
      await render();
      expect(document.title).toBe("Nome do banco | Cidade, MG");
      expect(
        document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute("content"),
      ).toBe("Nome do banco - Seu Shopping Local");
      expect(config).toEqual({
        storeName: "Nome do banco",
        storeCity: "Cidade",
        storeState: "MG",
      });
    },
  );
});
