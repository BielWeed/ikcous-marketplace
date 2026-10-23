import { ChevronDown, Info } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * Nota INFORMATIVA do formulário de produto (nunca erro nem validação, que
 * continuam visíveis em vermelho): recolhida é UMA linha discreta — ícone "i",
 * rótulo curto e seta — e a linha inteira é o botão. Aberta, mostra o texto
 * completo logo abaixo, com uma animação curta (desligada em
 * `prefers-reduced-motion`).
 *
 * Acessibilidade: o texto completo fica SEMPRE no DOM (só invisível quando
 * recolhido), então o `id` do painel serve de alvo de `aria-describedby` de um
 * campo mesmo com a nota fechada — a descrição referenciada é lida pelo leitor
 * de tela independentemente de estar visível.
 *
 * Cor de INFO = azul discreto (`sky`), que o gerador de temas já converte para
 * os temas Claro e Confortável.
 */
export function DicaExpansivel({
  rotulo,
  children,
  idDoTexto,
  testId,
  className = "",
}: {
  /** Frase curta que aparece com a nota recolhida. */
  readonly rotulo: string;
  /** O texto completo, mostrado quando a nota abre. */
  readonly children: ReactNode;
  /** `id` do painel com o texto completo (alvo de `aria-describedby`). */
  readonly idDoTexto?: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  const idAutomatico = useId();
  const idDoPainel = idDoTexto ?? idAutomatico;
  const [aberta, setAberta] = useState(false);
  return (
    <div data-testid={testId} className={className}>
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={idDoPainel}
        onClick={() => setAberta((v) => !v)}
        className="flex min-h-11 w-full items-center gap-1.5 rounded-lg border-0 bg-transparent px-1 text-left text-[12px] font-semibold text-sky-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
      >
        <Info aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">{rotulo}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${aberta ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-150 motion-reduce:transition-none ${aberta ? "grid-rows-[1fr]" : "invisible grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <p
            id={idDoPainel}
            className="px-1 pb-2 text-xs leading-snug text-zinc-300"
          >
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}
