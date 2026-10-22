// @vitest-environment jsdom
//
// Vitrine: o ícone da categoria é o que a lojista SALVOU; sem escolha, o do catálogo que combina com o NOME;
// sem nome reconhecido (ou sem catálogo), o de sempre. O catálogo só é pedido quando alguma categoria precisa.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import type { Category } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({ haptic: { light: vi.fn() } }));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const categoria = (name: string, extra: Partial<Category> = {}): Category => ({
  id: name,
  name,
  slug: name,
  isActive: true,
  createdAt: "",
  ...extra,
});

describe("CategoryFilter: ícone pelo nome", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    esquecerOCatalogoCarregado();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function montar(categories: Category[]) {
    await act(async () => {
      raiz.render(
        <CategoryFilter
          categories={categories}
          selectedCategory="Todas"
          onCategoryChange={() => {}}
        />,
      );
    });
    await act(async () => {
      await espera();
    });
  }
  const caminhoDe = (nome: string) =>
    host
      .querySelector(`button[aria-label="Selecionar categoria ${nome}"] path`)
      ?.getAttribute("d");

  it("sem ícone salvo, usa o do catálogo que combina com o nome (Bolsas femininas -> Bolsa)", async () => {
    await montar([categoria("Bolsas femininas"), categoria("Tênis")]);
    expect(caminhoDe("Bolsas femininas")).toBe(d("bolsa"));
    expect(caminhoDe("Tênis")).toBe(d("tenis"));
  });

  it("o ícone salvo na categoria ganha do nome: forma e chave", async () => {
    await montar([
      categoria("Bolsas femininas", { iconeForma: d("bota") }),
      categoria("Tênis", { icone: "casa" }),
    ]);
    expect(caminhoDe("Bolsas femininas")).toBe(d("bota"));
    expect(
      host
        .querySelector('button[aria-label="Selecionar categoria Tênis"] svg')
        ?.getAttribute("data-icone"),
    ).toBe("casa");
  });

  it("só pede o catálogo se alguma categoria precisa dele", async () => {
    await montar([categoria("Bolsas", { iconeForma: d("bolsa") })]);
    expect(fetchMock).not.toHaveBeenCalled();
    await montar([categoria("Bolsas")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("catálogo que não chega: fica com o ícone de sempre, sem quebrar a vitrine", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await montar([categoria("Calçados"), categoria("Xpto")]);
    expect(
      host
        .querySelector('button[aria-label="Selecionar categoria Calçados"] svg')
        ?.getAttribute("data-icone"),
    ).toBe("calcados");
    expect(
      host
        .querySelector('button[aria-label="Selecionar categoria Xpto"] svg')
        ?.getAttribute("data-icone"),
    ).toBe("etiqueta");
  });

  it("nome que o catálogo não conhece mantém a etiqueta genérica", async () => {
    await montar([categoria("Xpto")]);
    expect(
      host
        .querySelector('button[aria-label="Selecionar categoria Xpto"] svg')
        ?.getAttribute("data-icone"),
    ).toBe("etiqueta");
  });
});
