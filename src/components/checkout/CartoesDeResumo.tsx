import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Peças de apresentação da tela "Finalizar pedido" (redesenho de 22/10/2026,
 * passo A): o quadradinho do ícone, o selo de "ok" e o cartão de resumo
 * compacto. Só aparência — nenhuma regra de preço, frete, cupom, validação
 * ou pedido mora aqui.
 *
 * Paleta aprovada: a marca da loja NÃO entra (nada de amarelo de marca em
 * fundo, quadradinho ou borda); ícone cinza-escuro em quadradinho cinza
 * claro; verde só para "ok"; âmbar só para aviso (cabe a quem usa).
 */

/** Ícone cinza-escuro dentro de um quadradinho cinza claro. */
export function QuadradinhoDoIcone({
  children,
  grande = false,
  className,
}: {
  readonly children: ReactNode;
  /** 44 px (cartão de resumo) em vez de 32 px (cabeçalho de seção). */
  readonly grande?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700",
        grande ? "size-11" : "size-8",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Check verde pequeno de "ok" — na quina do quadradinho do ícone. */
export function SeloDeOk() {
  return (
    <span
      data-testid="selo-de-ok"
      role="img"
      aria-label="Preenchido"
      className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-emerald-700 text-white ring-2 ring-white"
    >
      <Check aria-hidden="true" className="size-2.5" strokeWidth={3} />
    </span>
  );
}

/**
 * Cartão de resumo compacto: ícone (com o selo de ok quando está tudo
 * preenchido), o resumo e uma ação discreta ("Editar"/"Trocar").
 */
export function CartaoDeResumo({
  rotulo,
  icone,
  ok,
  acao,
  children,
}: {
  /** Nome da região, para leitor de tela. */
  readonly rotulo: string;
  readonly icone: ReactNode;
  readonly ok: boolean;
  readonly acao?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={rotulo}
      className="flex items-center gap-3 rounded-2xl border border-zinc-100/80 bg-white p-3 shadow-sm"
    >
      <span className="relative shrink-0">
        <QuadradinhoDoIcone grande>{icone}</QuadradinhoDoIcone>
        {ok && <SeloDeOk />}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {acao}
    </section>
  );
}

/** Botão discreto de um cartão de resumo — alvo de 44 px. */
export function AcaoDeResumo({
  id,
  onClick,
  controla,
  children,
}: {
  readonly id?: string;
  readonly onClick: () => void;
  /** Id do painel que o botão abre (anunciado como recolhido). */
  readonly controla: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-expanded={false}
      aria-controls={controla}
      onClick={onClick}
      className="min-h-11 min-w-11 shrink-0 rounded-xl bg-zinc-100 px-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-200"
    >
      {children}
    </button>
  );
}
