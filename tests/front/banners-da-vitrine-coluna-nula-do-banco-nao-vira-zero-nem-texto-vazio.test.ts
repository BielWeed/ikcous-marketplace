// @vitest-environment jsdom
//
// O banco devolve `null` (não "ausente") para a coluna que a lojista nunca
// preencheu. Duas colunas dão defeito se o `null` for lido do jeito errado:
//  - `overlay_opacity` nulo NÃO pode virar 0: `Number(null)` é 0, e o banner
//    nasceria com a película totalmente transparente em vez do padrão da loja
//    (opacidade "sem valor" = a tela escolhe o padrão). 0 de verdade, escolhido
//    pela lojista, segue valendo (já coberto no teste vizinho);
//  - datas e foto do computador em branco ("") valem "sem valor" (`null`), para
//    quem lê o banner não ter de tratar texto vazio como se fosse uma data.
//
// Cada caso monta o módulo do zero (o cache e a consulta em voo são do módulo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ order: h.consultar }),
      }),
    }),
  },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));

const FOTO = "https://loja.test/storage/v1/object/public/banners/a.png";

async function lerUm(extra: Record<string, unknown>) {
  h.consultar.mockResolvedValue({
    data: [{ id: "b1", image_url: FOTO, position: "home_top", ...extra }],
    error: null,
  });
  vi.resetModules();
  const { pedirBanners } = await import("@/lib/banners-da-vitrine");
  const [banner] = await pedirBanners();
  if (!banner) throw new Error("nenhum banner foi lido");
  return banner;
}

beforeEach(() => {
  h.consultar.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("coluna nula do banco", () => {
  it("opacidade nula fica SEM valor, não vira 0 (película transparente)", async () => {
    const banner = await lerUm({ overlay_opacity: null });
    expect(banner.overlayOpacity).toBeUndefined();
  });

  it("opacidade 0 escolhida pela lojista continua 0", async () => {
    const banner = await lerUm({ overlay_opacity: 0 });
    expect(banner.overlayOpacity).toBe(0);
  });

  it.each([
    ["foto do computador", "desktop_image_url", "desktopImageUrl"],
    ["data de início", "start_date", "startDate"],
    ["data de fim", "end_date", "endDate"],
  ] as const)(
    "%s em branco ou nula vira 'sem valor' (null)",
    async (_nome, coluna, campo) => {
      const campoDe = async (valor: string | null) =>
        new Map(Object.entries(await lerUm({ [coluna]: valor }))).get(campo);
      expect(await campoDe("")).toBeNull();
      expect(await campoDe(null)).toBeNull();
    },
  );
});
