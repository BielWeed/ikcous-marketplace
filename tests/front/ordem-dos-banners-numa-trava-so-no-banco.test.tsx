// @vitest-environment jsdom
// A ordem dos banners muda numa trava só, DENTRO do banco (migration
// 20261651000000). Arrumar a página chama `normalize_banners_atomic` (uma
// transação, sob a trava da página) em vez de ler e gravar banner a banner; e
// subir/descer chama `move_banner_atomic` com o id e a DIREÇÃO, para o banco
// achar o vizinho de agora — não o que o aparelho calculou. Numa loja que ainda
// não tem as RPCs novas (PGRST202/42883), o painel cai no caminho antigo.
import { normalizeBannersOrder, useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as {
    id: string;
    image_url: string;
    title: string;
    position: string;
    active: boolean;
    order: number;
  }[],
  leituras: 0,
  update: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        h.leituras += 1;
        const lista = () =>
          Promise.resolve({
            data: h.linhas.map((b) => ({ ...b })),
            error: null,
          });
        return {
          order: () => ({ order: lista }),
          eq: () => ({ order: () => ({ order: lista }) }),
        };
      },
      update: (valores: { order: number }) => ({
        eq: (coluna: string, id: string) => h.update(valores, coluna, id),
      }),
    }),
    rpc: h.rpc,
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: h.toastError, info: vi.fn() },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEM_A_RPC = {
  code: "PGRST202",
  message: "Could not find the function in the schema cache",
};
const banner = (id: string, order: number) => ({
  id,
  image_url: "https://exemplo.com/banner.png",
  title: id,
  position: "home_top",
  active: true,
  order,
});

const desmontagens: (() => Promise<void>)[] = [];

async function montarPainel() {
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
      <output>
        {[...hook.banners]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((b) => b.id)
          .join(",")}
      </output>
    );
  }
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
  });
  await act(async () => raiz.render(<Sonda />));
  await act(async () => ler().refreshBanners(false, true));
  h.leituras = 0;
  return { ler, hospedeiro };
}

describe("a ordem dos banners muda numa trava só no banco", () => {
  beforeEach(() => {
    h.linhas = [banner("a", 1), banner("b", 2), banner("c", 3)];
    h.leituras = 0;
    h.update.mockReset().mockResolvedValue({ error: null });
    h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    h.toastError.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
  });

  it("subir manda o id e a direção; quem acha o vizinho é o banco", async () => {
    const { ler } = await montarPainel();
    h.rpc.mockResolvedValueOnce({ data: "a", error: null });
    await act(async () => ler().reorderBanners("b", "a", "cima"));

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("move_banner_atomic", {
      p_position: "home_top",
      p_banner_id: "b",
      p_direcao: "cima",
    });
    expect(h.update).not.toHaveBeenCalled();
    // O banco trocou com o mesmo vizinho que a tela mostrava: nada a reler.
    expect(h.leituras).toBe(0);
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("se outro aparelho mudou a lista, o banco troca com o vizinho de agora e a tela relê", async () => {
    const { ler, hospedeiro } = await montarPainel();
    // No banco, outro aparelho já desceu o "b": a ordem real é a, c, b.
    h.rpc.mockImplementationOnce(async () => {
      h.linhas = [banner("c", 1), banner("a", 2), banner("b", 3)];
      return { data: "a", error: null };
    });
    await act(async () => ler().reorderBanners("c", "b", "cima"));

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("move_banner_atomic", {
      p_position: "home_top",
      p_banner_id: "c",
      p_direcao: "cima",
    });
    expect(h.leituras).toBeGreaterThan(0);
    expect(hospedeiro.textContent).toBe("c,a,b");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("na ponta o banco não troca (NULL) e a tela relê a ordem verdadeira", async () => {
    const { ler, hospedeiro } = await montarPainel();
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await act(async () => ler().reorderBanners("b", "a", "cima"));
    expect(h.leituras).toBeGreaterThan(0);
    expect(hospedeiro.textContent).toBe("a,b,c");
  });

  it("loja sem a RPC nova (PGRST202) troca pelo caminho antigo, sem aviso de erro", async () => {
    const { ler, hospedeiro } = await montarPainel();
    h.rpc
      .mockResolvedValueOnce({ data: null, error: SEM_A_RPC })
      .mockResolvedValueOnce({ data: null, error: null });
    await act(async () => ler().reorderBanners("c", "b", "cima"));

    expect(h.rpc).toHaveBeenNthCalledWith(1, "move_banner_atomic", {
      p_position: "home_top",
      p_banner_id: "c",
      p_direcao: "cima",
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, "reorder_banners_atomic", {
      p_position: "home_top",
      p_banner_id_1: "c",
      p_banner_id_2: "b",
    });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.toastError).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toBe("a,c,b");
  });

  it("banner excluído em outro aparelho: a mesma frase e a lista relida", async () => {
    const { ler } = await montarPainel();
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "Banner não encontrado." },
    });
    await act(async () => ler().reorderBanners("b", "a", "cima"));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveBeenCalledWith(
      "Este banner foi excluído em outro aparelho ou você não tem mais acesso a ele.",
    );
    expect(h.leituras).toBeGreaterThan(0);
  });

  it("arrumar a página é uma RPC só, com o banner recém-salvo e o lado do empate", async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    await normalizeBannersOrder("home_top", "b", true);

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("normalize_banners_atomic", {
      p_position: "home_top",
      p_prioritario: "b",
      p_prioritario_depois: true,
    });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.leituras).toBe(0);
  });

  it.each(["PGRST202", "42883"])(
    "loja sem a RPC de arrumar (%s) arruma pelo caminho antigo",
    async (code) => {
      h.linhas = [banner("a", 7), banner("b", 7)];
      h.rpc.mockResolvedValue({ data: null, error: { code, message: "x" } });
      await normalizeBannersOrder("home_top");

      expect(h.rpc).toHaveBeenCalledOnce();
      expect(h.leituras).toBe(1);
      expect(h.update).toHaveBeenCalledTimes(2);
      expect(h.update).toHaveBeenCalledWith({ order: 1 }, "id", "a");
      expect(h.update).toHaveBeenCalledWith({ order: 2 }, "id", "b");
    },
  );

  it("outro erro da RPC de arrumar não cai no caminho antigo: registra e não grava", async () => {
    const erro = { code: "P0001", message: "Não autorizado" };
    h.rpc.mockResolvedValue({ data: null, error: erro });
    await normalizeBannersOrder("home_top");

    expect(h.update).not.toHaveBeenCalled();
    expect(h.leituras).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      "[Banners] Error normalizing banners order:",
      erro,
    );
  });
});
