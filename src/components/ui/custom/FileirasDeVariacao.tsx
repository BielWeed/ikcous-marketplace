import { cn } from "@/lib/utils";
import { corDaVariacao } from "@/utils/cor-da-variacao";
import type { FileiraDeVariacao } from "@/utils/fileiras-de-variacao";
import { useId } from "react";

export function FileirasDeVariacao({
  fileiras,
  escolha,
  onEscolher,
}: {
  fileiras: FileiraDeVariacao[];
  escolha: Record<string, string>;
  onEscolher: (nome: string, valor: string) => void;
}) {
  const selecionadas = new Map(Object.entries(escolha));
  const idBase = useId();
  return (
    <div className="mb-4 space-y-1">
      {fileiras.map(({ nome, valores }, indice) => {
        const bolinhas =
          /^(cor|cores|color)$/i.test(nome.trim()) &&
          valores.every((v) => corDaVariacao(v.valor));
        const selecionada = selecionadas.get(nome);
        const idNome = `${idBase}-${indice}`;
        return (
          <div
            key={nome}
            role="group"
            aria-labelledby={idNome}
            className="flex min-w-0 items-start gap-2"
          >
            <div className="flex min-h-11 w-20 shrink-0 flex-col justify-center">
              <span
                id={idNome}
                className="break-words text-sm font-bold text-foreground"
              >
                {nome}
              </span>
              <span className="text-xs text-muted-foreground">
                {selecionada ?? "Escolha"}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
              {valores.map(({ valor, disponivel }) => {
                const ativa = selecionada === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    aria-label={valor}
                    aria-pressed={ativa}
                    disabled={!disponivel && !ativa}
                    title={disponivel ? valor : `${valor} — Esgotado`}
                    onClick={() => onEscolher(nome, valor)}
                    className={cn(
                      "relative flex min-h-11 items-center justify-center bg-transparent text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
                      bolinhas
                        ? "w-11 rounded-xl border border-transparent disabled:opacity-60"
                        : "min-w-[52px] rounded-full",
                      !disponivel && "line-through",
                    )}
                  >
                    {bolinhas && <span className="sr-only">{valor}</span>}
                    {bolinhas ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-7 rounded-full border border-foreground",
                          ativa &&
                            "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                        )}
                        style={{
                          backgroundColor: corDaVariacao(valor) ?? undefined,
                        }}
                      >
                        {!disponivel && (
                          <span className="absolute inset-x-1 top-1/2 h-px -rotate-45 bg-foreground" />
                        )}
                      </span>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "flex h-9 min-w-[52px] items-center justify-center rounded-full border px-3",
                            ativa
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-background text-foreground",
                          )}
                        >
                          {valor}
                        </span>
                        {!disponivel && (
                          <span className="sr-only"> (Esgotado)</span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
