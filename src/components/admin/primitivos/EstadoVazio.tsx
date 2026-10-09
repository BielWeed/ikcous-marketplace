import type { LucideIcon } from "lucide-react";

/**
 * Lista sem nada ainda: diz o que é (título), por que está assim e o que fazer
 * (frase) e, se houver um próximo passo, oferece-o num botão de 44px.
 */
export function EstadoVazio({
  icone: Icone,
  titulo,
  frase,
  acao,
}: {
  readonly icone?: LucideIcon;
  readonly titulo: string;
  readonly frase: string;
  readonly acao?: { readonly rotulo: string; readonly aoClicar: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-zinc-900/30 px-6 py-10 text-center">
      {Icone && <Icone aria-hidden="true" className="size-8 text-zinc-400" />}
      <p className="text-base font-bold text-white">{titulo}</p>
      <p className="max-w-sm text-sm text-zinc-400">{frase}</p>
      {acao && (
        <button
          type="button"
          onClick={acao.aoClicar}
          className="mt-2 min-h-11 rounded-xl bg-admin-gold px-5 text-sm font-bold text-black transition-colors hover:bg-admin-gold/90"
        >
          {acao.rotulo}
        </button>
      )}
    </div>
  );
}
