import * as Dialog from "@radix-ui/react-dialog";
import { HelpCircle } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect } from "react";

export const FOCO_CLIENTES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
export const BOTAO_CLIENTES = `flex min-h-11 items-center justify-center gap-2 rounded-xl border border-admin-border bg-admin-raised px-3 py-2 text-xs font-semibold text-zinc-100 hover:bg-admin-hover ${FOCO_CLIENTES}`;

/** Folha local: conserva o foco, Esc e a trava de rolagem do painel. */
export function FolhaClientes({
  aberta,
  aoMudar,
  titulo,
  gatilho,
  children,
  ajuda = false,
}: {
  readonly aberta: boolean;
  readonly aoMudar: (aberta: boolean) => void;
  readonly titulo: string;
  readonly gatilho: ReactElement;
  readonly children: ReactNode;
  readonly ajuda?: boolean;
}) {
  useEffect(() => {
    if (!aberta) return;
    document.body.classList.add("admin-modal-open");
    return () => document.body.classList.remove("admin-modal-open");
  }, [aberta]);

  return (
    <Dialog.Root open={aberta} onOpenChange={aoMudar}>
      <Dialog.Trigger asChild>{gatilho}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/80" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[100] flex max-h-[90dvh] flex-col rounded-t-3xl border border-admin-border bg-admin-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-zinc-100 shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        >
          <span
            aria-hidden="true"
            className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-zinc-500 sm:hidden"
          />
          <Dialog.Title className="mb-5 flex shrink-0 items-center gap-3 text-xl font-bold">
            {ajuda && (
              <HelpCircle
                aria-hidden="true"
                className="size-10 shrink-0 rounded-xl border border-violet-300/20 bg-violet-300/10 p-2 text-violet-300"
              />
            )}
            {titulo}
          </Dialog.Title>
          {ajuda && (
            <Dialog.Close className={`${BOTAO_CLIENTES} mb-5 w-full shrink-0`}>
              Fechar
            </Dialog.Close>
          )}
          <div className="custom-scrollbar min-h-0 overflow-y-auto text-sm leading-relaxed text-zinc-300">
            {children}
          </div>
          <Dialog.Close className={`${BOTAO_CLIENTES} mt-5 w-full shrink-0`}>
            {ajuda ? "Entendi" : "Fechar"}
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
