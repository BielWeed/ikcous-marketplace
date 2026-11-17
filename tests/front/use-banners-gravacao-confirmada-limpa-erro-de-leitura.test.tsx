// @vitest-environment jsdom
//
// A ÚLTIMA LEITURA FALHOU E A LOJISTA EXCLUI O ÚLTIMO BANNER. A leitura da rede
// falhou, mas o aparelho tinha banners (`erroDeLeitura` = true). Ela exclui o
// único banner e a exclusão FUNCIONA: a lista local fica vazia e confirmada, e
// a tela tem de dizer "Nenhum Banner" -- não "Não foi possível carregar os
// banners", que sugere falha onde a lojista acabou de ver a gravação dar certo.
// Gravação que FALHA e volta atrás não confirma nada: o erro de leitura fica.
import type { Banner } from "@/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emCache: null as Banner[] | null,
  pedir: vi.fn(),
  gravacao: { data: null as unknown, error: null as unknown },
}));
vi.mock("@/lib/banners-da-vitrine", () => ({
  acompanharBannersDoRealtime: vi.fn(),
  bannersEmCache: () => h.emCache,
  horaDaUltimaConsultaDeBanners: () => Date.now(),
  consultaDeBannersEmVoo: () => null,
  geracaoDasMutacoesDeBanners: () => 0,
  gravarBannersLocais: vi.fn(),
  pedirBanners: h.pedir,
  semearBannersDoCofre: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: vi.fn() }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      getAllOrThrow: async () => [],
      replaceAll: async () => {},
      setLastSync: async () => {},
    }),
  },
}));
// Só a gravação interessa: `.eq().select()` devolve a resposta do teste. A
// arrumação de ordem em segundo plano tropeça no dublê e é engolida pelo hook.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({ eq: () => ({ select: async () => h.gravacao }) }),
      update: () => ({ eq: () => ({ select: async () => h.gravacao }) }),
    }),
    storage: { from: () => ({ remove: async () => ({}) }) },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
import { useBanners } from "@/hooks/useBanners";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const banner: Banner = {
  id: "campanha",
  title: "Campanha",
  imageUrl: "/banner.jpg",
  active: true,
  order: 1,
  position: "home_top",
};

const alvo = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;
let excluir: () => Promise<void> = async () => {};
let editar: () => Promise<void> = async () => {};

beforeEach(() => {
  h.emCache = [banner];
  h.pedir.mockReset();
  h.pedir.mockRejectedValue(new Error("rede caiu"));
  h.gravacao = { data: null, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.restoreAllMocks();
});

async function montar() {
  function Sonda() {
    const { banners, isLoaded, erroDeLeitura, deleteBanner, updateBanner } =
      useBanners(true);
    useEffect(() => {
      excluir = () => deleteBanner("campanha");
      editar = () => updateBanner("campanha", { title: "Outro" });
    });
    return (
      <p>
        {`lidos=${banners.length};concluida=${isLoaded};erro=${erroDeLeitura}`}
      </p>
    );
  }
  await act(async () => raiz.render(<Sonda />));
}

it("exclusão confirmada do último banner depois de leitura falha: lista vazia SEM erro", async () => {
  await montar();
  expect(alvo.textContent).toBe("lidos=1;concluida=true;erro=true");
  h.gravacao = { data: [{ id: "campanha" }], error: null };
  await act(async () => excluir());
  expect(alvo.textContent).toBe("lidos=0;concluida=true;erro=false");
});

it("edição que falha e volta atrás NÃO apaga o erro de leitura", async () => {
  await montar();
  h.gravacao = { data: null, error: new Error("sem permissão") };
  await act(async () => {
    await editar().catch(() => {});
  });
  expect(alvo.textContent).toBe("lidos=1;concluida=true;erro=true");
});
