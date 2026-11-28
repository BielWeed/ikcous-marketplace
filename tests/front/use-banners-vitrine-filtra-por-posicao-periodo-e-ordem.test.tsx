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
const consultaPublica = vi.hoisted(() => {
  const ids = vi.fn();
  const select = vi.fn(() => ({ in: ids }));
  return { ids, select, from: vi.fn(() => ({ select })) };
});
vi.mock("@/lib/supabase", () => ({ supabase: { from: consultaPublica.from } }));
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

describe("destinos de produto da vitrine", () => {
  const pausado = "00000000-0000-4000-8000-000000000001";
  const excluido = "00000000-0000-4000-8000-000000000002";
  const esgotado = "00000000-0000-4000-8000-000000000003";
  const link = (id: string) => `/product-detail?id=${id}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("esconde pausado e excluído, mas preserva esgotado e outros destinos", async () => {
    consultaPublica.ids.mockResolvedValue({
      data: [{ id: esgotado, stock: 0 }],
      error: null,
    });
    expect(
      await mostrados([
        banner("pausado", { link: link(pausado) }),
        banner("pausado-repetido", { link: link(pausado) }),
        banner("excluido", { link: link(excluido) }),
        // O roteador aceita barra final e maiúsculas: o filtro também.
        banner("pausado-barra", {
          link: `/product-detail/?id=${pausado}`,
        }),
        banner("pausado-maiusculo", {
          link: `/Product-Detail?id=${pausado}`,
        }),
        // O banco aceita o id sem hífens: o filtro também.
        banner("pausado-sem-hifen", {
          link: `/product-detail?id=${pausado.replaceAll("-", "")}`,
        }),
        // Hífen duplicado o banco recusa: não entra na consulta e o banner fica.
        banner("hifen-duplo", {
          link: `/product-detail?id=${pausado.replace("-", "--")}`,
        }),
        banner("esgotado", { link: link(esgotado) }),
        banner("categoria", { link: "/?category=Bolsas" }),
        banner("externo", { link: `https://externo.invalid${link(pausado)}` }),
        banner("sem-link", { productId: pausado }),
      ]),
    ).toBe("categoria,esgotado,externo,hifen-duplo,sem-link");
    expect(consultaPublica.from).toHaveBeenCalledExactlyOnceWith(
      "vw_produtos_public",
    );
    expect(consultaPublica.select).toHaveBeenCalledExactlyOnceWith("id");
    expect(consultaPublica.ids).toHaveBeenCalledExactlyOnceWith("id", [
      pausado,
      excluido,
      esgotado,
    ]);
  });

  it("esconde o banner de produto pausado mesmo com o ID em maiúsculas", async () => {
    const id = "abcdef12-3456-4789-8abc-def012345678";
    consultaPublica.ids.mockResolvedValue({ data: [], error: null });

    expect(
      await mostrados([banner("pausado", { link: link(id.toUpperCase()) })]),
    ).toBe("");
    expect(consultaPublica.ids).toHaveBeenCalledExactlyOnceWith("id", [id]);
  });

  it("mantém o banner escondido quando a consulta anterior responde por último", async () => {
    type Resposta = { data: { id: string }[]; error: null };
    const antiga = Promise.withResolvers<Resposta>();
    const nova = Promise.withResolvers<Resposta>();
    consultaPublica.ids
      .mockReturnValueOnce(antiga.promise)
      .mockReturnValueOnce(nova.promise);
    h.banners = [banner("produto", { link: link(pausado) })];

    function Sonda() {
      const { getBannersByPosition, refreshBanners } = useBanners();
      return (
        <button type="button" onClick={() => void refreshBanners()}>
          {getBannersByPosition("home_top")
            .map((b) => b.id)
            .join(",")}
        </button>
      );
    }

    await act(async () => raiz.render(<Sonda />));
    expect(consultaPublica.ids).toHaveBeenCalledExactlyOnceWith("id", [
      pausado,
    ]);
    expect(alvo.textContent).toBe("produto");

    h.banners = [...h.banners];
    await act(async () => alvo.querySelector("button")?.click());
    expect(consultaPublica.ids).toHaveBeenCalledTimes(2);
    expect(consultaPublica.ids).toHaveBeenNthCalledWith(2, "id", [pausado]);

    // A consulta nova já sabe que o produto foi pausado; a antiga ainda não.
    await act(async () => nova.resolve({ data: [], error: null }));
    expect(alvo.textContent).toBe("");

    await act(async () =>
      antiga.resolve({ data: [{ id: pausado }], error: null }),
    );
    expect(alvo.textContent).toBe("");
  });

  it("mantém o banner se a consulta falhar", async () => {
    consultaPublica.ids.mockResolvedValue({
      data: null,
      error: { code: "503" },
    });
    expect(await mostrados([banner("produto", { link: link(pausado) })])).toBe(
      "produto",
    );
    expect(consultaPublica.ids).toHaveBeenCalledTimes(1);
  });

  it("não consulta quando só há link de categoria", async () => {
    expect(
      await mostrados([banner("categoria", { link: "/?category=Bolsas" })]),
    ).toBe("categoria");
    expect(consultaPublica.from).not.toHaveBeenCalled();
  });

  it("não filtra a lista do painel", async () => {
    expect(
      await mostrados(
        [banner("pausado", { link: link(pausado) })],
        "home_top",
        true,
      ),
    ).toBe("pausado");
    expect(consultaPublica.from).not.toHaveBeenCalled();
  });
});

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
