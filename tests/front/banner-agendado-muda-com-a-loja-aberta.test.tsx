import type { Banner } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  banners: [] as Banner[],
  pedir: vi.fn(),
  sincronizar: undefined as undefined | (() => Promise<void>),
}));
vi.mock("@/lib/banners-da-vitrine", () => ({
  bannersEmCache: () => h.banners,
  horaDaUltimaConsultaDeBanners: () => Date.now(),
  consultaDeBannersEmVoo: () => null,
  geracaoDasMutacoesDeBanners: () => 0,
  gravarBannersLocais: vi.fn(),
  pedirBanners: h.pedir,
  semearBannersDoCofre: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({
  useSyncListener: (_tabelas: string[], callback: () => Promise<void>) => {
    h.sincronizar = callback;
  },
}));
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
const alvo = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  h.pedir.mockClear();
  h.banners = [
    {
      id: "campanha",
      title: "Campanha",
      imageUrl: "/banner.jpg",
      active: true,
      order: 1,
      position: "home_top",
      startDate: "2026-11-07T12:00:01Z",
      endDate: "2026-11-07T12:00:02Z",
    },
  ];
  h.pedir.mockImplementation(async () => h.banners);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function montar(admin = false) {
  function Sonda() {
    const { getBannersByPosition } = useBanners(admin);
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
it("entra e sai no horário sem interação nem consulta à rede", async () => {
  await montar();
  expect(alvo.textContent).toBe("");
  await act(async () => vi.advanceTimersByTime(1000));
  expect(alvo.textContent).toBe("Campanha");
  await act(async () => vi.advanceTimersByTime(1001));
  expect(alvo.textContent).toBe("");
  expect(h.pedir).not.toHaveBeenCalled();
});
it("ao voltar à aba reavalia o relógio mesmo sem o timer disparar", async () => {
  await montar();
  vi.setSystemTime(new Date("2026-11-07T12:00:01Z"));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(alvo.textContent).toBe("Campanha");
  expect(h.pedir).not.toHaveBeenCalled();
});
it("datas distantes não viram timer de 1 ms e o desmontar limpa o trabalho", async () => {
  h.banners[0].startDate = "2027-11-07T12:00:00Z";
  h.banners[0].endDate = null;
  const agendar = vi.spyOn(window, "setTimeout");
  await montar();
  expect(agendar).toHaveBeenCalledWith(expect.any(Function), 2147483647);
  act(() => raiz.unmount());
  raiz = createRoot(alvo);
  await act(async () => vi.advanceTimersByTime(2147483647));
  expect(alvo.textContent).toBe("");
  expect(h.pedir).not.toHaveBeenCalled();
});
it("banner recebido depois usa o horário atual, não o da abertura da loja", async () => {
  const banner = h.banners[0];
  h.banners = [];
  await montar();
  vi.setSystemTime(new Date("2026-11-07T14:00:00Z"));
  h.banners = [
    {
      ...banner,
      startDate: "2026-11-07T13:00:00Z",
      endDate: "2026-11-07T15:00:00Z",
    },
  ];
  await act(async () => h.sincronizar!());
  expect(alvo.textContent).toBe("Campanha");
  expect(h.pedir).not.toHaveBeenCalled();
});
it("o painel continua mostrando agendados e vencidos", async () => {
  await montar(true);
  await act(async () => vi.advanceTimersByTime(3000));
  expect(alvo.textContent).toBe("Campanha");
});
