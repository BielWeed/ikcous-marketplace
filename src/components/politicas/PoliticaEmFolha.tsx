import { X } from "lucide-react";

import { ConteudoDaPolitica } from "@/components/politicas/ConteudoDaPolitica";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import { type TipoDePolitica, nomeDaPolitica } from "@/lib/nomes-das-politicas";
import { cn } from "@/lib/utils";

interface PoliticaEmFolhaProps {
  /** Qual política está aberta; `null` = folha fechada. */
  readonly tipo: TipoDePolitica | null;
  readonly onFechar: () => void;
}

/**
 * A política lida POR CIMA da tela em que a cliente está — no checkout, no
 * produto e no cadastro. É folha, não navegação, de propósito: sair do
 * checkout apaga nome, endereço e a compra em andamento, e sair do cadastro
 * apaga o que ela já digitou. Aqui a tela de baixo continua montada, com
 * tudo intacto; fechar a folha devolve a cliente exatamente onde estava.
 *
 * O conteúdo só monta com a folha aberta, então a política de trocas só é
 * lida do banco quando alguém de fato a abre.
 */
export function PoliticaEmFolha({ tipo, onFechar }: PoliticaEmFolhaProps) {
  // O Voltar do aparelho fecha SÓ a folha (a tela de baixo não se mexe).
  useVoltarFechaAFolha(tipo !== null, onFechar);

  return (
    <Sheet
      open={tipo !== null}
      onOpenChange={(aberta) => !aberta && onFechar()}
    >
      <SheetContent
        side="bottom"
        data-testid="folha-politica"
        // Botão de fechar PRÓPRIO (em português, com alvo de 44px): o X
        // embutido do Sheet anuncia "Close" ao leitor de tela.
        showCloseButton={false}
        className={cn(
          "mx-auto flex max-h-[92dvh] flex-col gap-0 rounded-t-3xl bg-card p-0 text-card-foreground",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border",
          "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=open]:slide-in-from-left-1/2",
        )}
      >
        <SheetHeader className="relative shrink-0 border-b border-border px-5 pb-3 pr-14 pt-5">
          <SheetClose
            aria-label="Fechar"
            className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full text-muted-foreground"
          >
            <X className="size-5" aria-hidden="true" />
          </SheetClose>
          <SheetTitle className="text-lg font-black tracking-tight">
            {tipo ? nomeDaPolitica(tipo) : ""}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Texto da página {tipo ? nomeDaPolitica(tipo) : ""} da loja. Feche
            para voltar de onde você estava.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {tipo && <ConteudoDaPolitica tipo={tipo} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
