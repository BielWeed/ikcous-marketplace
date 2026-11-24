// @vitest-environment jsdom
//
// Criar um banner: o que a lojista escolheu chega ao banco do jeito que ela
// escolheu, e o que ela deixou em branco vai como NULO (nunca texto vazio, que o
// banco recusaria como data). Complementa o teste de EDIÇÃO da programação: aqui
// é o corpo do INSERT. O dublê do banco só captura o corpo; o hook é o real.
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  inserir: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ order: h.consultar }) }),
      insert: (linhas: unknown) => ({
        select: () => ({ single: () => h.inserir(linhas) }),
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

const base = {
  imageUrl: "https://exemplo.com/novo.png",
  title: "Novo",
  position: "home_top" as const,
  active: true,
  order: 3,
};

describe("criar o banner: o corpo do INSERT", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let hook!: () => ReturnType<typeof useBanners>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    h.consultar.mockReset().mockResolvedValue({ data: [], error: null });
    h.inserir.mockReset().mockImplementation(async (linhas: unknown[]) => ({
      data: { id: "novo", ...(linhas[0] as Record<string, unknown>) },
      error: null,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    let atual!: ReturnType<typeof useBanners>;
    function Sonda() {
      const valor = useBanners(true);
      useEffect(() => {
        atual = valor;
      });
      return null;
    }
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
    await act(async () => raiz.render(<Sonda />));
    hook = () => atual;
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    alvo.remove();
    vi.restoreAllMocks();
  });

  async function criar(
    extra: Parameters<ReturnType<typeof hook>["addBanner"]>[0],
  ) {
    await act(async () => {
      await hook().addBanner(extra);
    });
    expect(h.inserir).toHaveBeenCalledTimes(1);
    return (h.inserir.mock.calls[0]?.[0] as Record<string, unknown>[])[0] ?? {};
  }

  it("a programação digitada vai com o valor exato", async () => {
    const corpo = await criar({ ...base, startDate: INICIO, endDate: FIM });

    expect(corpo.start_date).toBe(INICIO);
    expect(corpo.end_date).toBe(FIM);
  });

  it("datas em branco (texto vazio, nulo ou ausente) vão como nulo", async () => {
    const vazias = await criar({ ...base, startDate: "", endDate: "" });
    expect(vazias).toHaveProperty("start_date", null);
    expect(vazias).toHaveProperty("end_date", null);

    h.inserir.mockClear();
    const nulas = await criar({ ...base, startDate: null, endDate: null });
    expect(nulas).toHaveProperty("start_date", null);
    expect(nulas).toHaveProperty("end_date", null);

    h.inserir.mockClear();
    const ausentes = await criar({ ...base });
    expect(ausentes).toHaveProperty("start_date", null);
    expect(ausentes).toHaveProperty("end_date", null);
  });

  it("textos visíveis por padrão; escondidos quando a lojista escondeu", async () => {
    const padrao = await criar({ ...base });
    expect(padrao.show_text_overlay).toBe(true);

    h.inserir.mockClear();
    const escondido = await criar({ ...base, showTextOverlay: false });
    expect(escondido.show_text_overlay).toBe(false);
  });

  it("produto em branco vai como nulo; produto escolhido vai como escolhido", async () => {
    const semProduto = await criar({ ...base, productId: "" });
    expect(semProduto).toHaveProperty("product_id", null);

    h.inserir.mockClear();
    const comProduto = await criar({ ...base, productId: "p-9" });
    expect(comProduto.product_id).toBe("p-9");
  });

  it("a foto do computador só vai quando a lojista a mencionou; em branco vira nulo", async () => {
    const semMencao = await criar({ ...base });
    expect(semMencao).not.toHaveProperty("desktop_image_url");

    h.inserir.mockClear();
    const emBranco = await criar({ ...base, desktopImageUrl: "" });
    expect(emBranco).toHaveProperty("desktop_image_url", null);

    h.inserir.mockClear();
    const comFoto = await criar({
      ...base,
      desktopImageUrl: "https://exemplo.com/pc.png",
    });
    expect(comFoto.desktop_image_url).toBe("https://exemplo.com/pc.png");
  });

  it("banner criado desligado nasce desligado, na ordem que a lojista pediu", async () => {
    const corpo = await criar({ ...base, active: false, order: 7 });

    expect(corpo.active).toBe(false);
    expect(corpo.order).toBe(7);
    expect(corpo.position).toBe("home_top");
  });
});
