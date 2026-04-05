import { Scale, X } from 'lucide-react';
import type { View } from '@/types';

interface ProductCompareBadgeProps {
  count: number;
  onNavigate: (view: View) => void;
  onClear: () => void;
}

export function ProductCompareBadge({ count, onNavigate, onClear }: ProductCompareBadgeProps) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-40 animate-slide-up">
      <div className="bg-black text-white p-4 rounded-xl shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <p className="font-medium">{count} produto{count > 1 ? 's' : ''} para comparar</p>
            <p className="text-xs text-white/70">Veja as diferenças lado a lado</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('compare')}
            className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
          >
            Comparar
          </button>
          <button
            onClick={onClear}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
