// @vitest-environment jsdom
//
// Lista de "Gerenciar categorias": o ícone da linha segue a regra da vitrine, nesta ordem:
// o que a lojista SALVOU, depois o do catálogo que combina com o NOME, depois o genérico.
//
// Sem `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, categoriasMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  categoriasMock: {
    atual: [] as {
      id: string;
      name: string;
      icone?: string | null;
      iconeForma?: string | null;
    }[],
  },
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryActive: vi.fn(),
    updateCategory: vi.fn(),
    categories: categoriasMock.atual,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import { esquecerOsIconesPeloNome } from "@/hooks/useIconesPeloNome";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";

const CATALOGO: { chave: string; d: string }[] = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório
  readFileSync(
    join(__dirname, "..", "..", "public", "icons", "categorias.json"),
    "utf8",
  ),
);
const d = (chave: string) => CATALOGO.find((i) => i.chave === chave)?.d;
const fetchMock = vi.fn();
const espera = () => new Promise<void>((r) => setTimeout(r, 0));

const uso = (id: string, nome: string) => ({
  id,
  nome,
  slug: id,
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
});

describe("Gerenciar categorias: ícone da linha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    esquecerOCatalogoCarregado();
    esquecerOsIconesPeloNome();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO });
    vi.stubGlobal("fetch", fetchMock);
    categoriasMock.atual = [
      { id: "c-sem", name: "Bolsas femininas", icone: null, iconeForma: null },
      { id: "c-chave", name: "Bolsas de couro", icone: "casa" },
      { id: "c-forma", name: "Bolsas de festa", iconeForma: d("bota") },
      { id: "c-nada", name: "Xpto", icone: null, iconeForma: null },
    ];
    rpcMock.mockResolvedValue({
      data: [
        uso("c-sem", "Bolsas femininas"),
        uso("c-chave", "Bolsas de couro"),
        uso("c-forma", "Bolsas de festa"),
        uso("c-nada", "Xpto"),
      ],
      error: null,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function abrir() {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
    });
    await act(async () => {
      await espera();
    });
    await act(async () => {
      await espera();
    });
  }

  // O ícone da própria linha é o 1º svg dela (o seletor, fechado, não desenha ícone antes).
  function iconeDaLinha(nome: string) {
    const li = [...document.querySelectorAll("li")].find((x) =>
      x.querySelector("span")?.textContent?.includes(nome),
    ) as HTMLElement;
    const svg = li.querySelector("svg[data-icone]") as SVGElement;
    return {
      icone: svg.getAttribute("data-icone"),
      d: svg.querySelector("path")?.getAttribute("d"),
    };
  }

  it("sem ícone salvo, a linha mostra o do catálogo que combina com o nome", async () => {
    await abrir();
    expect(iconeDaLinha("Bolsas femininas")).toEqual({
      icone: "forma",
      d: d("bolsa"),
    });
  });

  it("com ícone salvo (chave ou forma), o salvo ganha do nome", async () => {
    await abrir();
    expect(iconeDaLinha("Bolsas de couro").icone).toBe("casa");
    expect(iconeDaLinha("Bolsas de festa")).toEqual({
      icone: "forma",
      d: d("bota"),
    });
  });

  it("sem salvo e sem nome reconhecido, fica o genérico", async () => {
    await abrir();
    expect(iconeDaLinha("Xpto").icone).toBe("etiqueta");
  });
});
