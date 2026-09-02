import type { ReactNode } from "react";

/**
 * Título de página do painel admin — fórmula "Elite Header" padronizada
 * (onda 2 da missão visual, 02/09): o bloco era copiado à mão em cada
 * tela (`text-2xl font-black uppercase tracking-tighter md:text-3xl`) e
 * as cópias divergiam entre si. Aqui a fórmula vive em UM lugar.
 *
 * Componente burro de propósito: nenhum texto default, nenhum estado.
 * - `children`: o que fica DENTRO do h1, ao lado do título (botão de
 *   ajuda, ponto de conexão) — a view move a marcação como está.
 * - `acoes`: o que fica à DIREITA da linha (botões de ação, alerta com
 *   dropdown) — agrupado no mesmo wrapper dominante das listas
 *   (`flex shrink-0 items-center gap-3`).
 *
 * A linha que abraça título e ações (padding/centralização) continua na
 * view de propósito: ela muda de contexto por tela — linha solta nas
 * listas vs. barra sticky com `max-w-4xl` nos ajustes — e não é cópia.
 */
export function AdminPageHeader({
  titulo,
  children,
  acoes,
}: {
  /** Texto do título — a view passa o MESMO texto de antes. */
  titulo: string;
  /** Extras dentro do h1, ao lado do título (ajuda, ponto de conexão). */
  children?: ReactNode;
  /** Lado direito da linha (botões de ação, alertas). */
  acoes?: ReactNode;
}) {
  return (
    <>
      <h1 className="flex shrink-0 select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl">
        <span className="flex flex-nowrap items-baseline whitespace-nowrap">
          <span className="italic text-white">{titulo}</span>
        </span>
        {children}
      </h1>
      {acoes ? (
        <div className="flex shrink-0 items-center gap-3">{acoes}</div>
      ) : null}
    </>
  );
}
