import { IconeDaCategoria, iconeDaCategoria } from "@/lib/icones-de-categoria";
import type { Category } from "@/types";
import { haptic } from "@/utils/haptic";
import { memo } from "react";

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  isLoading?: boolean;
}

// Mesma altura de 80px nos estados vazio, carregando e pronto: o catálogo não salta.
// Com 68px cabem ~5 categorias e meia em 390px; a próxima cortada indica rolagem.
const FAIXA =
  "scrollbar-hide flex w-full min-w-0 gap-0 overflow-x-auto overscroll-x-contain px-1 py-1";

export const CategoryFilter = memo(function CategoryFilter({
  categories,
  selectedCategory,
  onCategoryChange,
  isLoading,
}: CategoryFilterProps) {
  if (isLoading) {
    return (
      <div role="status" className="flex w-full items-center">
        <span className="sr-only">Carregando categorias</span>
        <div className={FAIXA} aria-hidden="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              data-testid="categoria-skeleton"
              className="flex h-[80px] w-[68px] shrink-0 flex-col items-center"
            >
              <div className="size-12 animate-pulse rounded-2xl bg-muted" />
              <div className="mt-1.5 h-4 w-14 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const allCategories = [
    { id: "all", name: "Todas", icone: "todas", iconeForma: null },
    ...categories.filter((c) => c.isActive),
  ];
  return (
    <div className="flex w-full items-center">
      <div className={FAIXA}>
        {allCategories.map((category) => {
          const isActive = selectedCategory === category.name;
          return (
            <button
              type="button"
              key={category.id}
              onClick={() => {
                haptic.light();
                onCategoryChange(category.name);
              }}
              aria-label={`Selecionar categoria ${category.name}`}
              aria-pressed={isActive}
              className="group flex h-[80px] w-[68px] shrink-0 flex-col items-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/50 dark:focus-visible:ring-white/70"
            >
              <span
                className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
                  isActive
                    ? "border-foreground bg-foreground text-card"
                    : "border-border bg-card text-muted-foreground group-hover:border-muted-foreground"
                }`}
              >
                <IconeDaCategoria
                  icone={iconeDaCategoria(category)}
                  forma={category.iconeForma}
                  className="size-6"
                />
              </span>
              <span
                className={`mt-1.5 line-clamp-1 w-full px-0.5 text-xs ${isActive ? "font-extrabold text-foreground" : "font-medium text-muted-foreground"}`}
              >
                {category.name}
              </span>
              <span
                aria-hidden="true"
                className={`mt-1 size-1 rounded-full ${isActive ? "bg-foreground" : "bg-transparent"}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
});
