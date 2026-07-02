import { memo } from 'react';
import { motion } from 'framer-motion';
import type { Category } from '@/types';
import { haptic } from '@/utils/haptic';

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  isLoading?: boolean;
}

export const CategoryFilter = memo(function CategoryFilter({ categories, selectedCategory, onCategoryChange, isLoading }: CategoryFilterProps) {
  // "Todas" is a virtual category, so we handle it separately in the UI
  const allCategories = [
    { id: 'all', name: 'Todas' },
    ...categories.filter(c => c.isActive)
  ];

  if (isLoading) {
    return (
      <div className="sticky top-[72px] z-40 bg-white border-b border-gray-100">
        <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 bg-gray-100 rounded-full animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center w-full">
      <div className="flex gap-2 px-1 overflow-x-auto scrollbar-hide w-full py-0.5">
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
              className="relative flex-shrink-0 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors duration-300 outline-none"
            >
              {isActive && (
                <motion.div
                  layoutId="activeCategoryPill"
                  className="absolute inset-0 bg-zinc-900 rounded-full shadow-lg shadow-zinc-300/40 z-0"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span
                className={`relative z-10 transition-colors duration-300 ${
                  isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-900'
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
