import { cn } from "@/lib/utils";
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
 *
 * `tituloEncolhe` (achado do dono, 28/09/2026): o título é `shrink-0` por
 * padrão — "Dashboard CRM" abaixo de ~356px empurrava as ações (o botão
 * Sincronizar) para fora da tela. Como a view põe `overflow-x-clip` na
 * raiz para não rolar de lado, o botão sumia em vez de rolar até ele.
 * Nenhuma das outras telas usa esta prop hoje; a Push
 * (`AdminPushView.tsx:973-981`) resolveu um problema parecido (título +
 * ações estourando em 360-390px) de outro jeito, local à view — `flex-wrap`
 * na linha, deixando o selo de status cair para uma segunda linha em vez
 * de encolher o título. Aqui a prop existe como opt-in por prop para não
 * mudar nada nas outras telas (default preserva as mesmas classes de
 * sempre).
 */
export function AdminPageHeader({
  titulo,
  children,
  acoes,
  tituloEncolhe = false,
}: {
  /** Texto do título — a view passa o MESMO texto de antes. */
  titulo: string;
  /** Extras dentro do h1, ao lado do título (ajuda, ponto de conexão). */
  children?: ReactNode;
  /** Lado direito da linha (botões de ação, alertas). */
  acoes?: ReactNode;
  /**
   * Deixa o título encolher e truncar (com "…") em vez de forçar a
   * largura mínima do texto inteiro — usa em telas com título comprido e
   * pouco espaço (hoje só o Dashboard CRM). Default `false`: comportamento
   * idêntico ao de sempre.
   */
  tituloEncolhe?: boolean;
}) {
  return (
    <>
      <h1
        className={cn(
          "flex select-none items-center gap-3 text-2xl font-black uppercase leading-none tracking-tighter md:text-3xl",
          tituloEncolhe ? "min-w-0" : "shrink-0",
        )}
      >
        <span
          className={cn(
            "flex items-baseline",
            tituloEncolhe
              ? "min-w-0 truncate"
              : "flex-nowrap whitespace-nowrap",
          )}
        >
          <span
            className={cn(
              "italic text-white",
              // `pr-1`: o itálico inclina a última letra para a direita —
              // sem essa folga, o `truncate` corta a pontinha dela mesmo
              // quando o título cabe inteiro (achado do dono, 28/09/2026).
              tituloEncolhe && "truncate pr-1",
            )}
          >
            {titulo}
          </span>
        </span>
        {children}
      </h1>
      {acoes ? (
        <div className="flex shrink-0 items-center gap-3">{acoes}</div>
      ) : null}
    </>
  );
}
