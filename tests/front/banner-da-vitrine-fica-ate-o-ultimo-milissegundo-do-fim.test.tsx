import type { Banner } from "@/types";
// @vitest-environment jsdom
//
// O banner programado fica na vitrine ATÉ o milissegundo do fim, inclusive, e
// sai no milissegundo seguinte. O filtro da vitrine (useBanners) e o `estaNoAr`
// do painel têm de concordar na borda: se o filtro trocasse `>` por `>=`, a
// cliente perderia o banner 1 ms antes de a lojista achar que ele ainda
// estava no ar. Relógio fixo com timers falsos; nada de rede.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ banners: [] as Banner[] }));
vi.mock("@/lib/banners-da-vitrine", () => ({
  acompanharBannersDoRealtime: vi.fn(),
  bannersEmCache: () => h.banners,
  horaDaUltimaConsultaDeBanners: () => Date.now(),
  consultaDeBannersEmVoo: () => null,
  geracaoDasMutacoesDeBanners: () => 0,
  gravarBannersLocais: vi.fn(),
  pedirBanners: vi.fn(async () => h.banners),
  semearBannersDoCofre: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: vi.fn() }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      getAllOrThrow: async () => h.banners,
    }),
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { useBanners } from "@/hooks/useBanners";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const FIM = "2026-11-24T15:00:00.000Z";
const alvo = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIM)); // exatamente no fim
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  h.banners = [
    {
      id: "campanha",
      title: "Campanha",
      imageUrl: "/banner.jpg",
      active: true,
      order: 1,
      position: "home_top",
      startDate: "2026-11-20T15:00:00.000Z",
      endDate: FIM,
    },
  ];
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function montar() {
  function Sonda() {
    const { getBannersByPosition } = useBanners(false);
    return (
      <>
        {getBannersByPosition("home_top")
          .map((b) => b.title)
          .join(",")}
      </>
    );
  }
  await act(async () => raiz.render(<Sonda />));
}

it("no milissegundo exato do fim o banner ainda aparece; 1 ms depois sai", async () => {
  await montar();
  expect(alvo.textContent).toBe("Campanha");
  await act(async () => vi.advanceTimersByTime(1));
  expect(alvo.textContent).toBe("");
});
