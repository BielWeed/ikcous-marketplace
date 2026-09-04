import type { ReactNode } from "react";

/**
 * Primitivas visuais da direção D (aprovada pelo dono, 03/09/2026, após 3
 * rodadas de iteração): seções como LINHAS FINAS, sem caixa/card nenhum —
 * é o que ele elogiou na direção A e mandou manter. Quatro peças
 * compartilhadas pelos três blocos de frete, para o desenho idêntico morar
 * em UM lugar (regra escrita em dois lugares diverge — lição #53):
 *
 * - CabecaDeSecao: título uppercase espaçado + estado à direita, hairline.
 * - Linha: nome+dica à esquerda, comando à direita (no celular o comando
 *   desce e ocupa a linha inteira, como no mockup).
 * - PontoEstado: bolinha de estado (verde do token / âmbar / zinc).
 * - Chave: a chave da direção D. COM `onToggle` é um botão role="switch"
 *   de verdade (há campo gravável real por trás); SEM `onToggle` é
 *   EXIBIÇÃO de estado — um span que não clica nada, porque chave
 *   decorativa que não salva nada é mentira (é o caso da credencial da
 *   transportadora, que esta tela só LÊ — quem grava é Ajustes).
 */

type TomDoPonto = "positivo" | "atencao" | "neutro";

// Map (não Record indexado por variável): indexação dinâmica dispara
// `security/detect-object-injection` do eslint e o teto do lint reprova
// warning novo — `.get()` devolve a mesma cor para cada tom.
const PONTO_TOM = new Map<TomDoPonto, string>([
  ["positivo", "bg-admin-accent shadow-[0_0_8px] shadow-admin-accent/60"],
  ["atencao", "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/50"],
  ["neutro", "bg-zinc-600"],
]);

export function PontoEstado({
  tom,
}: {
  readonly tom: TomDoPonto;
}) {
  return (
    <span
      aria-hidden="true"
      className={`size-1.5 shrink-0 rounded-full ${PONTO_TOM.get(tom)}`}
    />
  );
}

export function CabecaDeSecao({
  titulo,
  estado,
}: {
  readonly titulo: string;
  readonly estado?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3.5">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.22em] text-zinc-300">
        {titulo}
      </h2>
      {estado != null && (
        <div className="flex shrink-0 items-center gap-2 text-[13px] text-zinc-400">
          {estado}
        </div>
      )}
    </div>
  );
}

export function Linha({
  nome,
  dica,
  children,
}: {
  readonly nome: ReactNode;
  readonly dica?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-b border-white/5 py-5 last:border-b-0 md:py-[22px]">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-100">
          {nome}
        </p>
        {dica != null && (
          <p className="mt-0.5 text-[13px] leading-snug text-zinc-500">
            {dica}
          </p>
        )}
      </div>
      <div className="flex w-full items-center justify-between gap-4 md:w-auto md:shrink-0 md:justify-end">
        {children}
      </div>
    </div>
  );
}

export function Chave({
  ligada,
  rotulo,
  onToggle,
  desabilitado,
}: {
  readonly ligada: boolean;
  /** Nome acessível — o que esta chave liga/desliga (ou exibe). */
  readonly rotulo: string;
  /**
   * Presente = chave de verdade (botão role="switch" ligado a um campo
   * gravável). Ausente = exibição de estado (span, não é botão, não salva
   * nada — e por isso não finge que salva).
   */
  readonly onToggle?: () => void;
  readonly desabilitado?: boolean;
}) {
  const pino = (
    <span
      aria-hidden="true"
      className={`relative inline-block h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200 ${
        ligada ? "bg-admin-accent" : "bg-zinc-700"
      }`}
    >
      <span
        className={`absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow-md transition-transform duration-200 ${
          ligada ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </span>
  );
  if (!onToggle) {
    return (
      <span title={rotulo} className="inline-flex items-center">
        {pino}
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      onClick={onToggle}
      disabled={desabilitado}
      className="inline-flex cursor-pointer items-center disabled:pointer-events-none disabled:opacity-50"
    >
      {pino}
    </button>
  );
}
