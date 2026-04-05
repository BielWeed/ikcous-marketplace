import type { Category } from '@/types';
import { haptic } from '@/utils/haptic';

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  isLoading?: boolean;
}

export function CategoryFilter({ categories, selectedCategory, onCategoryChange, isLoading }: CategoryFilterProps) {
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
        {allCategories.map((category) => (
          <button
            key={category.id}
            onClick={() => {
              haptic.light();
              onCategoryChange(category.name);
            }}
            aria-label={`Selecionar categoria ${category.name}`}
            aria-pressed={selectedCategory === category.name}
            className={`flex-shrink-0 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 ${selectedCategory === category.name
              ? 'bg-zinc-900 text-white shadow-lg shadow-zinc-200 scale-105'
              : 'bg-white text-zinc-500 border border-zinc-100 hover:bg-zinc-50 hover:text-zinc-900'
              }`}
          >
            {category.name}
          </button>
        ))}
      </div>
    </div>
  );
}
