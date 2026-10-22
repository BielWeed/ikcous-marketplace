import { cn } from "@/lib/utils";
import { corDaVariacao } from "@/utils/cor-da-variacao";
import type { FileiraDeVariacao } from "@/utils/fileiras-de-variacao";

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
  return (
    <div className="space-y-5">
      {fileiras.map(({ nome, valores }) => {
        const bolinhas =
          /^(cor|cores|color)$/i.test(nome.trim()) &&
          valores.every((v) => corDaVariacao(v.valor));
        const selecionada = selecionadas.get(nome);
        return (
          <fieldset key={nome} className="min-w-0">
            <legend className="float-left mb-3 text-sm font-bold text-foreground">
              {nome}
            </legend>
            <div className="mb-3 flex min-h-5 items-center justify-between gap-2 pl-2 text-sm">
              <span className="text-muted-foreground">{selecionada}</span>
            </div>
            <div className="clear-both flex flex-wrap gap-2">
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
                      "relative flex min-h-11 items-center justify-center rounded-xl border text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
                      bolinhas
                        ? "w-11 border-transparent bg-transparent disabled:opacity-60"
                        : "min-w-[72px] px-3 py-2",
                      !bolinhas &&
                        (ativa
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-foreground"),
                      !disponivel && "line-through",
                    )}
                  >
                    {bolinhas && <span className="sr-only">{valor}</span>}
                    {bolinhas ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-9 rounded-full border border-foreground",
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
                        <span>{valor}</span>
                        {!disponivel && (
                          <span className="sr-only"> (Esgotado)</span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
