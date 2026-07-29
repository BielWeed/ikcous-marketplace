import { Tag, X } from "lucide-react";
import { memo, useState } from "react";

interface CouponInputProps {
  onApply: (code: string) => void;
  onRemove: () => void;
  appliedCoupon?: { code: string; discount: number } | null;
  error?: string;
}

export const CouponInput = memo(function CouponInput({
  onApply,
  onRemove,
  appliedCoupon,
  error,
}: CouponInputProps) {
  const [code, setCode] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim()) {
      onApply(code.trim().toUpperCase());
    }
  };

  if (appliedCoupon) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-green-500">
            <Tag className="size-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-800">
              {appliedCoupon.code}
            </p>
            <p className="text-xs text-green-600">
              -R$ {appliedCoupon.discount.toFixed(2).replace(".", ",")} aplicado
            </p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="rounded-lg p-2 text-green-600 transition-colors hover:bg-green-100"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div
        className={`flex items-center gap-2 rounded-xl border bg-gray-50 p-2 transition-all ${
          isFocused ? "border-black ring-2 ring-black/5" : "border-gray-200"
        } ${error ? "border-red-300 bg-red-50" : ""}`}
      >
        <Tag
          className={`ml-2 size-4 ${error ? "text-red-400" : "text-gray-400"}`}
        />
        <input
          id="coupon-code-input"
          name="couponCode"
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
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Aplicar
        </button>
      </div>
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <X className="size-3" />
          {error}
        </p>
      )}
    </form>
  );
});
