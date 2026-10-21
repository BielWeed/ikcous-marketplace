import { Chave } from "@/components/admin/shipping/primitivas-direcao-d";
import type { ReactNode } from "react";

/** Ligado vende fora; a coluna e seus dois valores continuam os mesmos. */
export function FreteNacionalBloco({
  coverage,
  onCoverage,
  desabilitado,
  children,
}: {
  readonly coverage: "local" | "national";
  readonly onCoverage: (coverage: "local" | "national") => void;
  readonly desabilitado?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <section
      id="bloco-frete-nacional"
      aria-label="Vender fora da sua região"
      className="space-y-5"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-zinc-100">
            Vender para fora da sua região
          </p>
          <p className="mt-1 text-[12.5px] text-zinc-400">
            Uma transportadora leva o pedido. O cliente vê o preço dela, cotado
            na hora.
          </p>
        </div>
        <Chave
          rotulo="Vender para fora da sua região"
          ligada={coverage === "national"}
          onToggle={() =>
            onCoverage(coverage === "national" ? "local" : "national")
          }
          desabilitado={desabilitado}
        />
      </div>
      {children}
    </section>
  );
}
