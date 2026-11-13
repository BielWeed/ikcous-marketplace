// @vitest-environment jsdom
//
// Banner atualizado por Realtime voltava à versão antiga ao sair e voltar do
// painel (menos de 60 s depois da abertura).
//
// O DEFEITO: a atualização recebida (`useSyncListener`) só mudava o ESTADO da
// tela; a cópia compartilhada do módulo (`bannersEmCache`) seguia velha, e é
// dela que a próxima montagem nasce -- com o throttle de 60 s dispensando nova
// consulta. Este teste monta o hook DE VERDADE com o módulo `banners-da-vitrine`
// real: recebe a atualização, desmonta, monta de novo e exige a versão nova
// SEM nova consulta à rede.

const h = vi.hoisted(() => ({
  noBanco: [] as Array<Record<string, unknown>>,
  noCofre: [] as unknown[],
  consultas: 0,
  rede: null as null | Promise<void>,
  sincronizar: undefined as undefined | (() => Promise<void>),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: async () => {
          h.consultas++;
          await h.rede;
          return { data: [...h.noBanco], error: null };
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({
  useSyncListener: (_tabelas: string[], callback: () => Promise<void>) => {
    h.sincronizar = callback;
  },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      getAllOrThrow: async () => h.noCofre,
      replaceAll: async () => {},
      setLastSync: () => {},
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

const linha = (titulo: string) => ({
  id: "b1",
  image_url: "https://exemplo.com/b1.png",
  title: titulo,
  position: "home_top",
  active: true,
  order: 1,
});
const banner = (titulo: string): Banner =>
  ({
    id: "b1",
    imageUrl: "https://exemplo.com/b1.png",
    title: titulo,
    position: "home_top",
    active: true,
    order: 1,
  }) as Banner;

let titulos: string[] = [];

async function montarHome() {
  const { useBanners } = await import("@/hooks/useBanners");
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  function Sonda() {
    const { banners } = useBanners(false);
    useEffect(() => {
      titulos = banners.map((b) => b.title ?? "");
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
  };
}

beforeEach(() => {
  vi.resetModules();
  h.noBanco = [linha("Versão antiga")];
  h.noCofre = [];
  h.consultas = 0;
  h.rede = null;
  h.sincronizar = undefined;
  titulos = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

it("banner atualizado por Realtime não volta à versão antiga na próxima montagem", async () => {
  const desmontarHome = await montarHome();
  expect(titulos).toEqual(["Versão antiga"]);
  const consultasDaAbertura = h.consultas;

  // A lojista renomeia o banner em outro aparelho: o Realtime grava no cofre e
  // avisa a tela.
  h.noCofre = [banner("Versão nova")];
  await act(async () => h.sincronizar?.());
  expect(titulos).toEqual(["Versão nova"]);
  await desmontarHome();

  // A cliente vai ao painel e volta em menos de 60 s.
  const desmontarDeNovo = await montarHome();
  expect(titulos).toEqual(["Versão nova"]);
  expect(h.consultas).toBe(consultasDaAbertura);
  await desmontarDeNovo();
});

it("atualização do cofre não vira cópia compartilhada enquanto a rede não respondeu", async () => {
  // Cofre frio: o que o Realtime gravou lá pode ser UM registro solto, não a
  // lista da loja. Virar cópia compartilhada faria a próxima montagem confiar
  // nele por 60 s, sem consultar a rede.
  let liberarRede: (() => void) | undefined;
  h.rede = new Promise<void>((resolver) => {
    liberarRede = resolver;
  });
  const { bannersEmCache } = await import("@/lib/banners-da-vitrine");
  const desmontarHome = await montarHome();
  h.noCofre = [banner("Registro solto")];
  await act(async () => h.sincronizar?.());
  expect(titulos).toEqual(["Registro solto"]);
  expect(bannersEmCache()).toBeNull();
  liberarRede?.();
  await act(async () => {
    await Promise.resolve();
  });
  expect(bannersEmCache()?.map((b) => b.title)).toEqual(["Versão antiga"]);
  await desmontarHome();
});
