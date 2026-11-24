// @vitest-environment jsdom
//
// O relógio que tira o banner da vitrine NO horário, sem a cliente mexer em
// nada, nas bordas que o teste de "entra e sai" não separa (ele avança o tempo
// de uma vez só e por isso não enxerga a diferença de 1 ms):
//
//  - o fim é INCLUSIVO: no milissegundo exato do fim o banner ainda está na
//    tela, e o relógio acorda UM milissegundo depois para tirá-lo. Se acordasse
//    no instante do fim, a tela reavaliaria ainda dentro do prazo e o banner
//    vencido ficaria no ar até a próxima consulta à rede (até 1 minuto);
//  - banner desligado nunca vira horário de virada: não acorda a Home à toa;
//  - a lista só é relida ao montar quando a última verdade tem MAIS de 60 s (no
//    segundo 60 exato ainda vale; no 60,001 já não);
//  - o PAINEL não relê a lista sozinho a cada minuto (quem edita já a tem; a
//    releitura periódica é só da vitrine da cliente).
import type { Banner } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  banners: [] as Banner[],
  hora: null as number | null,
  pedir: vi.fn(),
}));
vi.mock("@/lib/banners-da-vitrine", () => ({
  acompanharBannersDoRealtime: vi.fn(),
  bannersEmCache: () => h.banners,
  horaDaUltimaConsultaDeBanners: () => h.hora ?? Date.now(),
  consultaDeBannersEmVoo: () => null,
  geracaoDasMutacoesDeBanners: () => 0,
  gravarBannersLocais: vi.fn(),
  pedirBanners: h.pedir,
  semearBannersDoCofre: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({
  useSyncListener: vi.fn(),
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

const AGORA = Date.parse("2026-11-07T12:00:00Z");
const em = (ms: number) => new Date(AGORA + ms).toISOString();

const banner = (extra: Partial<Banner> = {}): Banner => ({
  id: "campanha",
  title: "Campanha",
  imageUrl: "/banner.jpg",
  active: true,
  order: 1,
  position: "home_top",
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AGORA));
  h.pedir.mockReset();
  h.pedir.mockImplementation(async () => h.banners);
  h.banners = [];
  h.hora = null;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
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

describe("o fim da programação, no milissegundo, na vitrine aberta", () => {
  it("no milissegundo exato do fim o banner ainda está; 1 ms depois sai, sem consulta à rede", async () => {
    h.banners = [banner({ endDate: em(2000) })];
    await montar();
    expect(alvo.textContent).toBe("Campanha");

    await act(async () => vi.advanceTimersByTime(2000));
    expect(alvo.textContent).toBe("Campanha");

    await act(async () => vi.advanceTimersByTime(1));
    expect(alvo.textContent).toBe("");
    expect(h.pedir).not.toHaveBeenCalled();
  });

  it("o início, ao contrário, vale NO instante: aparece quando o relógio chega nele", async () => {
    h.banners = [banner({ startDate: em(2000) })];
    await montar();
    expect(alvo.textContent).toBe("");

    await act(async () => vi.advanceTimersByTime(1999));
    expect(alvo.textContent).toBe("");

    await act(async () => vi.advanceTimersByTime(1));
    expect(alvo.textContent).toBe("Campanha");
  });
});

describe("o que arma ou não o relógio de virada", () => {
  it("banner desligado com data futura não acorda a Home; o ligado acorda", async () => {
    await montar();
    const semBanner = vi.getTimerCount();
    act(() => raiz.unmount());

    h.banners = [banner({ active: false, startDate: em(60_000) })];
    raiz = createRoot(alvo);
    await montar();
    const desligado = vi.getTimerCount();
    act(() => raiz.unmount());

    h.banners = [banner({ active: true, startDate: em(60_000) })];
    raiz = createRoot(alvo);
    await montar();
    const ligado = vi.getTimerCount();

    expect(desligado).toBe(semBanner);
    expect(ligado).toBe(semBanner + 1);
  });
});

describe("o relógio de virada e a releitura no painel e com a aba oculta", () => {
  it("o painel mostra tudo: banner ligado com data futura não arma horário de virada", async () => {
    await montar(true);
    const semBanner = vi.getTimerCount();
    act(() => raiz.unmount());

    h.banners = [banner({ active: true, startDate: em(60_000) })];
    raiz = createRoot(alvo);
    await montar(true);

    expect(vi.getTimerCount()).toBe(semBanner);
  });

  it("aba oculta ao montar não arma a releitura de minuto em minuto", async () => {
    await montar();
    const visivel = vi.getTimerCount();
    act(() => raiz.unmount());

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    raiz = createRoot(alvo);
    await montar();

    expect(vi.getTimerCount()).toBe(visivel - 1);
  });
});

describe("a última verdade que ainda vale ao montar", () => {
  it("com exatamente 60 s não relê; com 60,001 s relê uma vez", async () => {
    h.hora = AGORA - 60_000;
    await montar();
    expect(h.pedir).not.toHaveBeenCalled();
    act(() => raiz.unmount());

    h.hora = AGORA - 60_001;
    raiz = createRoot(alvo);
    await montar();
    expect(h.pedir).toHaveBeenCalledTimes(1);
  });
});

describe("a releitura periódica é só da vitrine da cliente", () => {
  it("a vitrine relê a cada minuto; o painel só relê ao abrir", async () => {
    await montar(false);
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    const vitrine = h.pedir.mock.calls.length;
    act(() => raiz.unmount());

    h.pedir.mockClear();
    raiz = createRoot(alvo);
    await montar(true);
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    const painel = h.pedir.mock.calls.length;

    expect(vitrine).toBeGreaterThanOrEqual(3);
    expect(painel).toBe(1);
  });
});
