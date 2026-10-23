import { cn } from "@/lib/utils";
import { coresDoNome } from "@/utils/cor-da-variacao";
import type { FileiraDeVariacao } from "@/utils/fileiras-de-variacao";
import { type CSSProperties, useId } from "react";

/** Uma cor vira fundo liso; duas ou mais, faixas iguais com paradas duras. */
function estiloDaAmostra(cores: string[]): CSSProperties {
  if (cores.length === 1) return { backgroundColor: cores[0] };
  const fatia = 100 / cores.length;
  const paradas = cores.map(
    (cor, i) => `${cor} ${i * fatia}% ${(i + 1) * fatia}%`,
  );
  return {
    backgroundImage: `linear-gradient(to bottom, ${paradas.join(", ")})`,
  };
}

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
    <div className="mb-4 space-y-5">
      {fileiras.map(({ nome, valores }, indice) => {
        const fileiraDeCor = /^(cor|cores|color)$/i.test(nome.trim());
        const selecionada = selecionadas.get(nome);
        const idNome = `${idBase}-${indice}`;
        return (
          <div
            key={nome}
            role="group"
            aria-labelledby={idNome}
            className="min-w-0"
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span
                id={idNome}
                className="break-words font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                {nome}
              </span>
              <span
                className={cn(
                  "min-w-0 break-words text-right text-[13px] font-semibold",
                  selecionada ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {selecionada ?? "Escolha"}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {valores.map(({ valor, disponivel }) => {
                const ativa = selecionada === valor;
                const amostra = fileiraDeCor ? coresDoNome(valor) : [];
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
                      "flex min-h-11 min-w-11 max-w-full items-center justify-center gap-2 rounded-[14px] border px-3.5 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-muted/30 disabled:text-muted-foreground",
                      ativa
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground",
                      !disponivel && "line-through",
                    )}
                  >
                    {amostra.length > 0 && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-[18px] shrink-0 rounded-full border",
                          ativa
                            ? "border-transparent ring-1 ring-background"
                            : "border-foreground/50",
                        )}
                        style={estiloDaAmostra(amostra)}
                      />
                    )}
                    <span className="min-w-0 break-words text-left">
                      {valor}
                    </span>
                    {!disponivel && (
                      <span className="sr-only"> (Esgotado)</span>
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
