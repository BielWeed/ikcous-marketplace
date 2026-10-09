import {
  NOMES_DO_PAINEL,
  PAR_PERGUNTAS_E_AVALIACOES,
  type TelaDoPainel,
} from "@/config/nomes-do-painel";
import { cn } from "@/lib/utils";

/**
 * Alterna entre telas irmãs que dividem uma porta só — hoje, Perguntas |
 * Avaliações (spec painel-simples §3). Vai no topo das duas telas. Os nomes
 * vêm de NOMES_DO_PAINEL; a tela atual leva `aria-current="page"` (a cor
 * sozinha não é a pista) e clicar nela não navega.
 */
export function AlternadorDeTelas({
  atual,
  onNavigate,
  telas = PAR_PERGUNTAS_E_AVALIACOES,
}: {
  readonly atual: TelaDoPainel;
  readonly onNavigate: (view: TelaDoPainel) => void;
  readonly telas?: readonly TelaDoPainel[];
}) {
  return (
    <nav
      aria-label="Telas desta seção"
      className="flex gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1"
    >
      {telas.map((tela) => {
        const ativa = tela === atual;
        // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada do usuário
        const nome = NOMES_DO_PAINEL[tela];
        return (
          <button
            key={tela}
            type="button"
            aria-current={ativa ? "page" : undefined}
            onClick={() => {
              if (!ativa) onNavigate(tela);
            }}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold",
              ativa
                ? "bg-admin-gold text-black"
                : "text-zinc-300 hover:bg-white/[0.07]",
            )}
          >
            {nome}
          </button>
        );
      })}
    </nav>
  );
}
