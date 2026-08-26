// @vitest-environment jsdom
//
// Banner criado no painel sumia da Home por até 1 minuto — e banner
// excluído ressuscitava nela pelo mesmo intervalo.
//
// O DEFEITO (lote do dorso, achado 9): as mutações de useBanners
// (addBanner/updateBanner/reorderBanners/deleteBanner) atualizavam o estado
// do componente e o vault, mas NUNCA o `globalBannersCache` de módulo — e é
// dele que a próxima montagem do hook nasce (`useState(globalBannersCache)`),
// com o throttle de 60s (`FETCH_THROTTLE`) confiando que ele reflete a
// última verdade. A Home que abrisse na janela viaja no passado.
//
// A correção centraliza mutação local em `applyLocalBanners`, que grava
// cache + relógio + vault + estado juntos. Este teste monta o hook DE
// VERDADE duas vezes com o cliente Supabase dublê (mesmo precedente de
// use-reviews-cliente-ve-resposta-da-loja.test.tsx) e prova a troca de tela:
// o banner criado está na segunda montagem SEM nova consulta à rede; o
// excluído não volta. Com `applyLocalBanners` removido de volta (só
// setBanners/persistToVault), este teste CAI.

const LINHA_INSERIDA = {
  id: "banner-novo",
  image_url: "https://exemplo.com/banner-novo.png",
  title: "Queima de estoque",
  link: null,
  position: "home_top",
  active: true,
  order: 1,
};

// Trilha de métodos de cada consulta — para o teste distinguir a consulta de
// rede da mutação, e provar que a segunda montagem NÃO consultou nada.
const trilhas: string[][] = [];
const consultasDeRede = () =>
  trilhas.filter((t) => t.join("|").startsWith("select*")).length;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const trilha: string[] = [];
      trilhas.push(trilha);
      // Cadeias de verdade terminando em Promise real (sem objeto thenable
      // artesanal — o Biome reprova propriedade `then` em objeto de teste):
      //   fetch:      select("*").order(...)                  → await direto
      //   normalize:  select("id, order").eq().order().order() → await direto
      //   insert:     insert().select().single()               → await direto
      //   delete:     delete().eq()                            → await direto
      return {
        select: (colunas?: string) => {
          // Só o select("*") de fetchBanners é a "consulta de rede" que o
          // teste conta; normalizeBannersOrder usa select("id, order").
          trilha.push(colunas === "*" ? "select*" : "select-parcial");
          return {
            order: () => Promise.resolve({ data: [], error: null }),
            eq: () => ({
              order: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        },
        insert: () => {
          trilha.push("insert");
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: LINHA_INSERIDA, error: null }),
            }),
          };
        },
        delete: () => {
          trilha.push("delete");
          return { eq: () => Promise.resolve({ error: null }) };
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/hooks/useDataVault", () => ({
  useSyncListener: () => {},
}));

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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBanners } from "@/hooks/useBanners";
import type { Banner } from "@/types";

type AddBanner = (banner: Omit<Banner, "id">) => Promise<unknown>;
type DeleteBanner = (id: string, imageUrl?: string) => Promise<void>;

/** Monta o hook, espera a carga inicial assentar e devolve os métodos que a
 * tela do painel usa, junto com um leitor do estado `banners`. */
async function montarPainel(): Promise<{
  addBanner: AddBanner;
  deleteBanner: DeleteBanner;
  lerBanners: () => Banner[];
  desmontar: () => Promise<void>;
}> {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const capturas: { add?: AddBanner; del?: DeleteBanner; lista?: Banner[] } =
    {};

  function Sonda() {
    const { banners, addBanner, deleteBanner } = useBanners(true);
    useEffect(() => {
      capturas.add = addBanner as unknown as AddBanner;
      capturas.del = deleteBanner as unknown as DeleteBanner;
      capturas.lista = banners;
    });
    return null;
  }

  await act(async () => {
    raiz.render(<Sonda />);
  });
  // Deixa a carga inicial (vault + rede dublê) assentar antes de ler.
  await act(async () => {
    await Promise.resolve();
  });

  return {
    get addBanner() {
      const fn = capturas.add;
      if (!fn) throw new Error("sonda não capturou addBanner");
      return fn;
    },
    get deleteBanner() {
      const fn = capturas.del;
      if (!fn) throw new Error("sonda não capturou deleteBanner");
      return fn;
    },
    lerBanners: () => {
      const lista = capturas.lista;
      if (!lista) throw new Error("sonda não recebeu banners");
      return lista;
    },
    desmontar: async () => {
      await act(async () => {
        raiz.unmount();
      });
      hospedeiro.remove();
    },
  };
}

describe("useBanners — mutação do painel aparece na próxima montagem (a Home)", () => {
  beforeEach(() => {
    trilhas.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("banner criado está na Home nova SEM nova consulta; banner excluído não ressuscita", async () => {
    // 1. O PAINEL abre (carga inicial: uma consulta à rede) e cria um banner.
    const painel = await montarPainel();
    expect(consultasDeRede()).toBeGreaterThanOrEqual(1);
    const redeAntesDeCriar = consultasDeRede();

    await act(async () => {
      await painel.addBanner({
        imageUrl: "https://exemplo.com/banner-novo.png",
        title: "Queima de estoque",
        position: "home_top",
        active: true,
        order: 1,
      } as Omit<Banner, "id">);
    });
    expect(painel.lerBanners().map((b) => b.id)).toContain("banner-novo");
    await painel.desmontar();

    // 2. A HOME abre na mesma janela de 60s do throttle: o banner novo tem
    // de já estar lá — vindo do cache de módulo, sem nova consulta à rede.
    const home = await montarPainel();
    expect(home.lerBanners().map((b) => b.id)).toContain("banner-novo");
    expect(consultasDeRede()).toBe(redeAntesDeCriar);

    // 3. Volta ao painel e EXCLUI o banner; a Home que abrir em seguida não
    // pode vê-lo de volta (o espelho do mesmo defeito).
    await home.desmontar();
    const painel2 = await montarPainel();
    await act(async () => {
      await painel2.deleteBanner("banner-novo");
    });
    expect(painel2.lerBanners().map((b) => b.id)).not.toContain("banner-novo");
    await painel2.desmontar();

    const homeFinal = await montarPainel();
    expect(homeFinal.lerBanners().map((b) => b.id)).not.toContain(
      "banner-novo",
    );
    await homeFinal.desmontar();
  });
});
