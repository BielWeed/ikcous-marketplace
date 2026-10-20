import { Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { SeloFinanceiro } from "./partes";

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
  icone = Pencil,
  matiz,
}: {
  readonly titulo: string;
  readonly descricao?: ReactNode;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  readonly rodape?: ReactNode;
  readonly icone?: LucideIcon;
  readonly matiz?: string;
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
          "gap-0 border-white/10 bg-[#08080A] p-0 text-white [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:bg-[#17171C] [&>button]:text-zinc-300",
          larga ? "w-full sm:max-w-md" : "max-h-[94dvh] rounded-t-3xl",
        )}
      >
        <SheetHeader className="px-5 pb-7 pt-5 text-left">
          {larga ? null : (
            <span
              aria-hidden="true"
              className="mx-auto -mt-2 mb-2 h-1 w-10 rounded-full bg-white/15"
            />
          )}
          <SheetTitle className="flex items-start gap-3 break-words pr-10 text-2xl font-bold leading-tight tracking-tight text-white">
            <SeloFinanceiro icone={icone} matiz={matiz} />
            <span className="min-w-0 self-center break-words">{titulo}</span>
          </SheetTitle>
          {descricao ? (
            <SheetDescription className="mt-2 text-sm leading-relaxed text-zinc-400">
              {descricao}
            </SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{titulo}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-7">
          {children}
        </div>
        {rodape ? (
          <SheetFooter className="mt-0 border-t border-white/5 bg-[#17171C] px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
            {rodape}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
