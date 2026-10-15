import { ChevronRight } from "lucide-react";

import { ConteudoDaPolitica } from "@/components/politicas/ConteudoDaPolitica";
import { useStore } from "@/contexts/StoreContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import {
  TIPOS_DE_POLITICA,
  type TipoDePolitica,
  nomeDaPolitica,
  viewDaPolitica,
} from "@/lib/textos-das-politicas";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";

interface PoliticaDaLojaViewProps {
  readonly tipo: TipoDePolitica;
  readonly onNavigate: (view: View) => void;
}

/**
 * Página de LEITURA de uma das três políticas da loja (Termos de uso,
 * Privacidade, Trocas e devoluções). O texto vem de
 * `src/lib/textos-das-politicas.ts` — a mesma fonte da folha que abre no
 * checkout, no produto e no cadastro. A seta de voltar é a do cabeçalho do
 * app (`showBackButton` do App cobre toda tela fora das abas).
 */
export function PoliticaDaLojaView({
  tipo,
  onNavigate,
}: PoliticaDaLojaViewProps) {
  const { config } = useStore();
  const nome = nomeDaLoja(config);

  useDocumentMeta({ title: `${nomeDaPolitica(tipo)} | ${nome}` });

  const outras = TIPOS_DE_POLITICA.filter((t) => t !== tipo);

  return (
    <div className="pb-customer min-h-full bg-background">
      <div className="mx-auto max-w-md space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-black tracking-tight text-foreground">
          {nomeDaPolitica(tipo)}
        </h1>

        <ConteudoDaPolitica tipo={tipo} />

        <nav aria-label="Outras páginas da loja" className="space-y-1">
          {outras.map((outra) => (
            <button
              key={outra}
              type="button"
              onClick={() => {
                haptic.light();
                onNavigate(viewDaPolitica(outra));
              }}
              className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-border px-4 text-left text-sm font-semibold text-foreground"
            >
              {nomeDaPolitica(outra)}
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
