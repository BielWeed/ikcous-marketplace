// @vitest-environment jsdom
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  atualizar: vi.fn(),
  remover: vi.fn(),
}));

const linha = {
  id: "banner-oferta",
  image_url:
    "https://example.com/storage/v1/object/public/banners/foto-antiga.png",
  title: "Oferta antiga",
  position: "home_top",
  active: true,
  order: 1,
};
const fotoNova =
  "https://example.com/storage/v1/object/public/banners/foto-nova.png";

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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      expect(tabela).toBe("banners");
      return {
        select: () => ({
          order: async () => ({ data: [linha], error: null }),
        }),
        update: h.atualizar,
      };
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("banners");
        return { remove: h.remover };
      },
    },
  },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const desmontagens: (() => Promise<void>)[] = [];
async function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const raiz = createRoot(host);
  let atual: ReturnType<typeof useBanners> | undefined;
  function Sonda() {
    const hook = useBanners(true);
    useEffect(() => {
      atual = hook;
    });
    return <output>{hook.banners.map((b) => b.title).join(",")}</output>;
  }
  const ler = () => {
    if (!atual) throw new Error("Hook não montado");
    return atual;
  };
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    host.remove();
  });
  await act(async () => raiz.render(<Sonda />));
  await act(async () => ler().refreshBanners(false, true));
  expect(ler().banners).toHaveLength(1);
  expect(ler().banners[0].imageUrl).toBe(linha.image_url);
  return { ler, host };
}

describe("editar banner só apaga a foto antiga quando há uma foto nova", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.remover.mockResolvedValue({ error: null });
    h.atualizar.mockImplementation(() => ({
      eq: (coluna: string, id: string) => {
        expect([coluna, id]).toEqual(["id", linha.id]);
        return {
          select: async (campos: string) => {
            expect(campos).toBe("id");
            return { data: [{ id }], error: null };
          },
        };
      },
    }));
  });

  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
  });

  it("salva só o título sem apagar o arquivo da foto que continua em uso", async () => {
    const { ler, host } = await montar();

    await act(async () => {
      await ler().updateBanner(linha.id, { title: "Oferta atualizada" });
    });

    expect(h.atualizar).toHaveBeenCalledExactlyOnceWith({
      title: "Oferta atualizada",
    });
    expect(host.textContent).toBe("Oferta atualizada");
    expect(ler().banners[0]).toMatchObject({
      title: "Oferta atualizada",
      imageUrl: linha.image_url,
    });
    expect(h.remover).not.toHaveBeenCalled();
  });

  it("ao trocar a foto remove uma única vez só o arquivo antigo", async () => {
    const { ler } = await montar();

    await act(async () => {
      await ler().updateBanner(linha.id, { imageUrl: fotoNova });
    });

    expect(h.atualizar).toHaveBeenCalledExactlyOnceWith({
      image_url: fotoNova,
    });
    expect(ler().banners[0].imageUrl).toBe(fotoNova);
    expect(h.remover).toHaveBeenCalledExactlyOnceWith(["foto-antiga.png"]);
  });
});
