// @vitest-environment jsdom
//
// O que a vitrine mostra em cada posição da Home: só a posição pedida, só banner
// LIGADO, só dentro da programação (início e fim inclusive, ao milissegundo), só
// com foto para a tela, na ordem da lojista (empate pelo id). O painel
// (`adminMode`) vê tudo da posição, ligado ou não, vencido ou futuro.
//
// Relógio fixo com timers falsos; nada de rede. Os testes vizinhos provam o
// fim da programação e a virada de horário; aqui estão o início, a posição, o
// ligado/desligado, a foto e a ordem.
import type { Banner } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const AGORA = "2026-11-24T15:00:00.000Z";
const AGORA_MS = Date.parse(AGORA);
const iso = (instante: number) => new Date(instante).toISOString();

const alvo = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;

function banner(id: string, extra: Partial<Banner> = {}): Banner {
  return {
    id,
    title: id,
    imageUrl: "/banner.jpg",
    active: true,
    order: 1,
    position: "home_top",
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AGORA));
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

/** Os ids que a posição mostra, na ordem em que aparecem. */
async function mostrados(
  lista: Banner[],
  posicao: Banner["position"] = "home_top",
  painel = false,
): Promise<string> {
  h.banners = lista;
  function Sonda() {
    const { getBannersByPosition } = useBanners(painel);
    return (
      <>
        {getBannersByPosition(posicao)
          .map((b) => b.id)
          .join(",")}
      </>
    );
  }
  await act(async () => raiz.render(<Sonda />));
  return alvo.textContent ?? "";
}

describe("a posição e o ligado/desligado", () => {
  it("mostra só os banners da posição pedida", async () => {
    const lista = [
      banner("topo"),
      banner("meio", { position: "home_middle" }),
      banner("rodape", { position: "home_bottom" }),
    ];
    expect(await mostrados(lista, "home_top")).toBe("topo");
    expect(await mostrados(lista, "home_middle")).toBe("meio");
    expect(await mostrados(lista, "home_bottom")).toBe("rodape");
  });

  it("banner pausado não aparece, mesmo dentro da programação", async () => {
    const lista = [
      banner("pausado", {
        active: false,
        startDate: iso(AGORA_MS - 1000),
        endDate: iso(AGORA_MS + 1000),
      }),
      banner("ligado"),
    ];
    expect(await mostrados(lista)).toBe("ligado");
  });

  it("banner sem foto para a tela não aparece", async () => {
    const lista = [banner("sem-foto", { imageUrl: "" }), banner("com-foto")];
    expect(await mostrados(lista)).toBe("com-foto");
  });
});

describe("o início da programação, no milissegundo", () => {
  it("começa neste exato instante: já aparece", async () => {
    const lista = [banner("agora", { startDate: AGORA })];
    expect(await mostrados(lista)).toBe("agora");
  });

  it("começa 1 ms depois: ainda não aparece", async () => {
    const lista = [banner("em-breve", { startDate: iso(AGORA_MS + 1) })];
    expect(await mostrados(lista)).toBe("");
  });

  it("começou há 1 ms: aparece", async () => {
    const lista = [banner("comecou", { startDate: iso(AGORA_MS - 1) })];
    expect(await mostrados(lista)).toBe("comecou");
  });

  it("já passou do fim: não aparece; termina agora: ainda aparece", async () => {
    const lista = [
      banner("vencido", { endDate: iso(AGORA_MS - 1) }),
      banner("ultimo-instante", { endDate: AGORA, order: 2 }),
    ];
    expect(await mostrados(lista)).toBe("ultimo-instante");
  });

  it("só início ou só fim: cada um vale sozinho", async () => {
    const lista = [
      banner("so-inicio", { startDate: iso(AGORA_MS - 5000), order: 1 }),
      banner("so-fim", { endDate: iso(AGORA_MS + 5000), order: 2 }),
      banner("sem-datas", { startDate: null, endDate: null, order: 3 }),
    ];
    expect(await mostrados(lista)).toBe("so-inicio,so-fim,sem-datas");
  });
});

describe("a ordem na vitrine", () => {
  it("segue a ordem da lojista, do menor para o maior", async () => {
    const lista = [
      banner("c", { order: 3 }),
      banner("a", { order: 1 }),
      banner("b", { order: 2 }),
    ];
    expect(await mostrados(lista)).toBe("a,b,c");
  });

  it("empate de ordem se desfaz pelo id, sempre do mesmo jeito", async () => {
    const lista = [
      banner("z", { order: 1 }),
      banner("m", { order: 1 }),
      banner("a", { order: 1 }),
    ];
    expect(await mostrados(lista)).toBe("a,m,z");
    expect(await mostrados([...lista].reverse())).toBe("a,m,z");
  });

  it("sem ordem vale 0 e vem antes do 1", async () => {
    // A linha antiga do cofre pode vir sem a coluna de ordem.
    const semOrdem = banner("sem-ordem", {
      order: undefined as unknown as number,
    });
    const lista = [banner("um", { order: 1 }), semOrdem];
    expect(await mostrados(lista)).toBe("sem-ordem,um");
  });
});

describe("o painel da lojista vê tudo da posição", () => {
  it("pausado, futuro, vencido e sem foto aparecem; outra posição não", async () => {
    const lista = [
      banner("pausado", { active: false, order: 1 }),
      banner("futuro", { startDate: iso(AGORA_MS + 60_000), order: 2 }),
      banner("vencido", { endDate: iso(AGORA_MS - 60_000), order: 3 }),
      banner("sem-foto", { imageUrl: "", order: 4 }),
      banner("meio", { position: "home_middle", order: 5 }),
    ];
    expect(await mostrados(lista, "home_top", true)).toBe(
      "pausado,futuro,vencido,sem-foto",
    );
  });
});
