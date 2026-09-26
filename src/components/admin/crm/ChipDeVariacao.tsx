import { formatarVariacao } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/**
 * Variação contra um período anterior: seta + sinal + número, e a cor só
 * reforça (nunca é a única pista). `sobeEBom=false` inverte o julgamento
 * (ex.: taxa de devolução subindo é ruim).
 */
export function ChipDeVariacao({
  pct,
  comparacao,
  sobeEBom = true,
  className,
}: Readonly<{
  pct: number | null;
  comparacao: string;
  sobeEBom?: boolean;
  className?: string;
}>) {
  if (pct == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-500",
          className,
        )}
      >
        <Minus className="size-3" aria-hidden="true" />
        sem base de comparação
      </span>
    );
  }

  const arredondado = Math.round(pct * 10) / 10;
  const direcao =
    arredondado > 0 ? "sobe" : arredondado < 0 ? "desce" : "igual";
  const bom = direcao === "igual" ? null : (direcao === "sobe") === sobeEBom;
  const Icone =
    direcao === "sobe"
      ? ArrowUpRight
      : direcao === "desce"
        ? ArrowDownRight
        : Minus;
  const verbo =
    direcao === "sobe"
      ? "Alta de"
      : direcao === "desce"
        ? "Queda de"
        : "Estável:";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
        bom === true &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
        bom === false && "border-rose-500/20 bg-rose-500/10 text-rose-300",
        bom === null && "border-white/10 bg-white/5 text-zinc-300",
        className,
      )}
    >
      <Icone className="size-3" aria-hidden="true" />
      {/* Leitor de tela ouve a frase inteira ("Alta de +12% vs. …"); a
          parte visual fica escondida dele para não ler duas vezes. */}
      <span className="sr-only">
        {verbo} {formatarVariacao(arredondado)} {comparacao}
      </span>
      <span aria-hidden="true">
        {formatarVariacao(arredondado)}{" "}
        <span className="font-semibold text-zinc-400">{comparacao}</span>
      </span>
    </span>
  );
}
