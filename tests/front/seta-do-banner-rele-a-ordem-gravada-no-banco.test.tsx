// @vitest-environment jsdom
//
// SETA DO BANNER: A RELEITURA DEPOIS DA TROCA LÊ O BANCO DE VERDADE.
//
// O DEFEITO: quando `move_banner_atomic` troca com outro vizinho (outro
// aparelho mudou a lista), ou a troca falha e a tela a desfaz, o painel relê a
// lista. Mas se uma leitura de fundo (temporizador, volta para a aba) já estava
// em voo numa rede lenta, a releitura pegava carona nela. Essa consulta começou
// ANTES da troca: ao terminar, via a geração das mutações mudada e devolvia o
// cache local — justamente a troca otimista (ou o retrato desfeito). A tela
// ficava com uma ordem diferente da gravada até a próxima atualização.
//
// O CONSERTO: nesses caminhos a releitura sai como consulta NOVA, sem carona,
// com a geração capturada depois da troca. Esta suíte cai se ela voltar a
// pegar carona na consulta antiga.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = {
  id: string;
  image_url: string;
  title: string;
  position: string;
  active: boolean;
  order: number;
};

const h = vi.hoisted(() => ({
  linhas: [] as Linha[],
  // Próxima leitura fica pendurada até o teste soltá-la (rede lenta).
  pendurarProxima: false,
  soltar: null as null | (() => void),
  rpc: vi.fn(),
  // Resposta do UPDATE de `updateBanner` (`.update().eq().select("id")`).
  gravar: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => {
            // O retrato é o do banco NO INSTANTE em que a leitura saiu.
            const retrato = {
              data: h.linhas.map((b) => ({ ...b })),
              error: null,
            };
            if (!h.pendurarProxima) return Promise.resolve(retrato);
            h.pendurarProxima = false;
            return new Promise((resolver) => {
              h.soltar = () => resolver(retrato);
            });
          },
        }),
      }),
      update: () => ({ eq: () => ({ select: h.gravar }) }),
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
  toast: {
    success: vi.fn(),
    error: h.toastError,
    warning: h.toastWarning,
    info: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const banner = (id: string, order: number): Linha => ({
  id,
  image_url: "https://exemplo.com/banner.png",
  title: id,
  position: "home_top",
  active: true,
  order,
});

const desmontagens: (() => Promise<void>)[] = [];

async function montarPainel() {
  const { useBanners } = await import("@/hooks/useBanners");
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
  return { ler, hospedeiro };
}

/** Uma leitura de fundo (a do temporizador) sai e fica pendurada na rede. */
async function leituraDeFundoPendurada(
  ler: () => { refreshBanners: (a?: boolean, b?: boolean) => Promise<void> },
) {
  h.pendurarProxima = true;
  await act(async () => {
    void ler().refreshBanners();
  });
  expect(h.soltar).not.toBeNull();
}

describe("seta do banner relê a ordem gravada no banco", () => {
  beforeEach(() => {
    vi.resetModules();
    h.linhas = [banner("a", 1), banner("b", 2), banner("c", 3)];
    h.pendurarProxima = false;
    h.soltar = null;
    h.rpc.mockReset();
    h.gravar.mockReset();
    h.toastError.mockReset();
    h.toastWarning.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    // A leitura antiga termina por último: não pode desfazer o que foi relido.
    await act(async () => h.soltar?.());
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("o banco trocou com outro vizinho: a tela termina com a ordem do banco", async () => {
    const { ler, hospedeiro } = await montarPainel();
    expect(hospedeiro.textContent).toBe("a,b,c");
    await leituraDeFundoPendurada(ler);

    // No banco, outro aparelho já desceu o "b": a ordem real fica c, a, b.
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
    // Sem soltar a leitura antiga: a releitura não depende dela.
    expect(hospedeiro.textContent).toBe("c,a,b");

    await act(async () => h.soltar?.());
    expect(hospedeiro.textContent).toBe("c,a,b");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("banner excluído em outro aparelho: a lista relida sai do banco, sem ele", async () => {
    const { ler, hospedeiro } = await montarPainel();
    await leituraDeFundoPendurada(ler);

    h.rpc.mockImplementationOnce(async () => {
      h.linhas = [banner("a", 1), banner("c", 2)];
      return {
        data: null,
        error: { code: "P0001", message: "Banner não encontrado." },
      };
    });
    await act(async () => ler().reorderBanners("b", "a", "cima"));

    expect(h.toastError).toHaveBeenCalledWith(
      "Este banner foi excluído em outro aparelho ou você não tem mais acesso a ele.",
    );
    expect(hospedeiro.textContent).toBe("a,c");

    await act(async () => h.soltar?.());
    expect(hospedeiro.textContent).toBe("a,c");
  });

  it("troca sem resposta: a releitura mostra o que o banco guardou", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { ler, hospedeiro } = await montarPainel();

    // A RPC não responde; o banco, porém, gravou a troca (a, c, b).
    h.rpc.mockImplementationOnce(() => new Promise(() => {}));
    let troca: Promise<void> | undefined;
    await act(async () => {
      troca = ler().reorderBanners("c", "b", "cima");
    });
    h.linhas = [banner("a", 1), banner("c", 2), banner("b", 3)];
    // No meio da espera, a leitura de fundo sai e fica pendurada.
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await leituraDeFundoPendurada(ler);

    // Estoura o prazo da troca: a tela desfaz e relê.
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await act(async () => troca);

    expect(h.toastWarning).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toBe("a,c,b");
  });

  // Salvar no editor (`updateBanner`) também desfaz a mudança otimista e relê
  // em dois caminhos: a mesma carona devolvia o retrato desfeito.
  it("salvar banner excluído em outro aparelho: a lista relida sai do banco, sem ele", async () => {
    const { ler, hospedeiro } = await montarPainel();
    await leituraDeFundoPendurada(ler);

    // O UPDATE não acha a linha (outro aparelho excluiu o "b").
    h.gravar.mockImplementationOnce(async () => {
      h.linhas = [banner("a", 1), banner("c", 2)];
      return { data: [], error: null };
    });
    await act(async () => {
      // A releitura é esperada dentro de `updateBanner`: sem carona, ela não
      // fica presa à leitura antiga.
      void ler()
        .updateBanner("b", { title: "novo" })
        .catch(() => {});
    });

    expect(h.toastError).toHaveBeenCalledWith(
      "Este banner foi excluído em outro aparelho ou você não tem mais acesso a ele.",
    );
    expect(hospedeiro.textContent).toBe("a,c");

    await act(async () => h.soltar?.());
    expect(hospedeiro.textContent).toBe("a,c");
  });

  it("salvar com a ordem não confirmada: a lista relida é a do banco", async () => {
    const { ler, hospedeiro } = await montarPainel();
    await leituraDeFundoPendurada(ler);

    // O UPDATE grava; arrumar a página falha. No banco a ordem ficou c, a, b.
    h.gravar.mockResolvedValueOnce({ data: [{ id: "c" }], error: null });
    h.rpc.mockImplementationOnce(async () => {
      h.linhas = [banner("c", 1), banner("a", 2), banner("b", 3)];
      return { data: null, error: { code: "P0001", message: "falhou" } };
    });
    let falha: unknown;
    await act(async () => {
      await ler()
        .updateBanner("c", { order: 1 })
        .catch((erro: unknown) => {
          falha = erro;
        });
    });

    expect((falha as Error | undefined)?.name).toBe("BannerOrdemNaoSalva");
    expect(hospedeiro.textContent).toBe("c,a,b");

    await act(async () => h.soltar?.());
    expect(hospedeiro.textContent).toBe("c,a,b");
  });
});
