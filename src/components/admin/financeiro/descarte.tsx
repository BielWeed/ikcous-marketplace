// A pergunta "Descartar o que você escreveu?" das folhas do Financeiro.
//
// Ela mora DENTRO da folha, e não num AlertDialog por cima: o Sheet engole o
// clique de qualquer gesto que começa fora do conteúdo dele (o "guardião do
// clique pós-fecho", ui/sheet.tsx), então os botões de uma janela portalada no
// body nunca receberiam o toque. Dentro da folha, o gesto é "dentro" e passa.

import { createContext, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import { CLASSE_BOTAO_PERIGO, CLASSE_BOTAO_SECUNDARIO } from "./partes";

export interface EstadoDoDescarte {
  /** A folha aberta tem algo escrito que ainda não foi salvo. */
  readonly sujo: boolean;
  /** A pergunta está na tela. */
  readonly perguntando: boolean;
  readonly aoContinuar: () => void;
  readonly aoDescartar: () => void;
}

/**
 * A view é a dona do estado (ela sabe qual folha está aberta e se está suja);
 * a `FolhaFinanceira` lê daqui para mostrar a pergunta e para não animar a
 * saída de um arrasto que vai virar pergunta (a folha desceria e voltaria).
 */
export const ContextoDoDescarte = createContext<EstadoDoDescarte>({
  sujo: false,
  perguntando: false,
  aoContinuar: () => {},
  aoDescartar: () => {},
});

export function PerguntaDeDescarte({
  aoContinuar,
  aoDescartar,
}: {
  readonly aoContinuar: () => void;
  readonly aoDescartar: () => void;
}) {
  const continuar = useRef<HTMLButtonElement>(null);
  // Foco na saída segura ao abrir; ao fechar, volta para onde estava.
  useEffect(() => {
    const anterior = document.activeElement;
    continuar.current?.focus();
    return () => {
      if (anterior instanceof HTMLElement && anterior.isConnected)
        anterior.focus();
    };
  }, []);
  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center rounded-[inherit] bg-[rgb(0_0_0/0.5)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] duration-150 animate-in fade-in-0 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fin-descarte-titulo"
        aria-describedby="fin-descarte-texto"
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-admin-border bg-admin-raised p-5 text-white shadow-lg"
      >
        <div className="flex flex-col gap-2">
          <h2 id="fin-descarte-titulo" className="text-xl font-bold">
            Descartar o que você escreveu?
          </h2>
          <p id="fin-descarte-texto" className="text-sm text-zinc-400">
            Se sair agora, o que você preencheu neste formulário será perdido.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            ref={continuar}
            type="button"
            onClick={aoContinuar}
            className={cn(CLASSE_BOTAO_SECUNDARIO, "min-h-12 border-solid")}
          >
            Continuar escrevendo
          </button>
          <button
            type="button"
            onClick={aoDescartar}
            className={cn(CLASSE_BOTAO_PERIGO, "min-h-12 border-solid")}
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
