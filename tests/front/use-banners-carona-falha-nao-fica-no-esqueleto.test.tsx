// @vitest-environment jsdom
//
// BANNERS: A TELA QUE PEGOU CARONA NUMA CONSULTA QUE FALHOU NÃO FICA NO ESQUELETO.
//
// O DEFEITO: duas telas que montam juntas (a Home e uma seção, por exemplo)
// dividem UMA consulta de banners. A segunda "pega carona" na promessa da
// primeira; se a consulta falha, o ramo da carona engolia o erro SEM ligar o
// `isLoaded` -- e a loja sem banner ficava com o esqueleto para sempre
// (a que fez a consulta liga no `finally`, a carona não tinha esse ramo).
//
// O CONSERTO: o `catch` da carona liga `setIsLoaded(true)` (mesmo desenho do
// `useCategories`). Esta suíte cai se essa linha sair.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: h.consultar }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: vi.fn(async () => {}),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("banners — carona numa consulta que falhou", () => {
  let raiz: Root | null = null;
  let alvo: HTMLDivElement | null = null;
  let useBanners: typeof import("@/hooks/useBanners").useBanners;

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.consultar.mockReset();
    ({ useBanners } = await import("@/hooks/useBanners"));
  });
  afterEach(() => {
    act(() => raiz?.unmount());
    alvo?.remove();
    raiz = null;
    alvo = null;
    vi.restoreAllMocks();
  });

  it("as duas telas saem do esqueleto quando a consulta compartilhada rejeita", async () => {
    // A consulta compartilhada falha (rede caiu): resposta com erro.
    h.consultar.mockResolvedValue({
      data: null,
      error: { message: "rede caiu" },
    });

    const carregado = new Map<string, boolean>();
    function Tela({ nome }: { nome: string }) {
      const { isLoaded } = useBanners(false);
      useEffect(() => {
        carregado.set(nome, isLoaded);
      });
      return null;
    }

    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
    // As duas montam no MESMO lote: a primeira abre a consulta, a segunda
    // encontra a promessa em voo e pega carona.
    await act(async () => {
      raiz?.render(
        <>
          <Tela nome="primeira" />
          <Tela nome="carona" />
        </>,
      );
    });

    expect(carregado.get("primeira")).toBe(true);
    expect(carregado.get("carona")).toBe(true);
  });
});
