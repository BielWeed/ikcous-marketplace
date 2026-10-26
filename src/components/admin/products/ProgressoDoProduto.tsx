import { cn } from "@/lib/utils";

/**
 * O progresso dos cinco campos essenciais do produto (nome, descrição,
 * categoria, preço e estoque) em duas peças do cabeçalho: o anel "N/5" e a
 * barra fina contínua. As duas só DESENHAM a contagem que a tela já faz; quem
 * decide quantos estão prontos é o formulário.
 *
 * O anel é decoração (`aria-hidden`): o número já está no subtítulo e na barra,
 * que é o `progressbar` de verdade — um leitor de tela não repete a mesma
 * conta três vezes.
 */

/** Cinza com zero pronto, esmeralda com algum, verde cheio com todos. */
export type EstadoDoProgresso = "vazio" | "parcial" | "completo";

export function estadoDoProgresso(
  preenchidos: number,
  total: number,
): EstadoDoProgresso {
  if (preenchidos <= 0) return "vazio";
  return preenchidos >= total ? "completo" : "parcial";
}

const RAIO = 18;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

export function AnelDoProgresso({
  preenchidos,
  total,
}: Readonly<{ preenchidos: number; total: number }>) {
  const estado = estadoDoProgresso(preenchidos, total);
  const fracao = Math.min(1, Math.max(0, preenchidos / total));
  return (
    <span
      data-testid="anel-do-produto"
      data-estado={estado}
      aria-hidden="true"
      className={cn("produto-anel", estado !== "vazio" && "text-emerald-300")}
    >
      <svg viewBox="0 0 44 44" className="produto-anel-svg" fill="none">
        <circle className="produto-anel-trilha" cx="22" cy="22" r={RAIO} />
        {estado !== "vazio" && (
          <circle
            className="produto-anel-arco"
            cx="22"
            cy="22"
            r={RAIO}
            strokeDasharray={CIRCUNFERENCIA}
            strokeDashoffset={CIRCUNFERENCIA * (1 - fracao)}
          />
        )}
      </svg>
      <span className="produto-anel-texto">
        {preenchidos}/{total}
      </span>
    </span>
  );
}

export function BarraDoProgresso({
  preenchidos,
  total,
}: Readonly<{ preenchidos: number; total: number }>) {
  return (
    <div
      role="progressbar"
      aria-label="Campos essenciais"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={preenchidos}
      aria-valuetext={`${preenchidos} de ${total} essenciais prontos`}
      data-estado={estadoDoProgresso(preenchidos, total)}
      className="produto-progresso-barra text-emerald-300"
    >
      <span style={{ width: `${(preenchidos / total) * 100}%` }} />
    </div>
  );
}
