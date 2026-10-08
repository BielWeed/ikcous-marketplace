import type { ReactNode } from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { X } from "lucide-react";

/**
 * A folha das Vitrines: sobe de baixo (o polegar alcança), corpo que rola
 * sozinho e rodapé com a ação principal sempre à vista. No computador ela
 * continua embaixo, mas limitada a uma largura de leitura e centralizada.
 *
 * Quem fecha é SEMPRE `aoFechar` (X, véu e Esc) — a folha não guarda estado.
 *
 * Ao abrir, o foco vai para a própria folha e NÃO para o primeiro campo: o
 * campo de nome sozinho no foco levantava o teclado do celular por cima da
 * lista de produtos, e ainda gravava (blur do campo) a cada abrir/fechar.
 */
export function FolhaInferior({
  titulo,
  descricao,
  aoFechar,
  children,
  rodape,
}: {
  readonly titulo: string;
  readonly descricao: ReactNode;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  readonly rodape: ReactNode;
}) {
  return (
    <Sheet
      open
      onOpenChange={(aberta) => {
        if (!aberta) aoFechar();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onOpenAutoFocus={(evento) => {
          evento.preventDefault();
          (evento.currentTarget as HTMLElement | null)?.focus();
        }}
        className="mx-auto max-h-[92dvh] w-full gap-0 rounded-t-[28px] border-white/10 bg-zinc-950 p-0 text-white sm:max-w-xl"
      >
        <SheetHeader className="px-5 pb-1 pt-3 text-left">
          <span
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-lg font-extrabold tracking-tight text-white">
                {titulo}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-xs text-zinc-400">
                {descricao}
              </SheetDescription>
            </div>
            <SheetClose
              aria-label="Fechar"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 transition-colors hover:text-white"
            >
              <X className="size-4" />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {children}
        </div>
        <SheetFooter className="mt-0 flex-row items-center gap-2.5 border-t border-white/5 px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
          {rodape}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
