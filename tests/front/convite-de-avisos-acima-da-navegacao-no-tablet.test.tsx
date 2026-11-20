// @vitest-environment jsdom
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PushNotificationBanner } from "@/components/pwa/PushNotificationBanner";
import postcss from "postcss";
import seletorCss from "postcss-selector-parser";
import { act } from "react";
import { createRoot } from "react-dom/client";
import tailwindcss from "tailwindcss";
import { expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de Teste" } }),
}));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: true,
    permission: "default",
    subscription: null,
    semConta: false,
    subscribe: vi.fn(),
  }),
}));

const POSICAO_TABLET =
  "md:bottom-[calc(var(--nav-height)+var(--safe-area-bottom,0px)+var(--customer-nav-offset)+2px+16px)]";

it("reserva espaço para a navegação no tablet sem deslocar o convite no celular ou no desktop", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => null });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => {
      root.render(<PushNotificationBanner currentView="home" />);
    });
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(container.textContent).toContain("Quero Receber!");
    // jsdom não aplica media queries: verificamos as classes do convite renderizado.
    const classes = [...(container.firstElementChild?.classList ?? [])];
    expect(
      classes.filter((classe) => /^(?:(?:md|lg):)?bottom-/.test(classe)).sort(),
    ).toEqual([
      "bottom-[calc(80px+var(--safe-area-bottom,0px))]",
      "lg:bottom-6",
      POSICAO_TABLET,
    ]);
  } finally {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("o Tailwind gera as posições do tablet e do desktop nos pontos de corte corretos", async () => {
  const carregarConfig = createRequire(import.meta.url)(
    "tailwindcss/loadConfig",
  ) as (caminho: string) => Record<string, unknown>;
  const config = carregarConfig(resolve("tailwind.config.js"));
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: ["./src/components/pwa/PushNotificationBanner.tsx"],
    }),
  ]).process("@tailwind utilities;", { from: undefined });

  const larguras = new Map<string, string>();
  resultado.root.walkDecls("bottom", (declaracao) => {
    const regra = declaracao.parent;
    const media = regra?.parent;
    if (regra?.type !== "rule" || media?.type !== "atrule") return;
    seletorCss((seletores) => {
      seletores.walkClasses((classe) => {
        larguras.set(classe.value, media.params);
      });
    }).processSync(regra.selector);
  });

  expect(larguras.get(POSICAO_TABLET)).toBe("(min-width: 768px)");
  expect(larguras.get("lg:bottom-6")).toBe("(min-width: 1024px)");
});
