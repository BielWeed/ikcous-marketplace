import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

/**
 * Seção recolhível do painel (painel simples, B7). O botão do cabeçalho tem
 * `aria-expanded` + `aria-controls`; `temErro` abre a seção sozinha, para um
 * erro de validação nunca ficar escondido.
 *
 * O conteúdo NUNCA desmonta — fechar só aplica `hidden` (mesma regra do
 * `PainelRecolhivel` do Frete): campo digitado dentro de uma seção fechada não
 * perde o valor.
 */
export function SecaoRecolhivel({
  titulo,
  resumo,
  abertaInicial = false,
  temErro = false,
  children,
}: {
  readonly titulo: string;
  /** Resumo curto — só aparece com a seção FECHADA. */
  readonly resumo?: ReactNode;
  readonly abertaInicial?: boolean;
  /** Há erro dentro: a seção abre sozinha. */
  readonly temErro?: boolean;
  readonly children: ReactNode;
}) {
  const [aberta, setAberta] = useState(abertaInicial || temErro);
  const idConteudo = useId();

  useEffect(() => {
    if (temErro) setAberta(true);
  }, [temErro]);

  return (
    <section aria-label={titulo}>
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={idConteudo}
        onClick={() => setAberta((a) => !a)}
        className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border-b border-white/10 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-zinc-200">
            {titulo}
          </span>
          {!aberta && resumo != null && (
            <span className="mt-0.5 block truncate text-sm text-zinc-400">
              {resumo}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-zinc-400 transition-transform duration-200 group-hover:text-zinc-200",
            aberta && "rotate-180",
          )}
        />
      </button>
      <div id={idConteudo} hidden={!aberta} className="pt-4">
        {children}
      </div>
    </section>
  );
}
