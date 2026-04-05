// import { Slider } from '@/components/ui/slider'; // Removed unused
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
// import { X } from 'lucide-react'; // Removed unused
import { Badge } from '@/components/ui/badge';

interface ProductFiltersProps {
    categories: string[];
    selectedCategory: string;
    onSelectCategory: (category: string) => void;
    minPrice: number | '';
    maxPrice: number | '';
    onMinPriceChange: (value: number | '') => void;
    onMaxPriceChange: (value: number | '') => void;
    sort: string;
    onSortChange: (value: string) => void;
    onClearFilters: () => void;
    className?: string;
}

export function ProductFilters({
    categories,
    selectedCategory,
    onSelectCategory,
    minPrice,
    maxPrice,
    onMinPriceChange,
    onMaxPriceChange,
    sort,
    onSortChange,
    onClearFilters,
    className = ''
}: ProductFiltersProps) {
    return (
        <div className={`space-y-6 ${className}`}>
            {/* Header with Clear */}
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Filtros</h3>
                {(selectedCategory !== 'Todas' || minPrice !== '' || maxPrice !== '') && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="h-auto p-0 text-red-500 hover:text-red-600 hover:bg-transparent text-xs"
                    >
                        Limpar tudo
                    </Button>
                )}
            </div>

            {/* Categories */}
            <div className="space-y-3">
                <Label>Categorias</Label>
                <div className="flex flex-wrap gap-2">
                    {categories.map((cat) => (
                        <Badge
                            key={cat}
                            variant={selectedCategory === cat ? 'default' : 'outline'}
                            className="cursor-pointer px-3 py-1.5"
                            onClick={() => onSelectCategory(cat)}
                        >
                            {cat}
                        </Badge>
                    ))}
                </div>
            </div>

            {/* Price Range */}
            <div className="space-y-3">
                <Label>Faixa de Preço</Label>
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">R$</span>
                        <input
                            type="number"
                            placeholder="Min"
                            value={minPrice}
                            onChange={(e) => onMinPriceChange(e.target.value ? Number(e.target.value) : '')}
                            className="w-full pl-7 pr-2 py-2 text-sm border rounded-lg bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        />
                    </div>
                    <span className="text-gray-400">-</span>
                    <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">R$</span>
                        <input
                            type="number"
                            placeholder="Max"
                            value={maxPrice}
                            onChange={(e) => onMaxPriceChange(e.target.value ? Number(e.target.value) : '')}
                            className="w-full pl-7 pr-2 py-2 text-sm border rounded-lg bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Sorting */}
            <div className="space-y-3">
                <Label>Ordenar por</Label>
                <Select value={sort} onValueChange={onSortChange}>
                    <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="newest">Mais Recentes</SelectItem>
                        <SelectItem value="price_asc">Menor Preço</SelectItem>
                        <SelectItem value="price_desc">Maior Preço</SelectItem>
                        <SelectItem value="name_asc">Nome (A-Z)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
