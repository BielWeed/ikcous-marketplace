// @vitest-environment jsdom
//
// Prova do hook REAL de banners (painel): cada campo que a lojista preenche
// chega à COLUNA certa do banco, na criação e na edição, e a linha que o banco
// devolve volta para a tela nos campos certos. Os testes vizinhos só olham as
// datas, o ativo, o produto e a foto do computador; trocar entre si os campos
// de cor, de texto ou de filtro (título <-> subtítulo, fundo <-> texto do
// botão...) passava em todos. Também prova que gravação com ZERO linhas
// afetadas (política de acesso barrando, banner já excluído) não vira sucesso.
import { normalizeBannersOrder, useBanners } from "@/hooks/useBanners";
import type { Banner } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  consultarOrdem: vi.fn(),
  inserir: vi.fn(),
  atualizar: vi.fn(),
  normalizar: vi.fn(),
  excluir: vi.fn(),
  rpc: vi.fn(),
  remover: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  isAdmin: true,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ order: h.consultar }),
        eq: () => ({ order: () => ({ order: h.consultarOrdem }) }),
      }),
      insert: (linhas: unknown) => ({
        select: () => ({ single: () => h.inserir(linhas) }),
      }),
      update: (valores: unknown) => ({
        eq: (_coluna: string, id: string) => ({
          // `await ...eq()` direto é a arrumação das posições; `.select()` é a
          // gravação da edição.
          // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
          then: (
            resolver: (v: unknown) => unknown,
            rejeitar: (e: unknown) => unknown,
          ) =>
            Promise.resolve(h.normalizar(valores, id)).then(resolver, rejeitar),
          select: () => h.atualizar(valores, id),
        }),
      }),
      delete: () => ({
        eq: (_coluna: string, id: string) => ({
          select: () => h.excluir(id),
        }),
      }),
    }),
    rpc: h.rpc,
    storage: { from: () => ({ remove: h.remover }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin }),
}));
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
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Um valor DIFERENTE por campo: se dois campos forem trocados, aparece.
const COMPLETO = {
  imageUrl: "https://exemplo.invalid/celular.png",
  desktopImageUrl: "https://exemplo.invalid/computador.png",
  title: "Titulo A",
  link: "/ofertas",
  position: "home_middle" as const,
  active: false,
  order: 4,
  subtitle: "Subtitulo B",
  titleColor: "#111111",
  subtitleColor: "#222222",
  buttonText: "Texto do botao C",
  buttonBgColor: "#333333",
  buttonTextColor: "#444444",
  fontFamily: "Fonte D",
  overlayColor: "#555555",
  overlayOpacity: 55,
  badgeText: "Selo E",
  templateType: "modelo-f",
  productId: "produto-g",
  startDate: "2026-12-01T03:00:00.000Z",
  endDate: "2026-12-31T23:59:59.000Z",
  showTextOverlay: false,
} satisfies Omit<Banner, "id">;

// O mesmo conteúdo, nas colunas do banco.
const COLUNAS = {
  image_url: COMPLETO.imageUrl,
  desktop_image_url: COMPLETO.desktopImageUrl,
  title: COMPLETO.title,
  link: COMPLETO.link,
  position: COMPLETO.position,
  active: COMPLETO.active,
  order: COMPLETO.order,
  subtitle: COMPLETO.subtitle,
  title_color: COMPLETO.titleColor,
  subtitle_color: COMPLETO.subtitleColor,
  button_text: COMPLETO.buttonText,
  button_bg_color: COMPLETO.buttonBgColor,
  button_text_color: COMPLETO.buttonTextColor,
  font_family: COMPLETO.fontFamily,
  overlay_color: COMPLETO.overlayColor,
  overlay_opacity: COMPLETO.overlayOpacity,
  badge_text: COMPLETO.badgeText,
  template_type: COMPLETO.templateType,
  product_id: COMPLETO.productId,
  start_date: COMPLETO.startDate,
  end_date: COMPLETO.endDate,
  show_text_overlay: COMPLETO.showTextOverlay,
};

describe("useBanners (real): cada campo vai para a coluna certa", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let hook!: () => ReturnType<typeof useBanners>;

  async function montar(linhasDoBanco: Record<string, unknown>[] = []) {
    h.consultar.mockReset().mockResolvedValue({
      data: linhasDoBanco,
      error: null,
    });
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
    await act(async () => atual.refreshBanners(false, true));
    hook = () => atual;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    h.isAdmin = true;
    h.consultarOrdem.mockReset().mockResolvedValue({ data: [], error: null });
    h.normalizar.mockReset().mockResolvedValue({ error: null });
    h.inserir.mockReset().mockImplementation(async (linhas: unknown[]) => ({
      data: { id: "novo", ...(linhas[0] as Record<string, unknown>) },
      error: null,
    }));
    h.atualizar
      .mockReset()
      .mockResolvedValue({ data: [{ id: "banner-1" }], error: null });
    h.excluir
      .mockReset()
      .mockResolvedValue({ data: [{ id: "banner-1" }], error: null });
    h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    h.remover.mockReset().mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    alvo.remove();
    vi.restoreAllMocks();
  });

  const existente = (extra: Record<string, unknown> = {}) => ({
    id: "banner-1",
    image_url: "https://exemplo.invalid/antiga.png",
    title: "Antigo",
    position: "home_top",
    active: true,
    order: 1,
    ...extra,
  });

  it("criar: o corpo do INSERT leva cada campo na sua coluna", async () => {
    await montar();
    await act(async () => {
      await hook().addBanner(COMPLETO);
    });

    expect(h.inserir).toHaveBeenCalledTimes(1);
    const corpo = (
      h.inserir.mock.calls[0]?.[0] as Record<string, unknown>[]
    )[0];
    expect(corpo).toEqual(COLUNAS);
  });

  it("criar: a linha devolvida pelo banco volta para a tela nos campos certos", async () => {
    await montar();
    await act(async () => {
      await hook().addBanner(COMPLETO);
    });

    const criado = hook().banners.find((b) => b.id === "novo");
    expect(criado).toBeDefined();
    // a ordem é renumerada pela posição (único do setor = 1); o resto é fiel
    expect({ ...criado, order: COMPLETO.order }).toEqual({
      id: "novo",
      ...COMPLETO,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Banner adicionado com sucesso!",
    );
  });

  it("criar: opacidade que o banco devolve como texto vira número; coluna vazia vira o padrão", async () => {
    await montar();
    h.inserir.mockResolvedValueOnce({
      data: {
        id: "novo",
        image_url: "https://exemplo.invalid/x.png",
        position: "home_top",
        overlay_opacity: "35",
        active: null,
        title: null,
        link: null,
        template_type: null,
        product_id: null,
        show_text_overlay: null,
        desktop_image_url: null,
        start_date: null,
        end_date: null,
      },
      error: null,
    });
    await act(async () => {
      await hook().addBanner({
        imageUrl: "https://exemplo.invalid/x.png",
        title: "",
        position: "home_top",
        active: true,
        order: 1,
      });
    });

    const criado = hook().banners.find((b) => b.id === "novo");
    expect(criado).toMatchObject({
      overlayOpacity: 35,
      active: true,
      title: "",
      templateType: "default",
      showTextOverlay: true,
      desktopImageUrl: null,
      startDate: null,
      endDate: null,
    });
    expect(criado?.link).toBeUndefined();
    expect(criado?.productId).toBeUndefined();
  });

  it("criar: opacidade nula no banco fica SEM valor (não vira zero)", async () => {
    await montar();
    h.inserir.mockResolvedValueOnce({
      data: {
        id: "novo",
        image_url: "https://exemplo.invalid/x.png",
        position: "home_top",
        overlay_opacity: null,
      },
      error: null,
    });
    await act(async () => {
      await hook().addBanner({
        imageUrl: "https://exemplo.invalid/x.png",
        title: "",
        position: "home_top",
        active: true,
        order: 1,
      });
    });
    expect(
      hook().banners.find((b) => b.id === "novo")?.overlayOpacity,
    ).toBeUndefined();
  });

  it("editar: cada campo mexido vai para a sua coluna (a ordem e a posição vão na edição de ordem)", async () => {
    await montar([existente()]);
    const { order, position, ...semOrdem } = COMPLETO;

    await act(async () => {
      await hook().updateBanner("banner-1", semOrdem);
    });
    const { order: _o, position: _p, ...colunasSemOrdem } = COLUNAS;
    expect(h.atualizar).toHaveBeenCalledTimes(1);
    expect(h.atualizar.mock.calls[0]).toEqual([colunasSemOrdem, "banner-1"]);

    h.atualizar.mockClear();
    await act(async () => {
      await hook().updateBanner("banner-1", { order, position });
    });
    expect(h.atualizar.mock.calls[0]).toEqual([
      { order: COLUNAS.order, position: COLUNAS.position },
      "banner-1",
    ]);
  });

  it("editar: só o que foi citado viaja, e vazio vira nulo nas colunas opcionais", async () => {
    await montar([existente()]);
    await act(async () => {
      await hook().updateBanner("banner-1", { title: "So o titulo" });
    });
    expect(h.atualizar.mock.calls[0]).toEqual([
      { title: "So o titulo" },
      "banner-1",
    ]);

    h.atualizar.mockClear();
    await act(async () => {
      await hook().updateBanner("banner-1", {
        productId: "",
        desktopImageUrl: "",
        startDate: "",
        endDate: "",
      });
    });
    expect(h.atualizar.mock.calls[0]).toEqual([
      {
        product_id: null,
        desktop_image_url: null,
        start_date: null,
        end_date: null,
      },
      "banner-1",
    ]);
  });

  it("editar: o banco responde sucesso com ZERO linhas (política barrou ou o banner sumiu): avisa, não diz 'atualizado' e a tela volta", async () => {
    await montar([existente()]);
    h.atualizar.mockResolvedValueOnce({ data: [], error: null });

    await act(async () => {
      await expect(
        hook().updateBanner("banner-1", { title: "Novo titulo" }),
      ).rejects.toThrow("Nenhum banner foi alterado.");
    });

    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(
      "Este banner foi excluído em outro aparelho ou você não tem mais acesso a ele.",
    );
  });

  it("excluir: o banco responde sucesso com ZERO linhas: lança, não diz 'excluído' e a lista fica como estava", async () => {
    await montar([existente()]);
    h.excluir.mockResolvedValueOnce({ data: [], error: null });

    await act(async () => {
      await expect(hook().deleteBanner("banner-1")).rejects.toThrow(
        "Nenhum banner foi apagado.",
      );
    });

    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith("Erro ao excluir banner.");
    expect(hook().banners.map((b) => b.id)).toEqual(["banner-1"]);
  });

  it("excluir: a foto de verdade sai do armazenamento; a imagem 'placeholder' e a foto que outro banner ainda usa ficam", async () => {
    const BASE = "https://exemplo.invalid/storage/v1/object/public/banners/";
    await montar([
      existente({ id: "banner-1", image_url: `${BASE}foto-propria.png` }),
      existente({ id: "banner-2", image_url: `${BASE}placeholder.png` }),
      existente({ id: "banner-3", image_url: `${BASE}foto-dividida.png` }),
      existente({ id: "banner-4", image_url: `${BASE}foto-dividida.png` }),
    ]);

    h.excluir.mockResolvedValue({ data: [{ id: "x" }], error: null });
    await act(async () => {
      await hook().deleteBanner("banner-1");
    });
    expect(h.remover).toHaveBeenCalledExactlyOnceWith(["foto-propria.png"]);

    h.remover.mockClear();
    await act(async () => {
      await hook().deleteBanner("banner-2");
    });
    expect(h.remover).not.toHaveBeenCalled();

    await act(async () => {
      await hook().deleteBanner("banner-3");
    });
    expect(h.remover).not.toHaveBeenCalled();

    // o último que usava a foto dividida leva a foto junto
    await act(async () => {
      await hook().deleteBanner("banner-4");
    });
    expect(h.remover).toHaveBeenCalledExactlyOnceWith(["foto-dividida.png"]);
  });

  it("arrumar as posições: só regrava a linha que MUDOU de lugar (lista já certa não grava nada)", async () => {
    await montar();
    h.consultarOrdem.mockResolvedValueOnce({
      data: [
        { id: "a", order: 1 },
        { id: "b", order: 2 },
        { id: "c", order: 2 },
        { id: "d", order: 9 },
      ],
      error: null,
    });
    await act(async () => normalizeBannersOrder("home_top"));
    // empate b/c desempata pelo id; d (9) vira 4; a e b já estão certos
    expect(h.normalizar.mock.calls).toEqual([
      [{ order: 3 }, "c"],
      [{ order: 4 }, "d"],
    ]);

    h.normalizar.mockClear();
    h.consultarOrdem.mockResolvedValueOnce({
      data: [
        { id: "a", order: 1 },
        { id: "b", order: 2 },
      ],
      error: null,
    });
    await act(async () => normalizeBannersOrder("home_top"));
    expect(h.normalizar).not.toHaveBeenCalled();
  });

  it("arrumar as posições: o banner que a lojista acabou de salvar fica ANTES do empate, a menos que tenha DESCIDO", async () => {
    await montar();
    const empate = () => ({
      data: [
        { id: "a", order: 2 },
        { id: "z", order: 2 },
      ],
      error: null,
    });

    // subiu/foi criado: "a" entra ANTES do empate e fica em 1; "z" já está em 2
    h.consultarOrdem.mockResolvedValueOnce(empate());
    await act(async () => normalizeBannersOrder("home_top", "a"));
    expect(h.normalizar.mock.calls).toEqual([[{ order: 1 }, "a"]]);

    h.normalizar.mockClear();
    h.consultarOrdem.mockResolvedValueOnce(empate());
    await act(async () => normalizeBannersOrder("home_top", "a", true));
    // desceu: "a" entra DEPOIS do empate, então "z" sobe para 1 e "a" fica em 2
    expect(h.normalizar.mock.calls).toEqual([[{ order: 1 }, "z"]]);
  });

  it("excluir: confirmado pelo banco, sai da lista e avisa", async () => {
    await montar([existente()]);
    await act(async () => {
      await hook().deleteBanner("banner-1");
    });
    expect(hook().banners).toEqual([]);
    expect(h.excluir).toHaveBeenCalledWith("banner-1");
    expect(h.toastSuccess).toHaveBeenCalledWith("Banner excluído com sucesso!");
  });
});
