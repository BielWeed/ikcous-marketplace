// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja", logoUrl: "/logo.png" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/hooks/useCart", () => ({ useCartState: () => ({ cartCount: 3 }) }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [] }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => <input aria-label="Busca" />,
}));

import { BottomNav } from "@/components/ui/custom/BottomNav";
import { Header } from "@/components/ui/custom/Header";

const fontes = import.meta.glob<string>(
  "../../src/{App.tsx,components/ui/custom/*.tsx,components/pwa/*.tsx}",
  { query: "?raw", import: "default", eager: true },
);
// @ts-expect-error flag interna do React para act.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const barra =
  "pb-safe fixed inset-x-0 bottom-0 z-[120] flex-shrink-0 border-t border-zinc-100 bg-white/95 shadow-sm backdrop-blur-xl md:bottom-6 md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-2xl md:border md:border-zinc-200 md:shadow-md";
const regexLiteral = (valor: string) =>
  valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

it("F1.6 mantém a barra montada, com as classes do celular intactas e lg:hidden", () => {
  act(() => root.render(<BottomNav currentView="home" onNavigate={vi.fn()} />));
  const nav = host.querySelector("nav")!;
  expect(classesDoCelular(nav.className)).toBe(barra);
  expect(nav.classList.contains("lg:hidden")).toBe(true);
  expect(host.querySelector("#bottom-nav-cart")).not.toBeNull();
  expect(fontes["../../src/App.tsx"]).toMatch(
    // eslint-disable-next-line security/detect-non-literal-regexp -- padrão monta com a constante fixa `barra` deste arquivo, não com entrada externa.
    new RegExp(
      `className=\\{cn\\(\\s*"${regexLiteral(barra)}",\\s*"lg:hidden",?\\s*\\)\\}`,
    ),
  );
});

it("F1.7 acrescenta a grade simétrica, o container e a escala da logo sem alterar o celular", () => {
  act(() => root.render(<Header onNavigate={vi.fn()} />));
  const linha = host.querySelector("header > div")!;
  const esquerda = linha.children[0];
  const busca = linha.children[1];
  const direita = linha.children[2];
  for (const [el, base, desktop] of [
    [
      linha,
      "relative flex h-[var(--header-height)] items-center justify-between gap-2.5 px-3 xs:px-4 md:grid md:grid-cols-[180px,1fr,auto]",
      "lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)_minmax(0,1fr)]",
    ],
    [
      esquerda,
      "z-[70] flex shrink-0 items-center gap-2 xs:gap-3 md:w-[180px]",
      "lg:w-auto",
    ],
    [
      busca,
      "mx-auto flex min-w-0 flex-1 justify-center px-1 sm:px-4 md:w-full overflow-hidden max-w-lg",
      "lg:max-w-[640px]",
    ],
    [
      direita,
      "z-[70] flex shrink-0 items-center justify-end gap-1.5 md:min-w-[100px]",
      "lg:min-w-0",
    ],
  ] as const) {
    expect(classesDoCelular(el.getAttribute("class")!)).toBe(base);
    expect(el.classList.contains(desktop)).toBe(true);
  }
  const logo = host.querySelector("img")!.parentElement!;
  expect(classesDoCelular(logo.className)).toBe(
    "flex h-8 max-w-[100px] items-center overflow-hidden rounded-[8px] xs:max-w-[120px]",
  );
  expect(logo.classList.contains("lg:h-10")).toBe(true);
  expect(logo.classList.contains("lg:max-w-[140px]")).toBe(true);
  expect(logo.classList.contains("xl:max-w-[200px]")).toBe(true);
});

it("B3 com Voltar, a logo recua em lg: (92 = 144 - 40 - 12) para não sobrepor a busca", () => {
  act(() =>
    root.render(
      <Header onNavigate={vi.fn()} showBackButton onBack={vi.fn()} />,
    ),
  );
  const logo = host.querySelector("img")!.parentElement!;
  expect(classesDoCelular(logo.className)).toBe(
    "flex h-8 max-w-[100px] items-center overflow-hidden rounded-[8px] xs:max-w-[120px]",
  );
  expect(logo.classList.contains("lg:max-w-[92px]")).toBe(true);
  expect(logo.classList.contains("lg:max-w-[140px]")).toBe(false);
  // Em xl (1280) a coluna tem ~264px — 212px sobram para a logo depois de
  // Voltar + gap, então o teto normal (200px) continua cabendo.
  expect(logo.classList.contains("xl:max-w-[200px]")).toBe(true);
});

it("F1.12 e F1.16 acrescentam só tokens de desktop ao dropdown e aos overlays", () => {
  const casos = [
    [
      "../../src/components/ui/custom/SearchBar.tsx",
      "fixed inset-x-0 top-[calc(var(--header-height)+6px)] z-[100] mx-auto max-h-[72vh] w-[calc(100vw-24px)] max-w-lg overflow-y-auto rounded-[28px] border border-zinc-200/90 bg-white p-4 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.35)] duration-200 animate-in fade-in slide-in-from-top-2 sm:p-5",
      "lg:max-w-[640px] lg:w-[calc(min(100vw,1280px)-384px)] lg:slide-in-from-top-0 2xl:w-[640px]",
    ],
    [
      "../../src/components/ui/custom/CartReminder.tsx",
      "pointer-events-none fixed inset-x-0 bottom-[calc(76px+var(--safe-area-bottom,0px))] z-40 flex justify-center px-4 md:bottom-24",
      "lg:bottom-8 lg:justify-end lg:px-8",
    ],
  ];
  for (const [arquivo, base, desktop] of casos) {
    // eslint-disable-next-line security/detect-object-injection -- caminhos fixos da tabela de casos acima.
    expect(fontes[arquivo]).toMatch(
      // eslint-disable-next-line security/detect-non-literal-regexp -- padrão monta com valores fixos da tabela `casos` acima, não com entrada externa.
      new RegExp(
        `cn\\(\\s*"${regexLiteral(base)}",\\s*"${regexLiteral(desktop)}",?\\s*\\)`,
      ),
    );
    expect(classesDoCelular(`${base} ${desktop}`)).toBe(base);
  }
  const push = fontes["../../src/components/pwa/PushNotificationBanner.tsx"];
  expect(push).toContain('"fixed left-4 right-4 z-[999] mx-auto max-w-md"');
  expect(push).toContain('"bottom-20 md:bottom-6"');
  expect(push).toContain(
    '"lg:bottom-8 lg:right-8 lg:left-auto lg:mx-0 lg:w-[400px]"',
  );
});
