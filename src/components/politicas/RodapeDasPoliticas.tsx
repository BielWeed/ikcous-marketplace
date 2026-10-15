import {
  TIPOS_DE_POLITICA,
  nomeDaPolitica,
  viewDaPolitica,
} from "@/lib/nomes-das-politicas";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";

/**
 * Os três links no fim da vitrine. Aqui é navegação mesmo (a cliente não
 * está no meio de nada): leva à página, e o voltar do app traz de volta.
 * Arquivo próprio e leve (só botões): a Home não carrega a folha de leitura.
 */
export function RodapeDasPoliticas({
  onNavigate,
}: {
  readonly onNavigate: (view: View) => void;
}) {
  return (
    <nav
      aria-label="Políticas da loja"
      data-testid="rodape-das-politicas"
      className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-x-1 border-t border-border pt-2"
    >
      {TIPOS_DE_POLITICA.map((tipo) => (
        <button
          key={tipo}
          type="button"
          onClick={() => {
            haptic.light();
            onNavigate(viewDaPolitica(tipo));
          }}
          className="flex min-h-11 items-center px-2 text-xs font-semibold text-muted-foreground underline underline-offset-2"
        >
          {nomeDaPolitica(tipo)}
        </button>
      ))}
    </nav>
  );
}
