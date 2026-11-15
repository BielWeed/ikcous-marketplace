// @vitest-environment jsdom
//
// O que a lojista escolhe no editor de banner chega ao banco do jeito que ela
// escolheu, e o fim da programação vale até o último instante. O dublê do
// banco só captura o corpo enviado; o hook é o real.
//
// - Editar a programação: `start_date`/`end_date` vão com o valor digitado;
//   campo esvaziado vai como `null` (apaga a data); campo que a edição nem
//   citou NÃO vai (não apaga a data que já existe).
// - Banner criado DESLIGADO nasce desligado (e o ligado, ligado).
// - O fim é inclusivo: com a hora igual ao instante final, o banner ainda
//   aparece na loja; 1 ms depois, some.
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
  consultar: vi.fn(),
  inserir: vi.fn(),
  atualizar: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: h.consultar }),
      insert: (linhas: unknown) => ({
        select: () => ({ single: () => h.inserir(linhas) }),
      }),
      update: (valores: unknown) => ({
        eq: (_coluna: string, id: string) => ({
          select: () => h.atualizar(valores, id),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    storage: { from: () => ({ remove: vi.fn() }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: async () => {},
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INICIO = "2026-12-01T03:00:00.000Z";
const FIM = "2026-12-31T23:59:59.000Z";

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  image_url: "https://exemplo.com/banner.png",
  title: `Banner ${id}`,
  position: "home_top",
  active: true,
  order: 1,
  ...extra,
});

const novoBanner = {
  imageUrl: "https://exemplo.com/novo.png",
  title: "Novo",
  position: "home_top" as const,
  active: true,
  order: 3,
};

describe("banners: o que a lojista mandou é o que chega ao banco e à vitrine", () => {
  const raizes: Root[] = [];
  const alvos: HTMLDivElement[] = [];
  let hook!: () => ReturnType<typeof useBanners>;

  async function montar(modoAdmin: boolean) {
    let atual!: ReturnType<typeof useBanners>;
    function Sonda() {
      const valor = useBanners(modoAdmin);
      useEffect(() => {
        atual = valor;
      });
      return (
        <>
          {valor
            .getBannersByPosition("home_top")
            .map((b) => b.title)
            .join(",")}
        </>
      );
    }
    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    const raiz = createRoot(alvo);
    raizes.push(raiz);
    alvos.push(alvo);
    await act(async () => raiz.render(<Sonda />));
    hook = () => atual;
    await act(async () => hook().refreshBanners(false, true));
    return alvo;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-12-15T12:00:00.000Z"));
    h.linhas = [linha("a")];
    h.consultar.mockReset().mockImplementation(async () => ({
      data: h.linhas,
      error: null,
    }));
    h.inserir.mockReset().mockImplementation(async (linhas: unknown[]) => ({
      data: linha("novo", linhas[0] as Record<string, unknown>),
      error: null,
    }));
    h.atualizar
      .mockReset()
      .mockResolvedValue({ data: [{ id: "a" }], error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const raiz of raizes.splice(0)) {
      await act(async () => raiz.unmount());
    }
    for (const alvo of alvos.splice(0)) alvo.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function editar(
    updates: Parameters<ReturnType<typeof hook>["updateBanner"]>[1],
  ) {
    await act(async () => {
      await hook().updateBanner("a", updates);
    });
    expect(h.atualizar).toHaveBeenCalledTimes(1);
    expect(h.atualizar.mock.calls[0][1]).toBe("a");
    return h.atualizar.mock.calls[0][0] as Record<string, unknown>;
  }

  async function criar(active: boolean) {
    await act(async () => {
      await hook().addBanner({ ...novoBanner, active });
    });
    expect(h.inserir).toHaveBeenCalledTimes(1);
    return (h.inserir.mock.calls[0][0] as Record<string, unknown>[])[0];
  }

  describe("editar a programação", () => {
    beforeEach(async () => {
      await montar(true);
    });

    it("o fim digitado vai ao banco com o valor exato", async () => {
      const corpo = await editar({ endDate: FIM });

      expect(corpo.end_date).toBe(FIM);
    });

    it("o início digitado vai ao banco com o valor exato", async () => {
      const corpo = await editar({ startDate: INICIO });

      expect(corpo.start_date).toBe(INICIO);
    });

    it("início e fim juntos chegam como a lojista mandou", async () => {
      const corpo = await editar({ startDate: INICIO, endDate: FIM });

      expect(corpo).toEqual({ start_date: INICIO, end_date: FIM });
    });

    it("fim esvaziado (texto vazio ou null) apaga a data: vai como null", async () => {
      const comTextoVazio = await editar({ endDate: "" });
      expect(comTextoVazio).toHaveProperty("end_date", null);

      h.atualizar.mockClear();
      const comNull = await editar({ endDate: null });
      expect(comNull).toHaveProperty("end_date", null);
    });

    it("início esvaziado (texto vazio ou null) apaga a data: vai como null", async () => {
      const comTextoVazio = await editar({ startDate: "" });
      expect(comTextoVazio).toHaveProperty("start_date", null);

      h.atualizar.mockClear();
      const comNull = await editar({ startDate: null });
      expect(comNull).toHaveProperty("start_date", null);
    });

    it("edição que não cita as datas NÃO as manda (não apaga a programação existente)", async () => {
      const corpo = await editar({ title: "Só o título" });

      expect(corpo).toEqual({ title: "Só o título" });
      expect(corpo).not.toHaveProperty("start_date");
      expect(corpo).not.toHaveProperty("end_date");
    });
  });

  describe("criar o banner", () => {
    beforeEach(async () => {
      await montar(true);
    });

    it("criado DESLIGADO nasce desligado", async () => {
      const corpo = await criar(false);

      expect(corpo.active).toBe(false);
    });

    it("criado LIGADO nasce ligado", async () => {
      const corpo = await criar(true);

      expect(corpo.active).toBe(true);
    });
  });

  describe("o fim da programação é inclusivo na vitrine", () => {
    it("no instante exato do fim ainda aparece; 1 ms depois some", async () => {
      h.linhas = [linha("a", { title: "Campanha", end_date: FIM })];
      vi.setSystemTime(new Date(FIM));
      const alvo = await montar(false);

      expect(alvo.textContent).toBe("Campanha");

      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(Date.now()).toBe(new Date(FIM).getTime() + 1);
      expect(alvo.textContent).toBe("");
    });
  });
});
