/**
 * "Não foi possível confirmar seu acesso" — a tela de quando o servidor NÃO
 * respondeu se a pessoa é dona do painel. Não acusa ninguém (a permissão não
 * mudou) e oferece saída: tentar de novo ou voltar à loja. Não mostra nenhum
 * dado do painel.
 *
 * Mora aqui, fora do `AdminAreaGate`, porque duas portas precisam dela: o
 * portão do painel (`AdminAreaGate`, a pergunta feita ao abrir o painel) e o
 * portão de fora (`AdminAccessDenied` no `App`, a pergunta que o login faz ao
 * abrir o app). As duas tratam "não respondeu" do mesmo jeito.
 */
export function TelaDeVerificacaoFalhou({
  onTentarDeNovo,
  onVoltar,
}: {
  readonly onTentarDeNovo: () => void;
  readonly onVoltar: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
        <svg
          className="size-8 text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <p className="mt-6 text-[11px] font-black uppercase tracking-[0.2em] text-amber-400">
        Não foi possível confirmar seu acesso
      </p>
      {/* A frase evita acusar: o servidor não respondeu, e isso não diz nada
          sobre a permissão de quem está na tela. */}
      <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-zinc-500">
        O servidor não respondeu a tempo. Isso costuma ser a conexão — sua
        permissão não mudou.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={onTentarDeNovo}
          className="rounded-lg border border-amber-500/30 bg-amber-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-amber-400"
        >
          Tentar de novo
        </button>
        <button
          type="button"
          onClick={onVoltar}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:border-white/20"
        >
          Voltar à loja
        </button>
      </div>
    </div>
  );
}
