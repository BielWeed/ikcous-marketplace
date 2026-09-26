import { diaEmSaoPaulo, formatarData, formatarMoeda } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { PontoDaSerieDiaria } from "@/types/painel";
import { type PointerEvent, useState } from "react";

/**
 * Minigráfico de barras dos últimos 14 dias (receita por dia). Barras em tom
 * neutro e HOJE no dourado do painel; passar o dedo/mouse mostra
 * o dia e o valor na linha de cima. HTML puro (sem recharts): 14 barras não
 * pedem biblioteca, e o Início abre mais leve. A tabela escondida dá o mesmo
 * dado a quem usa leitor de tela.
 */
export function SerieDe14Dias({
  serie,
  carregando,
}: Readonly<{ serie: readonly PontoDaSerieDiaria[]; carregando: boolean }>) {
  const [marcado, setMarcado] = useState<number | null>(null);
  const total = serie.reduce((soma, ponto) => soma + ponto.receita, 0);
  const maximo = serie.reduce(
    (maior, ponto) => Math.max(maior, ponto.receita),
    0,
  );
  const pontoMarcado = marcado == null ? null : (serie.at(marcado) ?? null);
  const diaDeHoje = diaEmSaoPaulo(new Date());
  const ultimoDia = serie.at(-1)?.dia;

  const aoMoverPonteiro = (evento: PointerEvent<HTMLDivElement>) => {
    if (serie.length === 0) return;
    const caixa = evento.currentTarget.getBoundingClientRect();
    if (caixa.width <= 0) return;
    const fracao = (evento.clientX - caixa.left) / caixa.width;
    const indice = Math.min(
      serie.length - 1,
      Math.max(0, Math.floor(fracao * serie.length)),
    );
    setMarcado(indice);
  };

  return (
    <section
      aria-labelledby="inicio-serie-titulo"
      aria-busy={carregando && serie.length === 0}
      className="admin-glass h-full rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="inicio-serie-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Últimos 14 dias
        </h2>
        <p className="text-right text-[11px] text-zinc-400" aria-live="polite">
          {pontoMarcado ? (
            <>
              {formatarData(pontoMarcado.dia)}{" "}
              <strong className="font-bold tabular-nums text-white">
                {formatarMoeda(pontoMarcado.receita)}
              </strong>
            </>
          ) : serie.length > 0 ? (
            <>
              Total{" "}
              <strong className="font-bold tabular-nums text-white">
                {formatarMoeda(total)}
              </strong>
            </>
          ) : null}
        </p>
      </div>

      {carregando && serie.length === 0 ? (
        <div
          className="premium-shimmer mt-4 h-24 w-full rounded-xl"
          aria-hidden="true"
        />
      ) : serie.length === 0 ? (
        <p className="mt-4 flex h-24 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">
          Sem vendas registradas nos últimos 14 dias.
        </p>
      ) : (
        <>
          <div
            className="mt-4 flex h-24 touch-pan-y items-end gap-1"
            onPointerMove={aoMoverPonteiro}
            onPointerDown={aoMoverPonteiro}
            onPointerLeave={() => setMarcado(null)}
            aria-hidden="true"
          >
            {serie.map((ponto, indice) => {
              const hoje = ponto.dia === diaDeHoje;
              const altura =
                maximo > 0
                  ? Math.max(
                      ponto.receita > 0 ? 4 : 0,
                      (ponto.receita / maximo) * 100,
                    )
                  : 0;
              return (
                <div key={ponto.dia} className="flex h-full flex-1 items-end">
                  <div
                    className={cn(
                      "w-full rounded-t-[4px] transition-colors",
                      ponto.receita > 0 ? "" : "h-px bg-zinc-800",
                      ponto.receita > 0 &&
                        (hoje
                          ? "bg-admin-gold"
                          : marcado === indice
                            ? "bg-zinc-400"
                            : "bg-zinc-700"),
                    )}
                    style={
                      ponto.receita > 0 ? { height: `${altura}%` } : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
          <div
            className="mt-1.5 flex justify-between text-[10px] tabular-nums text-zinc-500"
            aria-hidden="true"
          >
            <span>{formatarData(serie[0].dia).slice(0, 5)}</span>
            <span>
              {ultimoDia === diaDeHoje
                ? "Hoje"
                : formatarData(ultimoDia).slice(0, 5)}
            </span>
          </div>
          <table className="sr-only">
            <caption>Receita por dia nos últimos 14 dias</caption>
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Receita</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((ponto) => (
                <tr key={ponto.dia}>
                  <td>{formatarData(ponto.dia)}</td>
                  <td>{formatarMoeda(ponto.receita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
