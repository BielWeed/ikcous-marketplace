import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTelaLarga } from "@/hooks/useFinanceiro";
import { cn } from "@/lib/utils";

/**
 * A folha de todo formulário do Financeiro: sobe de baixo no celular (o
 * polegar alcança; NN/g, bottom sheet) e abre pela direita no computador.
 * Corpo rola sozinho; o rodapé com a ação principal fica sempre à vista,
 * acima da área segura do aparelho.
 *
 * Quem fecha é SEMPRE `aoFechar` (X, véu, Esc e o Voltar do celular, que a
 * view liga por `onSetBackOverride`) — a folha não guarda estado próprio.
 */
export function FolhaFinanceira({
  titulo,
  descricao,
  aoFechar,
  children,
  rodape,
}: {
  readonly titulo: string;
  readonly descricao?: ReactNode;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  readonly rodape?: ReactNode;
}) {
  const larga = useTelaLarga();
  return (
    <Sheet
      open
      onOpenChange={(aberta) => {
        if (!aberta) aoFechar();
      }}
    >
      <SheetContent
        side={larga ? "right" : "bottom"}
        className={cn(
          "gap-0 border-white/10 bg-zinc-950 p-0 text-white",
          larga ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl",
        )}
      >
        <SheetHeader className="border-b border-white/5 px-5 pb-4 pt-5 text-left">
          {larga ? null : (
            <span
              aria-hidden="true"
              className="mx-auto -mt-2 mb-2 h-1 w-10 rounded-full bg-white/15"
            />
          )}
          <SheetTitle className="pr-8 text-lg font-black tracking-tight text-white">
            {titulo}
          </SheetTitle>
          {descricao ? (
            <SheetDescription className="text-xs text-zinc-500">
              {descricao}
            </SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{titulo}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {rodape ? (
          <SheetFooter className="mt-0 border-t border-white/5 px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
            {rodape}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
