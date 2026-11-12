// @vitest-environment jsdom
import { useBanners } from "@/hooks/useBanners";
import type { Banner } from "@/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isAdmin: false,
  insert: vi.fn(),
  update: vi.fn(),
  excluir: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  replaceAll: vi.fn(),
}));

const linha = {
  id: "banner-antigo",
  image_url: "https://example.com/antigo.png",
  title: "Oferta antiga",
  position: "home_top",
  active: true,
  order: 1,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin }),
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
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: async (file: File) => file,
}));
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      expect(tabela).toBe("banners");
      return {
        select: () => ({
          order: () => Promise.resolve({ data: [linha], error: null }),
          eq: (coluna: string, valor: string) => {
            expect([coluna, valor]).toEqual(["position", "home_top"]);
            return {
              order: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          },
        }),
        insert: h.insert,
        update: h.update,
        delete: h.excluir,
      };
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("banners");
        return {
          upload: h.upload,
          remove: h.remove,
          getPublicUrl: () => ({
            data: { publicUrl: "https://example.com/nova.png" },
          }),
        };
      },
    },
  },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const novo: Omit<Banner, "id"> = {
  imageUrl: "https://example.com/nova.png",
  title: "Oferta nova",
  position: "home_top",
  active: true,
  order: 2,
};

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
  h.replaceAll.mockClear();
  return { ler, host };
}

type Hook = ReturnType<typeof useBanners>;
const operacoes: {
  nome: string;
  executar: (hook: Hook) => Promise<unknown>;
}[] = [
  {
    nome: "upload",
    executar: (hook) =>
      hook.uploadBannerImage(
        new File(["imagem"], "oferta.png", { type: "image/png" }),
      ),
  },
  { nome: "criação", executar: (hook) => hook.addBanner(novo) },
  {
    nome: "atualização",
    executar: (hook) =>
      hook.updateBanner("banner-antigo", { title: "Título atualizado" }),
  },
  {
    nome: "exclusão",
    executar: (hook) => hook.deleteBanner("banner-antigo", linha.image_url),
  },
];

describe("sem admin nenhuma operação de banner grava", () => {
  beforeEach(() => {
    h.isAdmin = false;
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.replaceAll.mockResolvedValue(undefined);
    h.upload.mockResolvedValue({ error: null });
    h.remove.mockResolvedValue({ error: null });
    h.insert.mockImplementation((linhas: Record<string, unknown>[]) => ({
      select: () => ({
        single: async () => ({
          data: { ...linhas[0], id: "banner-novo" },
          error: null,
        }),
      }),
    }));
    const porId = (coluna: string, id: string) => {
      expect([coluna, id]).toEqual(["id", "banner-antigo"]);
      return { select: async () => ({ data: [{ id }], error: null }) };
    };
    h.update.mockImplementation(() => ({ eq: porId }));
    h.excluir.mockImplementation(() => ({ eq: porId }));
  });
  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
  });

  it.each(operacoes)(
    "$nome recusado não escreve nem muda o estado",
    async ({ executar }) => {
      const { ler, host } = await montar();
      expect(ler().banners).toHaveLength(1);
      const antes = ler().banners;
      const texto = host.textContent;
      await act(async () => {
        await expect(executar(ler())).rejects.toThrow("Acesso negado:");
      });
      expect(h.insert).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
      expect(h.excluir).not.toHaveBeenCalled();
      expect(h.upload).not.toHaveBeenCalled();
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.replaceAll).not.toHaveBeenCalled();
      expect(ler().banners).toBe(antes);
      expect(host.textContent).toBe(texto);
    },
  );

  it.each(operacoes)(
    "$nome com admin segue com a mesma entrada",
    async ({ nome, executar }) => {
      h.isAdmin = true;
      const { ler } = await montar();
      await act(async () => {
        await executar(ler());
      });
      if (nome === "upload") {
        expect(h.upload).toHaveBeenCalledOnce();
      } else if (nome === "criação") {
        expect(h.insert).toHaveBeenCalledOnce();
        expect(ler().banners.some((b) => b.title === novo.title)).toBe(true);
      } else if (nome === "atualização") {
        expect(h.update).toHaveBeenCalledWith({ title: "Título atualizado" });
        expect(ler().banners[0].title).toBe("Título atualizado");
      } else {
        expect(h.excluir).toHaveBeenCalledOnce();
        expect(h.remove).toHaveBeenCalledWith(["antigo.png"]);
        expect(ler().banners).toEqual([]);
      }
    },
  );
});
