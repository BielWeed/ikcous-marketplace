import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
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
}: {
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
    <section id={id} aria-label={titulo} className="scroll-mt-24">
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={idConteudo}
        onClick={() => {
          if (aberta && comPendencia) {
            // Erro de validação ainda aberto: fechar esconderia o aviso.
            return;
          }
          onToggle();
        }}
        className="group flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-white/10 pb-3.5 text-left"
      >
        <span className="min-w-0 flex-1 basis-40">
          <span className="block text-xs font-extrabold uppercase tracking-[0.22em] text-zinc-300">
            {titulo}
          </span>
          {!aberta && resumo != null && (
            <span className="mt-1 block truncate text-[12.5px] font-normal normal-case tracking-normal text-zinc-500">
              {resumo}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {aberta && comPendencia && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-400">
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

      <div id={idConteudo} hidden={!aberta} className="pt-5">
        {children}
      </div>
    </section>
  );
}
