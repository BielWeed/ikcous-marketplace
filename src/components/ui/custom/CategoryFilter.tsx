import type { Category } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import { memo, useMemo } from "react";

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  isLoading?: boolean;
}

export const CategoryFilter = memo(function CategoryFilter({
  categories,
  selectedCategory,
  onCategoryChange,
  isLoading,
}: CategoryFilterProps) {
  // "Todas" is a virtual category, so we handle it separately in the UI
  const allCategories = useMemo(
    () => [
      { id: "all", name: "Todas" },
      ...categories.filter((c) => c.isActive),
    ],
    [categories],
  );

  if (isLoading) {
    return (
      <div className="sticky top-[72px] z-40 border-b border-gray-100 bg-white">
        <div className="scrollbar-hide flex gap-2 overflow-x-auto px-4 py-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-9 w-24 flex-shrink-0 animate-pulse rounded-full bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center">
      <div className="scrollbar-hide flex w-full gap-2 overflow-x-auto px-1 py-0.5">
        {allCategories.map((category) => {
          const isActive = selectedCategory === category.name;
          return (
            <button
              key={category.id}
              onClick={() => {
                haptic.light();
                onCategoryChange(category.name);
              }}
              aria-label={`Selecionar categoria ${category.name}`}
              aria-pressed={isActive}
              className="relative flex-shrink-0 rounded-full px-5 py-2 text-[10px] font-black uppercase tracking-widest outline-none transition-all duration-150 active:scale-95"
            >
              {isActive && (
                <motion.div
                  layoutId="activeCategoryPill"
                  className="absolute inset-0 z-0 rounded-full bg-zinc-900 shadow-lg shadow-zinc-300/40"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span
                className={`relative z-10 transition-colors duration-300 ${
                  isActive ? "text-white" : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {category.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
