import { formatCurrency } from "@/lib/utils";
import { Check, Tag, X } from "lucide-react";
import { memo, useState } from "react";

interface CouponInputProps {
  onApply: (code: string) => void;
  onRemove: () => void;
  appliedCoupon?: { code: string; discount: number } | null;
  error?: string;
  /** Uma validação está em voo — o botão trava (toque duplo não valida duas vezes). */
  aplicando?: boolean;
  /** O pedido está saindo: aplicar e remover ficam apagados (diferente de
   *  `aplicando`, não escreve "Aplicando…"). */
  travado?: boolean;
  /** O número grande do cupom aplicado ("10%", "R$ 15"), quando a lista o conhece. */
  destaque?: string;
}

export const CouponInput = memo(function CouponInput({
  onApply,
  onRemove,
  appliedCoupon,
  error,
  aplicando = false,
  travado = false,
  destaque,
}: CouponInputProps) {
  const [code, setCode] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (aplicando || travado) return;
    if (code.trim()) {
      onApply(code.trim().toUpperCase());
    }
  };

  if (appliedCoupon) {
    // Frente B (28/09/2026): cores AA — o verde do desconto é emerald-700
    // sobre branco (5,2:1). Cupom restaurado do rascunho chega com desconto 0
    // até a revalidação responder — "R$ 0,00 aplicado" era mentira; agora diz
    // que está conferindo.
    // PASSO A3 (22/10/2026): o cupom aplicado é o cartão SELECIONADO — borda
    // forte + bolinha escura com check, no mesmo desenho dos cartões da lista.
    return (
      <div
        data-testid="cupom-aplicado"
        className="flex items-center gap-3 rounded-2xl border-2 border-zinc-900 bg-white p-3"
      >
        <span
          aria-hidden="true"
          className="flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-zinc-100 p-2 text-center text-zinc-900"
        >
          {destaque ? (
            <>
              <span className="text-base font-black leading-none tracking-tight">
                {destaque}
              </span>
              <span className="mt-1 text-[11px] font-bold uppercase tracking-widest text-zinc-600">
                OFF
              </span>
            </>
          ) : (
            <Tag className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-bold text-zinc-900">
            {appliedCoupon.code}{" "}
            <span className="font-medium text-emerald-700">aplicado</span>
          </p>
          <p className="text-xs font-semibold text-emerald-700">
            {appliedCoupon.discount > 0
              ? `Você economiza ${formatCurrency(appliedCoupon.discount)}`
              : "Conferindo o desconto…"}
          </p>
          {/* Laudo de acessibilidade 03/09, achado 2: o botão diz o que faz.
              Frente B: o X virou a palavra "Remover" (alvo de 44px). */}
          <button
            type="button"
            onClick={onRemove}
            disabled={travado}
            aria-label="Remover cupom"
            className="-ml-2 min-h-11 rounded-lg px-2 text-sm font-semibold text-zinc-700 underline underline-offset-2 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remover
          </button>
        </div>
        <span
          data-testid="selo-de-escolhida"
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      {/* Frente B: o campo ganhou rótulo de verdade (antes só placeholder). */}
      <label htmlFor="coupon-code-input" className="sr-only">
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
          className="min-w-0 flex-1 rounded-md bg-transparent text-base outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/50 md:text-sm"
        />
        <button
          type="submit"
          disabled={!code.trim() || aplicando || travado}
          className="flex min-h-[44px] min-w-[70px] shrink-0 items-center justify-center rounded-lg bg-zinc-900 p-2 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-600"
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
