import * as PopoverPrimitive from "@radix-ui/react-popover";
import { type ReactNode, type RefObject, useRef } from "react";

const FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * O vizinho do campo na ordem do Tab (ordem do documento; `tabindex`
 * positivo não é usado no painel). Escondido (`display:none`) não conta.
 */
function vizinhoNoTab(campo: HTMLElement, sentido: 1 | -1): HTMLElement | null {
  const todos = [...document.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
    (el) => el === campo || (el.checkVisibility?.() ?? true),
  );
  const posicao = todos.indexOf(campo);
  if (posicao < 0) return null;
  return todos.at(posicao + sentido) ?? null;
}

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
 * Tab e Shift+Tab saem da lista (combobox do APG): ela fecha e o foco segue
 * para o campo seguinte (ou o anterior) — o `modal` do Radix prenderia o Tab
 * aqui dentro. Se o anel de teclado está numa opção diferente da de agora, o
 * `CorpoDaLista` a escolhe antes (o evento passa por ele primeiro); aberta
 * pelo mouse e sem andar, o Tab só fecha.
 *
 * Só sintaxe do Tailwind 3.4 (`[var(--x)]`, nunca `(--x)`).
 */
export function PopoverDaLista({
  titulo,
  botaoRef,
  aoFocarAoAbrir,
  aoFechar,
  children,
}: {
  readonly titulo: string;
  /** O campo que abriu: recebe o foco de volta e não conta como "fora". */
  readonly botaoRef: RefObject<HTMLButtonElement | null>;
  /** Busca (se houver) ou o listbox. */
  readonly aoFocarAoAbrir: (conteudo: HTMLElement) => void;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
}) {
  // Saiu pelo Tab: para onde o foco vai quando a lista acabar de fechar.
  const saidaPeloTabRef = useRef<1 | -1 | 0>(0);

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
          const sentido = saidaPeloTabRef.current;
          saidaPeloTabRef.current = 0;
          const campo = botaoRef.current;
          if (!campo) return;
          const destino = sentido ? vizinhoNoTab(campo, sentido) : null;
          (destino ?? campo).focus();
        }}
        onKeyDown={(evento) => {
          if (evento.key !== "Tab") return;
          if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
          evento.preventDefault();
          saidaPeloTabRef.current = evento.shiftKey ? -1 : 1;
          aoFechar();
        }}
        // O toque no próprio campo é o "fechar" do clique dele: se contasse
        // como "fora", fecharia aqui e o clique reabriria em seguida.
        onInteractOutside={(evento) => {
          const alvo = evento.target;
          if (alvo instanceof Node && botaoRef.current?.contains(alvo)) {
            evento.preventDefault();
          }
        }}
        className="z-[135] flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-64 flex-col outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
      >
        <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-admin-border-strong bg-admin-raised shadow-2xl">
          {children}
          {/* A dica é o rodapé da caixa, com o fundo dela: solta embaixo,
              ficava sem fundo por cima do texto da tela. */}
          <p className="shrink-0 border-t border-admin-border px-4 py-2 text-xs text-muted-foreground">
            ↑ ↓ para andar · Enter escolhe · Esc fecha
          </p>
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
