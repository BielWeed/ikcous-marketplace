import { cn } from "@/lib/utils";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Painel recolhível da tela de Frete unificada (pedido do dono, 23/09/2026:
 * a tela "Fora da cidade" estava numa tela separada e o cabeçalho dela
 * transbordava — tudo volta para a mesma tela de Frete, em blocos que
 * fecham por padrão). Gramática direção D (03/09/2026): o botão do
 * cabeçalho é a MESMA linha fina (título uppercase espaçado + estado à
 * direita) de `CabecaDeSecao`, só que clicável e com chevron.
 *
 * CONTROLADO de propósito: quem decide `aberta` é a view (precisa abrir
 * "Fora da cidade" programaticamente ao entrar pela rota
 * `admin-shipping-national`, e expandir + rolar ao clicar em "Estratégias
 * do frete nacional →" dentro do painel).
 *
 * O conteúdo NUNCA desmonta — fechar só aplica o atributo `hidden` (região
 * `aria-controls`), nunca `AnimatePresence`/condicional. Diferente da
 * `SecaoColapsavel` de Ajustes (que desmonta e por isso trava o fechamento
 * com `comPendencia` para não perder o que foi digitado): aqui não há
 * risco de perda — o estado do formulário mora na view, não no painel.
 * `comPendencia` aqui bloqueia o fechamento só quando há um ERRO DE
 * VALIDAÇÃO ainda aberto (a lojista não pode esconder um erro que precisa
 * resolver antes de salvar).
 */
export function PainelRecolhivel({
  id,
  titulo,
  resumo,
  aberta,
  onToggle,
  comPendencia = false,
  children,
  icone: Icone,
}: {
  readonly icone?: LucideIcon;
  readonly id: string;
  readonly titulo: string;
  /** Resumo curto do estado salvo — só aparece com o painel FECHADO. */
  readonly resumo?: ReactNode;
  readonly aberta: boolean;
  readonly onToggle: () => void;
  /** Há um erro de validação pendente: o painel não pode fechar. */
  readonly comPendencia?: boolean;
  readonly children: ReactNode;
}) {
  const idConteudo = `${id}-conteudo`;
  return (
    <section
      id={id}
      aria-label={titulo}
      className="scroll-mt-48 rounded-[20px] border border-admin-border bg-admin-surface"
    >
      <button
        type="button"
        aria-label={titulo}
        aria-expanded={aberta}
        aria-controls={idConteudo}
        onClick={() => {
          if (aberta && comPendencia) {
            // Erro de validação ainda aberto: fechar esconderia o aviso.
            return;
          }
          onToggle();
        }}
        className="group flex min-h-11 w-full items-center gap-3 p-4 text-left"
      >
        {Icone && (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-admin-raised text-admin-gold">
            <Icone aria-hidden="true" className="size-5" />
          </span>
        )}
        <span className="min-w-0 flex-1 break-words">
          <span className="block text-[15px] font-extrabold text-zinc-100">
            {titulo}
          </span>
          {resumo != null && (
            <span className="mt-1 block break-words text-[12.5px] font-normal normal-case tracking-normal text-zinc-500">
              {resumo}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {aberta && comPendencia && (
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">
              Resolva o erro para fechar
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300",
              aberta && "rotate-180",
            )}
          />
        </span>
      </button>

      <div id={idConteudo} hidden={!aberta} className="px-4 pb-4 pt-2">
        {children}
      </div>
    </section>
  );
}
