import { useEffect, useRef } from "react";

import { BOTAO_NEUTRO } from "./controles";

/** Dentro da folha: os botões não são bloqueados pelo guardião de ui/sheet. */
export function PerguntaDeDescarte({
  aoContinuar,
  aoDescartar,
}: {
  readonly aoContinuar: () => void;
  readonly aoDescartar: () => void;
}) {
  const continuar = useRef<HTMLButtonElement>(null);
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
        aria-labelledby="atendimento-descarte-titulo"
        aria-describedby="atendimento-descarte-texto"
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-admin-border bg-admin-raised p-5 text-white shadow-lg"
      >
        <div className="flex flex-col gap-2">
          <h2 id="atendimento-descarte-titulo" className="text-xl font-bold">
            Descartar o que você escreveu?
          </h2>
          <p id="atendimento-descarte-texto" className="text-sm text-zinc-400">
            Se sair agora, o que você preencheu neste formulário será perdido.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            ref={continuar}
            type="button"
            onClick={aoContinuar}
            className={BOTAO_NEUTRO}
          >
            Continuar editando
          </button>
          <button type="button" onClick={aoDescartar} className={BOTAO_NEUTRO}>
            Descartar
          </button>
        </div>
      </div>
    </div>
  );
}
