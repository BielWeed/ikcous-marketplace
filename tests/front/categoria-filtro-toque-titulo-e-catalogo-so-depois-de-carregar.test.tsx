// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), CategoryFilter. Buracos que os testes vizinhos deixavam passar:
//  - o toque numa categoria dá a vibração leve do app E avisa a tela com o NOME da categoria;
//  - cada chip leva o nome inteiro no `title` (o nome longo é cortado em uma linha no celular);
//  - enquanto a faixa carrega (esqueleto), o catálogo de ícones NÃO é pedido: só depois;
//  - o ícone que a lojista salvou ganha da sugestão pelo nome mesmo que o gancho sugira outro.
//
// Mutantes equivalentes conhecidos desta caça (sem teste possível, anotados aqui):
//  - `if (isLoading || !faixa || !chip)`: no esqueleto a faixa não existe (ref nula), então o
//    `isLoading ||` nunca decide sozinho;
//  - `forma={category.iconeForma ?? sugerido?.forma}`: `sugerido` só existe quando NÃO há
//    `iconeForma`, então a ordem dos dois lados não muda o desenho;
//  - `icone={sugerido?.icone ?? iconeDaCategoria(category)}`: a sugestão "etiqueta" do catálogo
//    sempre vem com a forma, que manda no desenho; a sugestão clássica é a mesma chave que
//    `iconeDaCategoria` devolve pelo mesmo nome.
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import * as ganchoDosIcones from "@/hooks/useIconesPeloNome";
import { esquecerOsIconesPeloNome } from "@/hooks/useIconesPeloNome";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import type { Category } from "@/types";
import { haptic } from "@/utils/haptic";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({ haptic: { light: vi.fn() } }));
// O gancho real segue valendo; só um teste o troca por uma resposta fixa.
vi.mock("@/hooks/useIconesPeloNome", async (importarOriginal) => {
  const real =
    await importarOriginal<typeof import("@/hooks/useIconesPeloNome")>();
  return { ...real, useIconesPeloNome: vi.fn(real.useIconesPeloNome) };
});
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
const espera = () => new Promise<void>((r) => setTimeout(r, 0));

const categoria = (name: string, extra: Partial<Category> = {}): Category => ({
  id: `id-${name}`,
  name,
  slug: name,
  isActive: true,
  createdAt: "",
  ...extra,
});

describe("CategoryFilter: toque, título e catálogo", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  const gancho = vi.mocked(ganchoDosIcones.useIconesPeloNome);
  const ganchoReal = gancho.getMockImplementation();

  beforeEach(() => {
    esquecerOCatalogoCarregado();
    esquecerOsIconesPeloNome();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(haptic.light).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    if (ganchoReal) gancho.mockImplementation(ganchoReal);
    vi.unstubAllGlobals();
  });

  async function montar(
    categories: Category[],
    props: { isLoading?: boolean; onCategoryChange?: (c: string) => void } = {},
  ) {
    await act(async () => {
      raiz.render(
        <CategoryFilter
          categories={categories}
          selectedCategory="Todas"
          onCategoryChange={props.onCategoryChange ?? (() => {})}
          isLoading={props.isLoading}
        />,
      );
    });
    await act(async () => {
      await espera();
    });
  }
  const chip = (nome: string) =>
    host.querySelector<HTMLButtonElement>(
      `button[aria-label="Selecionar categoria ${nome}"]`,
    );

  it("tocar numa categoria vibra uma vez e avisa a tela com o NOME dela", async () => {
    const onCategoryChange = vi.fn();
    await montar([categoria("Bolsas femininas")], { onCategoryChange });
    await act(async () => {
      chip("Bolsas femininas")?.click();
    });
    expect(haptic.light).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledTimes(1);
    expect(onCategoryChange).toHaveBeenCalledWith("Bolsas femininas");

    await act(async () => {
      chip("Todas")?.click();
    });
    expect(haptic.light).toHaveBeenCalledTimes(2);
    expect(onCategoryChange).toHaveBeenLastCalledWith("Todas");
  });

  it("cada chip leva o nome inteiro no title, inclusive o 'Todas'", async () => {
    await montar([categoria("Calçados esportivos para corrida")]);
    expect(chip("Todas")?.getAttribute("title")).toBe("Todas");
    expect(
      chip("Calçados esportivos para corrida")?.getAttribute("title"),
    ).toBe("Calçados esportivos para corrida");
  });

  it("carregando: mostra o esqueleto e NÃO pede o catálogo; pronto: pede uma vez", async () => {
    await montar([categoria("Bolsas")], { isLoading: true });
    expect(
      host.querySelectorAll('[data-testid="categoria-skeleton"]'),
    ).toHaveLength(5);
    expect(fetchMock).not.toHaveBeenCalled();

    await montar([categoria("Bolsas")], { isLoading: false });
    expect(
      host.querySelectorAll('[data-testid="categoria-skeleton"]'),
    ).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("o ícone salvo na categoria ganha da sugestão pelo nome, mesmo que o gancho sugira outro", async () => {
    gancho.mockImplementation(
      () =>
        new Map([
          ["Tênis", { icone: "calcados" as const, forma: null }],
        ]) as ReturnType<typeof ganchoDosIcones.useIconesPeloNome>,
    );
    await montar([categoria("Tênis", { icone: "casa" })]);
    expect(
      chip("Tênis")?.querySelector("svg")?.getAttribute("data-icone"),
    ).toBe("casa");
  });
});
