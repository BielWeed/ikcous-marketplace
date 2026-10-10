import { Check, Tag, X } from "lucide-react";
import { memo, useState } from "react";

interface CouponInputProps {
  onApply: (code: string) => void;
  onRemove: () => void;
  appliedCoupon?: { code: string; discount: number } | null;
  error?: string;
  /** Uma validação está em voo — o botão trava (toque duplo não valida duas vezes). */
  aplicando?: boolean;
}

// Espaço inseparável: "R$" nunca quebra longe do número.
const formatarReais = (valor: number) =>
  `R$\u00a0${valor.toFixed(2).replace(".", ",")}`;

export const CouponInput = memo(function CouponInput({
  onApply,
  onRemove,
  appliedCoupon,
  error,
  aplicando = false,
}: CouponInputProps) {
  const [code, setCode] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (aplicando) return;
    if (code.trim()) {
      onApply(code.trim().toUpperCase());
    }
  };

  if (appliedCoupon) {
    // Frente B (28/09/2026): cores AA — o "-R$ X aplicado" em green-600 sobre
    // green-50 media 3,15:1; emerald-800 sobre emerald-50 passa de 7:1.
    // Cupom restaurado do rascunho chega com desconto 0 até a revalidação
    // responder — "R$ 0,00 aplicado" era mentira; agora diz que está
    // conferindo.
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600">
            <Check className="size-4 text-white" strokeWidth={3} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-emerald-900">
              {appliedCoupon.code}{" "}
              <span className="font-medium text-emerald-800">aplicado</span>
            </p>
            <p className="text-xs font-semibold text-emerald-800">
              {appliedCoupon.discount > 0
                ? `Você economiza ${formatarReais(appliedCoupon.discount)}`
                : "Conferindo o desconto…"}
            </p>
          </div>
        </div>
        {/* Laudo de acessibilidade 03/09, achado 2: o botão diz o que faz.
            Frente B: o X virou a palavra "Remover" (alvo de 44px). */}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover cupom"
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-emerald-900 underline underline-offset-2 transition-colors hover:bg-emerald-100"
        >
          Remover
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      {/* Frente B: o campo ganhou rótulo de verdade (antes só placeholder). */}
      <label
        htmlFor="coupon-code-input"
        className="block text-xs font-semibold text-zinc-700"
      >
        Tem um código de cupom?
      </label>
      {/* Uma classe de borda/fundo por estado (sem duas brigando na mesma
          string — a ordem do CSS gerado decidia, e o erro não aparecia). */}
      <div
        className={`flex items-center gap-2 rounded-xl border p-1.5 transition-all ${
          error
            ? "border-red-600 bg-red-50"
            : isFocused
              ? "border-zinc-900 bg-white ring-2 ring-black/5"
              : "border-zinc-400 bg-white"
        }`}
      >
        <Tag
          aria-hidden="true"
          className={`ml-2 size-4 shrink-0 ${error ? "text-red-700" : "text-zinc-500"}`}
        />
        <input
          id="coupon-code-input"
          name="couponCode"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Digite o código"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          // Laudo de acessibilidade 03/09, achado 9: com erro, o campo se
          // declara inválido e aponta a mensagem (id abaixo).
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "erro-cupom" : undefined}
          // Laudo 05/09, M3: o override que apagava o anel de foco global
          // morreu — anel só para teclado, padrão do BottomNav.
          className="flex-1 rounded-md bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/50"
        />
        <button
          type="submit"
          disabled={!code.trim() || aplicando}
          className="flex min-h-[44px] items-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-600"
        >
          {aplicando ? "Aplicando…" : "Aplicar"}
        </button>
      </div>
      {error && (
        // Laudo de acessibilidade 03/09, achado 9: a recusa do cupom era
        // silenciosa para leitor de tela — role="alert" fala na hora, o
        // mesmo tratamento da recusa do pedido (SaidaDaRecusa.tsx).
        // Frente B: red-500 media 3,76:1 no branco; red-700 passa de 6:1.
        <p
          id="erro-cupom"
          role="alert"
          className="flex items-center gap-1 text-xs text-red-700"
        >
          <X aria-hidden="true" className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </form>
  );
});
