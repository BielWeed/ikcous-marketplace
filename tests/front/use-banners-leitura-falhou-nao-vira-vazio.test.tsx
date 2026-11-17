// @vitest-environment jsdom
//
// LEITURA DOS BANNERS QUE FALHA NÃO PODE PARECER "LOJA SEM BANNER". Antes, a
// consulta que falhava só ia para o console e a leitura era marcada como
// concluída: a tela do painel mostrava "Nenhum Banner encontrado" e sugeria
// criar o primeiro, e a lojista criava duplicados achando que estava vazio. O
// hook agora diz que a leitura falhou (`erroDeLeitura`) e o desfaz quando uma
// nova leitura funciona.
import type { Banner } from "@/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emCache: null as Banner[] | null,
  emVoo: null as Promise<Banner[]> | null,
  pedir: vi.fn(),
}));
vi.mock("@/lib/banners-da-vitrine", () => ({
  acompanharBannersDoRealtime: vi.fn(),
  bannersEmCache: () => h.emCache,
  // "Agora": o efeito do hook não repete a consulta por throttle depois da
  // falha, e a releitura do teste é só a que o teste pede.
  horaDaUltimaConsultaDeBanners: () => Date.now(),
  consultaDeBannersEmVoo: () => h.emVoo,
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
    }),
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
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
let releitura: () => Promise<void> = async () => {};

beforeEach(() => {
  h.emCache = null;
  h.emVoo = null;
  h.pedir.mockReset();
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
    const { banners, isLoaded, erroDeLeitura, refreshBanners } =
      useBanners(true);
    useEffect(() => {
      releitura = () => refreshBanners(false, true);
    }, [refreshBanners]);
    return (
      <p>
        {`lidos=${banners.length};concluida=${isLoaded};erro=${erroDeLeitura}`}
      </p>
    );
  }
  await act(async () => raiz.render(<Sonda />));
}

it("consulta que falha, sem banner no aparelho: a leitura diz que falhou", async () => {
  h.pedir.mockRejectedValue(new Error("rede caiu"));
  await montar();
  expect(alvo.textContent).toBe("lidos=0;concluida=true;erro=true");
});

it("nova leitura que funciona desfaz o erro e traz os banners", async () => {
  h.pedir.mockRejectedValueOnce(new Error("rede caiu"));
  h.pedir.mockResolvedValueOnce([banner]);
  await montar();
  expect(alvo.textContent).toContain("erro=true");
  await act(async () => releitura());
  expect(alvo.textContent).toBe("lidos=1;concluida=true;erro=false");
});

it("consulta que funciona e vem vazia NÃO é erro", async () => {
  h.pedir.mockResolvedValue([]);
  await montar();
  expect(alvo.textContent).toBe("lidos=0;concluida=true;erro=false");
});

it("falha com banners já no aparelho: a lista continua e o erro fica registrado", async () => {
  h.emCache = [banner];
  h.pedir.mockRejectedValue(new Error("rede caiu"));
  await montar();
  expect(alvo.textContent).toBe("lidos=1;concluida=true;erro=true");
});

it("carona numa consulta em voo que falha também conta como erro", async () => {
  h.emVoo = Promise.reject(new Error("rede caiu"));
  h.emVoo.catch(() => {});
  await montar();
  expect(alvo.textContent).toBe("lidos=0;concluida=true;erro=true");
});
