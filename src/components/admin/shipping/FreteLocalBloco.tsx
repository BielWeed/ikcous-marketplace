import { Minus, Plus } from "lucide-react";
import { memo } from "react";

/**
 * Bloco "Frete local" da tela de Frete v2 — entrega na cidade da loja, feita
 * pela própria loja (motoboy / entrega própria). O que existe hoje nessa
 * área (`localDeliveryFee`, `localCepRange`) continua funcionando IGUAL:
 * aqui só muda a casca (frente frete-v2-0309 — mando do dono: casca nova,
 * regra intacta).
 *
 * Semântica que vem da edge function (`calculate-shipping`), e que o bloco
 * repete sem inventar: CEP do cliente dentro da faixa → opção "Entrega
 * Local" custa `localDeliveryFee` (R$ 0 = entrega de graça na cidade).
 * Faixa vazia = a cidade inteira, pelo CEP da loja como origem.
 */
export const FreteLocalBloco = memo(function FreteLocalBloco({
  valor,
  onValor,
  faixa,
  onFaixa,
  cidade,
  uf,
  desabilitado,
}: {
  readonly valor: number;
  readonly onValor: (valor: number) => void;
  readonly faixa: string;
  readonly onFaixa: (faixa: string) => void;
  readonly cidade?: string | null;
  readonly uf?: string | null;
  readonly desabilitado?: boolean;
}) {
  const onde =
    cidade && uf ? `${cidade}/${uf}` : cidade ? cidade : "sua cidade";

  return (
    <section
      id="bloco-frete-local"
      aria-label="Frete local"
      className="relative scroll-mt-24 overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/40 p-5 shadow-xl backdrop-blur-md sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
            {/* Motoboy: a entrega local é a da própria loja. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <circle cx="5.5" cy="17.5" r="3.5" />
              <circle cx="18.5" cy="17.5" r="3.5" />
              <path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white">Frete local</h2>
            <p className="mt-0.5 max-w-[26ch] text-[11px] leading-snug text-zinc-400 sm:max-w-none">
              Entrega em {onde}, feita por você — motoboy ou combinação
              direta com o cliente.
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-black ${
            valor > 0
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {valor > 0 ? `R$ ${valor}` : "Grátis"}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <span className="block text-xs font-bold text-zinc-200">
            Quanto custa a entrega na cidade
          </span>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/60 p-2">
            <button
              type="button"
              aria-label="Diminuir o valor da entrega local"
              disabled={valor <= 0 || desabilitado}
              onClick={() => onValor(Math.max(0, valor - 1))}
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-800 text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white active:scale-95 disabled:opacity-30"
            >
              <Minus className="size-4" />
            </button>
            <div className="flex flex-1 items-baseline justify-center gap-1">
              <span className="text-xs font-black text-amber-400">R$</span>
              <input
                id="local-delivery-fee"
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                value={valor === 0 ? "" : valor}
                onChange={(e) =>
                  onValor(e.target.value === "" ? 0 : Number(e.target.value))
                }
                className="w-20 border-0 bg-transparent text-center text-2xl font-black text-white placeholder-zinc-600 focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0"
                disabled={desabilitado}
              />
            </div>
            <button
              type="button"
              aria-label="Aumentar o valor da entrega local"
              disabled={desabilitado}
              onClick={() => onValor(valor + 1)}
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-800 text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white active:scale-95 disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[0, 5, 10, 15, 20].map((sugestao) => (
              <button
                key={sugestao}
                type="button"
                disabled={desabilitado}
                onClick={() => onValor(sugestao)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-all ${
                  valor === sugestao
                    ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                    : "border-white/10 bg-zinc-800/60 text-zinc-400 hover:border-white/20 hover:text-white"
                }`}
              >
                {sugestao === 0 ? "Grátis" : `R$ ${sugestao}`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="local-cep-range"
            className="block text-xs font-bold text-zinc-200"
          >
            Até onde vai a entrega local
            <span className="ml-1.5 font-medium text-zinc-500">
              faixa de CEPs (opcional)
            </span>
          </label>
          <input
            id="local-cep-range"
            type="text"
            value={faixa}
            onChange={(e) => onFaixa(e.target.value)}
            placeholder="Ex: 38500-000, 38500-999"
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/60 px-4 font-mono text-xs text-white placeholder-zinc-600 transition-all focus:border-amber-500 focus:outline-none"
            disabled={desabilitado}
          />
          <p className="text-[10.5px] leading-snug text-zinc-500">
            Vazio = a cidade inteira, pelo CEP da loja como origem. CEP fora
            da faixa não recebe a entrega local — ele vê o frete nacional.
          </p>
        </div>
      </div>
    </section>
  );
});
