// @vitest-environment jsdom
//
// Rede "pendurada" conecta e não responde. Sem prazo, adicionar, editar,
// reordenar e excluir banner ficavam esperando para sempre: o editor seguia em
// "Salvando…" e, na lista, todos os botões ficavam apagados. Com o prazo, a
// espera da tela termina e a lojista é avisada em português simples de que NÃO
// se sabe se gravou (o servidor pode ter gravado depois) — nunca "erro" nem
// "não foi salvo" —, com a ordem de conferir a lista. Nada do que é ENVIADO
// muda: aqui o dublê só confere o que chegou.
import { useBanners } from "@/hooks/useBanners";
import { ehConsultaSemResposta } from "@/lib/prazo-da-requisicao";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
  consultar: vi.fn(),
  inserir: vi.fn(),
  atualizar: vi.fn(),
  apagar: vi.fn(),
  rpc: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
      delete: () => ({
        eq: (_coluna: string, id: string) => ({
          select: () => h.apagar(id),
        }),
      }),
    }),
    rpc: h.rpc,
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
    success: h.toastSuccess,
    error: h.toastError,
    warning: h.toastWarning,
    info: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_ESTOURADO_MS = 25_000;
const pendurada = () => new Promise<never>(() => {});

const linha = (id: string, order: number) => ({
  id,
  image_url: "https://exemplo.com/banner.png",
  title: `Banner ${id}`,
  position: "home_top",
  active: true,
  order,
});

const novoBanner = {
  imageUrl: "https://exemplo.com/novo.png",
  title: "Novo",
  position: "home_top" as const,
  active: true,
  order: 3,
};

describe("banners: gravação que nunca responde", () => {
  const raizes: Root[] = [];
  const alvos: HTMLDivElement[] = [];
  let hook!: () => ReturnType<typeof useBanners>;

  async function montar() {
    let atual!: ReturnType<typeof useBanners>;
    function Sonda() {
      const valor = useBanners(true);
      useEffect(() => {
        atual = valor;
      });
      return null;
    }
    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    const raiz = createRoot(alvo);
    raizes.push(raiz);
    alvos.push(alvo);
    await act(async () => raiz.render(<Sonda />));
    hook = () => atual;
  }

  // Dispara a operação, deixa o prazo estourar e devolve como ela terminou.
  async function esperarOPrazo<T>(operacao: () => Promise<T>) {
    let resultado: { rejeitou: boolean; erro?: unknown; valor?: T } | undefined;
    await act(async () => {
      operacao().then(
        (valor) => {
          resultado = { rejeitou: false, valor };
        },
        (erro) => {
          resultado = { rejeitou: true, erro };
        },
      );
      await vi.advanceTimersByTimeAsync(PRAZO_ESTOURADO_MS);
    });
    return resultado;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.linhas = [linha("a", 1), linha("b", 2)];
    h.consultar.mockReset().mockImplementation(async () => ({
      data: h.linhas,
      error: null,
    }));
    h.inserir.mockReset().mockImplementation(pendurada);
    h.atualizar.mockReset().mockImplementation(pendurada);
    h.apagar.mockReset().mockImplementation(pendurada);
    h.rpc.mockReset().mockImplementation(pendurada);
    h.toastWarning.mockReset();
    h.toastError.mockReset();
    h.toastSuccess.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await montar();
    await act(async () => hook().refreshBanners(false, true));
    h.consultar.mockClear();
  });

  afterEach(async () => {
    for (const raiz of raizes.splice(0)) {
      await act(async () => raiz.unmount());
    }
    for (const alvo of alvos.splice(0)) alvo.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function confereAvisoDeQueNaoSeSabe() {
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastWarning).toHaveBeenCalledTimes(1);
    const texto = String(h.toastWarning.mock.calls[0][0]);
    expect(texto).toContain("Sem resposta da rede");
    expect(texto).toContain("Não sabemos se");
    expect(texto).toContain("lista de banners");
    // Nunca afirma que falhou: o servidor pode ter gravado.
    expect(texto).not.toMatch(/não foi salv|erro/i);
  }

  it("adicionar: solta a tela com aviso de que não se sabe se salvou", async () => {
    const r = await esperarOPrazo(() => hook().addBanner(novoBanner));

    expect(r?.rejeitou).toBe(true);
    expect(ehConsultaSemResposta(r?.erro)).toBe(true);
    confereAvisoDeQueNaoSeSabe();
  });

  it("editar: solta a tela, devolve a lista e relê o que o servidor tem", async () => {
    const r = await esperarOPrazo(() =>
      hook().updateBanner("a", { title: "Mudei" }),
    );

    expect(r?.rejeitou).toBe(true);
    expect(ehConsultaSemResposta(r?.erro)).toBe(true);
    confereAvisoDeQueNaoSeSabe();
    // O retrato otimista não fica: o título volta ao que havia antes...
    expect(hook().banners.find((b) => b.id === "a")?.title).toBe("Banner a");
    // ...e a lista é relida, para refletir o que o servidor de fato guardou.
    expect(h.consultar).toHaveBeenCalled();
  });

  it("reordenar: solta a tela, devolve a ordem e relê o que o servidor tem", async () => {
    const r = await esperarOPrazo(() => hook().reorderBanners("a", "b"));

    expect(r?.rejeitou).toBe(false);
    confereAvisoDeQueNaoSeSabe();
    expect(
      hook()
        .banners.map((b) => `${b.id}:${b.order}`)
        .join(","),
    ).toBe("a:1,b:2");
    expect(h.consultar).toHaveBeenCalled();
  });

  it("excluir: solta a tela e relê a lista", async () => {
    const r = await esperarOPrazo(() => hook().deleteBanner("a"));

    expect(r?.rejeitou).toBe(true);
    expect(ehConsultaSemResposta(r?.erro)).toBe(true);
    confereAvisoDeQueNaoSeSabe();
    // Não some da tela sozinho: a lojista confere pela lista relida.
    expect(hook().banners.some((b) => b.id === "a")).toBe(true);
    expect(h.consultar).toHaveBeenCalled();
  });

  it("o que é enviado não muda: o mesmo insert, update, rpc e delete de sempre", async () => {
    await esperarOPrazo(() => hook().addBanner(novoBanner));
    await esperarOPrazo(() => hook().updateBanner("a", { active: false }));
    await esperarOPrazo(() => hook().reorderBanners("a", "b"));
    await esperarOPrazo(() => hook().deleteBanner("b"));

    expect(h.inserir.mock.calls[0][0]).toMatchObject([
      { title: "Novo", position: "home_top", order: 3, product_id: null },
    ]);
    expect(h.atualizar).toHaveBeenCalledWith({ active: false }, "a");
    expect(h.rpc).toHaveBeenCalledWith("reorder_banners_atomic", {
      p_position: "home_top",
      p_banner_id_1: "a",
      p_banner_id_2: "b",
    });
    expect(h.apagar).toHaveBeenCalledWith("b");
  });

  it("resposta que chega dentro do prazo segue como sempre (sem aviso de espera)", async () => {
    h.atualizar
      .mockReset()
      .mockResolvedValue({ data: [{ id: "a" }], error: null });
    await act(async () => {
      await hook().updateBanner("a", { title: "Mudei" });
    });

    expect(h.toastWarning).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Banner atualizado com sucesso!",
    );
  });
});
