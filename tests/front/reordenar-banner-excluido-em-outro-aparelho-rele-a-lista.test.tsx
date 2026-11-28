// @vitest-environment jsdom
// Trocar a ordem de dois banners quando outro aparelho já excluiu o vizinho:
// a RPC `reorder_banners_atomic` recusa com "Banner não encontrado.". Antes a
// tela voltava ao retrato velho (com o banner excluído de volta, na tela e no
// cofre local) e dizia só "Erro ao reordenar banners.". Agora, depois de
// desfazer, a lista é relida do banco, e a recusa diz o motivo com a MESMA
// frase de "excluído em outro aparelho" que `updateBanner` já usa.
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
  leituras: 0,
  rpc: vi.fn(),
  replaceAll: vi.fn(),
  toastError: vi.fn(),
}));

const lerLinhas = () => {
  h.leituras += 1;
  return Promise.resolve({ data: h.linhas, error: null });
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ order: lerLinhas }),
        eq: () => ({ order: () => ({ order: lerLinhas }) }),
      }),
    }),
    rpc: h.rpc,
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      replaceAll: h.replaceAll,
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: h.toastError,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEXTO_EXCLUIDO_EM_OUTRO_APARELHO =
  "Este banner foi excluído em outro aparelho ou você não tem mais acesso a ele.";

const linha = (id: string, order: number) => ({
  id,
  image_url: "https://exemplo.com/banner.png",
  title: "Oferta",
  position: "home_top",
  active: true,
  order,
});

const desmontagens: (() => Promise<void>)[] = [];

async function montarPainel() {
  h.linhas = [linha("banner-a", 1), linha("banner-b", 2)];
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  let captura: ReturnType<typeof useBanners> | undefined;
  const ler = () => {
    if (!captura) throw new Error("sonda não capturou useBanners");
    return captura;
  };
  function Sonda() {
    const hook = useBanners(true);
    useEffect(() => {
      captura = hook;
    });
    return (
      <output>{hook.banners.map((b) => `${b.id}:${b.order}`).join(",")}</output>
    );
  }
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
  });
  await act(async () => raiz.render(<Sonda />));
  await act(async () => ler().refreshBanners(false, true));
  h.leituras = 0;
  h.replaceAll.mockClear();
  return { ler, hospedeiro };
}

describe("reordenar com o vizinho excluído em outro aparelho", () => {
  beforeEach(() => {
    h.leituras = 0;
    h.rpc.mockReset();
    h.replaceAll.mockReset().mockResolvedValue(undefined);
    h.toastError.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
  });

  it("'Banner não encontrado.' diz o motivo e relê a lista do banco", async () => {
    const { ler, hospedeiro } = await montarPainel();
    expect(hospedeiro.textContent).toBe("banner-a:1,banner-b:2");
    // Outro aparelho excluiu o banner-b: o banco já não o tem.
    h.linhas = [linha("banner-a", 1)];
    h.rpc.mockResolvedValueOnce({
      error: { message: "Banner não encontrado." },
    });

    await act(async () => ler().reorderBanners("banner-a", "banner-b"));

    expect(h.toastError).toHaveBeenCalledExactlyOnceWith(
      TEXTO_EXCLUIDO_EM_OUTRO_APARELHO,
    );
    expect(h.leituras).toBe(1);
    // O banner excluído não volta: nem na tela, nem no cofre local.
    expect(hospedeiro.textContent).toBe("banner-a:1");
    expect(h.replaceAll).toHaveBeenLastCalledWith("banners", [
      expect.objectContaining({ id: "banner-a" }),
    ]);
  });

  it("controle: erro genérico segue 'Erro ao reordenar banners.' e também relê", async () => {
    const { ler, hospedeiro } = await montarPainel();
    h.rpc.mockResolvedValueOnce({ error: { message: "boom" } });

    await act(async () => ler().reorderBanners("banner-a", "banner-b"));

    expect(h.toastError).toHaveBeenCalledExactlyOnceWith(
      "Erro ao reordenar banners.",
    );
    expect(h.leituras).toBe(1);
    expect(hospedeiro.textContent).toBe("banner-a:1,banner-b:2");
  });
});
