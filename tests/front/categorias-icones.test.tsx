// @vitest-environment jsdom
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import type { Category } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({ haptic: { light: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

function categoria(
  name: string,
  icone?: string | null,
  isActive = true,
): Category {
  return { id: name, name, slug: name, isActive, createdAt: "", icone };
}
function renderizar(categories: Category[], isLoading = false) {
  const mudar = vi.fn();
  act(() =>
    root.render(
      <CategoryFilter
        categories={categories}
        selectedCategory="Brinquedo"
        onCategoryChange={mudar}
        isLoading={isLoading}
      />,
    ),
  );
  return mudar;
}

it("mostra Todas primeiro, só categorias ativas e ícone explícito antes da dedução", () => {
  const mudar = renderizar([
    categoria("Brinquedo", "casa"),
    categoria("Oculta", null, false),
  ]);
  const botoes = [...host.querySelectorAll("button")];
  expect(botoes.map((b) => b.textContent)).toEqual(["Todas", "Brinquedo"]);
  expect(botoes[0].getAttribute("aria-pressed")).toBe("false");
  expect(botoes[1].getAttribute("aria-pressed")).toBe("true");
  expect(botoes[0].querySelector("svg")?.getAttribute("data-icone")).toBe(
    "todas",
  );
  expect(botoes[1].querySelector("svg")?.getAttribute("data-icone")).toBe(
    "casa",
  );
  expect(botoes[1].className).toContain("focus-visible:ring-2");
  const blocoAtivo = botoes[1].querySelector("span")!;
  const blocoInativo = botoes[0].querySelector("span")!;
  // Par neutro e inverso também no glass, onde --background é transparente.
  expect(blocoAtivo.className).toContain("bg-foreground text-card");
  expect(blocoAtivo.className).not.toMatch(/zinc-|text-white|primary/);
  expect(blocoInativo.className).toContain(
    "group-hover:border-muted-foreground",
  );
  act(() => botoes[0].click());
  expect(mudar).toHaveBeenCalledWith("Todas");
});

it.each([
  ["Auto cuidado", "cuidado"],
  ["Beleza e perfumes", "beleza"],
  ["Cosméticos", "beleza"],
  ["Brinquedos e jogos", "brinquedo"],
  ["Calçados", "calcados"],
  ["Tênis", "calcados"],
  ["Vestuário", "moda"],
  ["Decoração da cozinha", "casa"],
  ["Eletrônicos", "tecnologia"],
  ["Esportes", "esporte"],
  ["Pet", "pet"],
  ["Alimentos", "alimento"],
  ["Papelaria", "papelaria"],
  ["Ferramentas", "ferramentas"],
  ["Jóias", "joias"],
  ["Novidades", "etiqueta"],
])("deduz %s sem acento e usa fallback neutro", (nome, chave) => {
  renderizar([categoria(nome)]);
  expect(host.querySelectorAll("svg")[1]?.getAttribute("data-icone")).toBe(
    chave,
  );
});

it("chave desconhecida ou herdada do protótipo não vira path nem sobrepõe a dedução", () => {
  renderizar([categoria("Brinquedo", "toString")]);
  expect(host.querySelectorAll("svg")[1]?.getAttribute("data-icone")).toBe(
    "brinquedo",
  );
});

it("reserva a mesma altura dos blocos e anuncia carregamento", () => {
  renderizar([], true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "Carregando categorias",
  );
  expect(
    host.querySelectorAll('[data-testid="categoria-skeleton"]'),
  ).toHaveLength(5);
  expect(
    host.querySelector('[data-testid="categoria-skeleton"]')?.className,
  ).toContain("h-[108px]");
  expect(host.querySelector("button")).toBeNull();
});
