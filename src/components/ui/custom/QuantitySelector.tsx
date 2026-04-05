import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  quantity: number;
  maxQuantity: number;
  onChange: (quantity: number) => void;
  size?: 'sm' | 'md';
}

export function QuantitySelector({ quantity, maxQuantity, onChange, size = 'md' }: QuantitySelectorProps) {
  const buttonSize = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  const handleDecrease = () => {
    if (quantity > 1) {
      onChange(quantity - 1);
    }
  };

  const handleIncrease = () => {
    if (quantity < maxQuantity) {
      onChange(quantity + 1);
    }
  };

  return (
    <div className="flex items-center bg-zinc-100/50 backdrop-blur-sm p-1 rounded-2xl border border-zinc-200/50">
      <button
        onClick={handleDecrease}
        disabled={quantity <= 1}
        aria-label="Diminuir quantidade"
        type="button"
        title="Diminuir"
        className={`${buttonSize} flex items-center justify-center rounded-xl bg-white shadow-sm border border-zinc-200/50 hover:bg-zinc-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-90`}
      >
        <Minus className={`${iconSize} text-zinc-600`} />
      </button>

      <span className={`${size === 'sm' ? 'w-8' : 'w-12'} text-center font-black text-sm text-zinc-800`}>
        {quantity}
      </span>

      <button
        onClick={handleIncrease}
        disabled={quantity >= maxQuantity}
        aria-label="Aumentar quantidade"
        type="button"
        title="Aumentar"
        className={`${buttonSize} flex items-center justify-center rounded-xl bg-white shadow-sm border border-zinc-200/50 hover:bg-zinc-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-90`}
      >
        <Plus className={`${iconSize} text-zinc-600`} />
      </button>
    </div>
  );
}
