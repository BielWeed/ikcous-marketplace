import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { HelpCircle, type LucideIcon, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

/**
 * Folha do painel: diálogo acessível do admin (painel simples, B5).
 *
 * Fica SOBRE o Radix Dialog (já no bundle) e de propósito NÃO importa
 * `ui/dialog.tsx` nem `ui/sheet.tsx`: os dois são compartilhados com a loja e
 * o "Close" sr-only deles é contrato de teste. Aqui o botão de fechar tem o
 * nome "Fechar" de verdade.
 *
 * O que o Radix entrega de graça e antes faltava: `role="dialog"` nomeado
 * pelo título (`aria-labelledby`), Esc fecha, foco preso dentro da folha e
 * devolvido a quem abriu.
 *
 * No celular a folha sobe de baixo (cantos de cima redondos); a partir de
 * `sm` vira cartão centralizado. Controlada: quem decide `aberta` é o pai.
 *
 * Enquanto aberta, mantém `admin-modal-open` no body — o CSS usa a classe
 * para travar a rolagem dos contêineres do painel (`index.css`).
 */
export function FolhaDoPainel({
  aberta,
  onFechar,
  titulo,
  icone: Icone = HelpCircle,
  rodape,
  children,
}: {
  readonly aberta: boolean;
  readonly onFechar: () => void;
  readonly titulo: string;
  readonly icone?: LucideIcon;
  /** Faixa fixa embaixo da folha (botões de ação). */
  readonly rodape?: ReactNode;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    if (!aberta) return;
    document.body.classList.add("admin-modal-open");
    return () => {
      document.body.classList.remove("admin-modal-open");
    };
  }, [aberta]);

  return (
    <DialogPrimitive.Root
      open={aberta}
      onOpenChange={(abrir) => {
        if (!abrir) onFechar();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // Sem descrição própria: o título já nomeia a folha. `undefined`
          // cala o aviso do Radix sem inventar um texto que ninguém leria.
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[100] flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-admin-bg p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-left text-sm text-zinc-300 shadow-2xl outline-none",
            "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-8 sm:pb-8 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          )}
        >
          <div className="mb-4 flex shrink-0 items-center justify-between gap-3 border-b border-white/5 pb-4">
            <DialogPrimitive.Title className="flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-admin-gold">
              <Icone aria-hidden="true" className="size-5 shrink-0" />
              <span className="min-w-0">{titulo}</span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/50 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-gold"
            >
              <X aria-hidden="true" className="size-5" />
            </DialogPrimitive.Close>
          </div>

          <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto pb-6 pr-1 text-sm text-zinc-300">
            {children}
          </div>

          {rodape != null && (
            <div className="flex shrink-0 justify-end border-t border-white/5 pt-4">
              {rodape}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
