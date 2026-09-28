import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Peças visuais compartilhadas pelas abas do Dashboard CRM
 * (spec `docs/superpowers/specs/2026-09-27-crm-visual-profissional-design.md`).
 *
 * O fundo do painel é `#09090b`; `admin-glass` (`bg-zinc-950/40`, borda
 * `white/5`) some nele — foi por isso que cartão, botão e fundo ficaram da
 * mesma cor e "nada parecia botão". Estas classes garantem superfície
 * visível e affordance em tudo que é clicável.
 */

/** Anel de foco dourado: aparece no teclado, não no toque. */
export const FOCO_DO_CRM =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]";

/** Superfície de cartão que se destaca do fundo do painel. */
export const SUPERFICIE_DO_CRM =
  "rounded-2xl border border-white/[0.08] bg-zinc-900/60 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]";

/**
 * Superfície de linha, bloco ou chip clicável DENTRO de um cartão.
 *
 * `border-solid` é OBRIGATÓRIO aqui (achado da conferência final,
 * 27/09/2026): `src/index.css` zera `border-style` em TODO `<button>`
 * (`@layer base { button { border: none } }`, reset que outras telas
 * dependem — não mexer nele) e o utilitário `border` do Tailwind só define
 * `border-width`, não `border-style`. Sem `border-solid` (que vem da
 * camada `utilities`, de prioridade maior que `base`), a borda desta peça
 * — a "superfície própria" que a separa do fundo — nunca aparecia em
 * NENHUM `<button>` que a usa (blocos de segmento, linhas do pipeline
 * etc.), só o fundo (`bg-zinc-800/40`) dava alguma pista de que era
 * clicável.
 */
export const CLICAVEL_DO_CRM = cn(
  "cursor-pointer border border-solid border-white/10 bg-zinc-800/40 transition-[background-color,border-color,transform] hover:border-white/20 hover:bg-zinc-800/80 active:scale-[0.99]",
  FOCO_DO_CRM,
);

/**
 * Cartão com título em frase normal, uma linha dizendo que pergunta ele
 * responde e, à direita, uma ação opcional. `id` vira o `id` do título
 * (`<id>-titulo`), ligado por `aria-labelledby`.
 */
export function CartaoDoCrm({
  id,
  titulo,
  descricao,
  acao,
  children,
  className,
}: Readonly<{
  id: string;
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={cn(SUPERFICIE_DO_CRM, "p-4 sm:p-5", className)}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2
            id={`${id}-titulo`}
            className="text-sm font-semibold leading-snug text-white"
          >
            {titulo}
          </h2>
          {descricao ? (
            <p className="text-xs leading-relaxed text-zinc-400">{descricao}</p>
          ) : null}
        </div>
        {acao ? <div className="shrink-0">{acao}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** Estado vazio de um cartão: título, uma frase e, se couber, uma ação. */
export function EstadoVazioDoCrm({
  titulo,
  texto,
  acao,
  className,
}: Readonly<{
  titulo: ReactNode;
  texto?: ReactNode;
  acao?: ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center",
        className,
      )}
    >
      <p className="text-sm font-semibold text-zinc-200">{titulo}</p>
      {texto ? (
        <p className="max-w-sm text-xs leading-relaxed text-zinc-400">
          {texto}
        </p>
      ) : null}
      {acao ? <div className="mt-2">{acao}</div> : null}
    </div>
  );
}
