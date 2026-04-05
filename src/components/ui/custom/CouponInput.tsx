import { memo, useState } from 'react';
import { Tag, X } from 'lucide-react';

interface CouponInputProps {
  onApply: (code: string) => void;
  onRemove: () => void;
  appliedCoupon?: { code: string; discount: number } | null;
  error?: string;
}

export const CouponInput = memo(function CouponInput({ onApply, onRemove, appliedCoupon, error }: CouponInputProps) {
  const [code, setCode] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim()) {
      onApply(code.trim().toUpperCase());
    }
  };

  if (appliedCoupon) {
    return (
      <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
            <Tag className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-800">{appliedCoupon.code}</p>
            <p className="text-xs text-green-600">
              -R$ {appliedCoupon.discount.toFixed(2).replace('.', ',')} aplicado
            </p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div
        className={`flex items-center gap-2 p-2 bg-gray-50 border rounded-xl transition-all ${isFocused ? 'border-black ring-2 ring-black/5' : 'border-gray-200'
          } ${error ? 'border-red-300 bg-red-50' : ''}`}
      >
        <Tag className={`w-4 h-4 ml-2 ${error ? 'text-red-400' : 'text-gray-400'}`} />
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Cupom de desconto"
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
        <button
          type="submit"
          disabled={!code.trim()}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Aplicar
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <X className="w-3 h-3" />
          {error}
        </p>
      )}
    </form>
  );
});
