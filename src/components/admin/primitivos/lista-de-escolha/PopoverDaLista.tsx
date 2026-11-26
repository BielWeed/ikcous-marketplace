import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode, RefObject } from "react";

/**
 * A lista no COMPUTADOR: colada embaixo do campo, da largura dele, com cantos
 * de 20px e no máximo 8 linhas à vista (a lista rola dentro).
 *
 * Radix Popover `modal`, e não uma caixa posicionada à mão: dentro das folhas
 * do painel (Radix Dialog modal) só o mesmo `react-dismissable-layer` entra na
 * mesma pilha de camadas — senão o clique na lista contaria como "fora" da
 * folha e a fecharia. Por isso o popover fica travado em 1.1.15
 * (`tests/front/lista-de-escolha-dependencia.test.ts`).
 *
 * Só sintaxe do Tailwind 3.4 (`[var(--x)]`, nunca `(--x)`).
 */
export function PopoverDaLista({
  titulo,
  botaoRef,
  aoFocarAoAbrir,
  children,
}: {
  readonly titulo: string;
  /** O campo que abriu: recebe o foco de volta e não conta como "fora". */
  readonly botaoRef: RefObject<HTMLButtonElement | null>;
  /** Busca (se houver) ou o listbox. */
  readonly aoFocarAoAbrir: (conteudo: HTMLElement) => void;
  readonly children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-lista-de-escolha="popover"
        aria-label={titulo}
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(evento) => {
          evento.preventDefault();
          aoFocarAoAbrir(evento.currentTarget as HTMLElement);
        }}
        onCloseAutoFocus={(evento) => {
          evento.preventDefault();
          botaoRef.current?.focus();
        }}
        // O toque no próprio campo é o "fechar" do clique dele: se contasse
        // como "fora", fecharia aqui e o clique reabriria em seguida.
        onInteractOutside={(evento) => {
          const alvo = evento.target;
          if (alvo instanceof Node && botaoRef.current?.contains(alvo)) {
            evento.preventDefault();
          }
        }}
        className="z-[135] flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-64 flex-col gap-2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
      >
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-admin-border-strong bg-admin-raised shadow-2xl">
          {children}
        </div>
        <p className="shrink-0 px-1 text-xs text-muted-foreground">
          ↑ ↓ para andar · Enter escolhe · Esc fecha
        </p>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
