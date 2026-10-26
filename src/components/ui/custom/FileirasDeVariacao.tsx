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
  pendentes = [],
}: {
  fileiras: FileiraDeVariacao[];
  escolha: Record<string, string>;
  onEscolher: (nome: string, valor: string) => void;
  /** Nomes dos grupos que a pessoa tentou comprar sem escolher: o "Escolha"
   *  da linha vira cor de alerta até ela escolher. */
  pendentes?: readonly string[];
}) {
  const selecionadas = new Map(Object.entries(escolha));
  const idBase = useId();
  return (
    <div className="mb-4 space-y-5">
      {fileiras.map(({ nome, valores }, indice) => {
        const fileiraDeCor = /^(cor|cores|color)$/i.test(nome.trim());
        const selecionada = selecionadas.get(nome);
        const idNome = `${idBase}-${indice}`;
        const idEscolha = `${idBase}-escolha-${indice}`;
        const faltaEscolher = !selecionada && pendentes.includes(nome);
        return (
          <div
            key={nome}
            role="group"
            aria-labelledby={idNome}
            aria-describedby={faltaEscolher ? idEscolha : undefined}
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
                id={idEscolha}
                className={cn(
                  "min-w-0 break-words text-right text-[13px] font-semibold",
                  selecionada && "text-foreground",
                  !selecionada &&
                    (faltaEscolher
                      ? "text-red-700 dark:text-red-400"
                      : "text-muted-foreground"),
                )}
              >
                {selecionada ?? "Escolha"}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {valores.map(({ valor, disponivel, existe }) => {
                const ativa = selecionada === valor;
                // Esgotado de vez: travado. Apagado só pela combinação atual
                // (existe em outra): apagado, mas tocável -- tocar escolhe o
                // valor e solta o que deixou de combinar.
                const apagadoPelaCombinacao = !disponivel && (existe ?? false);
                const amostra = fileiraDeCor ? coresDoNome(valor) : [];
                return (
                  <button
                    key={valor}
                    type="button"
                    aria-label={valor}
                    aria-pressed={ativa}
                    disabled={!disponivel && !apagadoPelaCombinacao && !ativa}
                    title={
                      disponivel
                        ? valor
                        : apagadoPelaCombinacao
                          ? `${valor} — Indisponível com a sua escolha`
                          : `${valor} — Esgotado`
                    }
                    onClick={() => onEscolher(nome, valor)}
                    className={cn(
                      "flex min-h-11 min-w-11 max-w-full items-center justify-center gap-2 rounded-[14px] border border-solid px-3.5 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:border-border/60 disabled:bg-muted/30 disabled:text-muted-foreground",
                      ativa
                        ? "border-foreground bg-foreground text-background"
                        : apagadoPelaCombinacao
                          ? "border-border/60 bg-muted/30 text-muted-foreground"
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
                      <span className="sr-only">
                        {apagadoPelaCombinacao
                          ? " (Indisponível com a sua escolha)"
                          : " (Esgotado)"}
                      </span>
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
