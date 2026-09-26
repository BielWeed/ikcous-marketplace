import { ChartColumn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import {
  type PontoDoFluxo,
  formatarBRL,
  formatarBRLCompacto,
  formatarDataCurta,
  formatarDiaPorExtenso,
} from "@/lib/financeiro";
import { Dinheiro, useValoresEstaoOcultos } from "./partes";

// Cores por FUNÇÃO (não por série arbitrária): entrada verde, saída
// vermelha, saldo no ouro do painel. A cor nunca anda sozinha — a legenda
// nomeia cada uma e o tooltip escreve o sinal.
const COR_ENTRADA = "#10b981";
const COR_SAIDA = "#f43f5e";
const COR_SALDO = "#f9c406";
const COR_EIXO = "#71717a";

interface PontoDoGrafico extends PontoDoFluxo {
  /** Saída desenhada para BAIXO da linha do zero (mesmo eixo, sem 2º eixo). */
  readonly saidaNegativa: number;
}

function ConteudoDoTooltip({
  active,
  payload,
}: {
  readonly active?: boolean;
  readonly payload?: readonly { readonly payload?: PontoDoGrafico }[];
}) {
  const ocultos = useValoresEstaoOcultos();
  const ponto = payload?.at(0)?.payload;
  if (!active || !ponto) return null;
  const valor = (v: number) => (ocultos ? "R$ ••••" : formatarBRL(v));
  return (
    <div className="pointer-events-none flex min-w-[168px] flex-col gap-1.5 rounded-xl border border-white/10 bg-zinc-950/95 px-3 py-2 text-[11px] shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <p className="font-black text-white">
        {formatarDiaPorExtenso(ponto.dia)}
      </p>
      <p className="flex justify-between gap-4 text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-sm"
            style={{ background: COR_ENTRADA }}
          />
          Entradas
        </span>
        <span className="font-bold tabular-nums text-emerald-300">
          +{valor(ponto.entradas)}
        </span>
      </p>
      <p className="flex justify-between gap-4 text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-sm"
            style={{ background: COR_SAIDA }}
          />
          Saídas
        </span>
        <span className="font-bold tabular-nums text-red-300">
          −{valor(ponto.saidas)}
        </span>
      </p>
      <p className="flex justify-between gap-4 border-t border-white/10 pt-1.5 text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-3 rounded"
            style={{ background: COR_SALDO }}
          />
          Saldo ao fim do dia
        </span>
        <span className="font-bold tabular-nums text-white">
          {ocultos ? "R$ ••••" : formatarBRL(ponto.saldo)}
        </span>
      </p>
    </div>
  );
}

/**
 * Fluxo de caixa dos últimos 30 dias em DOIS gráficos empilhados que dividem
 * o mesmo eixo X (e o mesmo cursor, via `syncId`): em cima a linha do saldo,
 * embaixo as barras de entrada (para cima) e saída (para baixo). Dois
 * gráficos e não um de dois eixos Y: o saldo vive numa escala muito maior
 * que o movimento do dia, e eixo duplo faz a leitura mentir.
 */
export function FluxoDeCaixaGrafico({
  pontos,
  carregando,
  ativo,
}: {
  readonly pontos: readonly PontoDoFluxo[];
  readonly carregando: boolean;
  readonly ativo: boolean;
}) {
  const ocultos = useValoresEstaoOcultos();
  // O ResponsiveContainer mede a largura na montagem; esperar a transição
  // da tela evita medir 0 px (mesmo cuidado do OperationalPerformanceChart).
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    if (!ativo || pronto) return;
    const timer = setTimeout(() => setPronto(true), 250);
    return () => clearTimeout(timer);
  }, [ativo, pronto]);

  const dados = useMemo<PontoDoGrafico[]>(
    () => pontos.map((p) => ({ ...p, saidaNegativa: -p.saidas })),
    [pontos],
  );
  const diasComMovimento = useMemo(
    () => pontos.filter((p) => p.entradas > 0 || p.saidas > 0),
    [pontos],
  );

  const eixoY = (
    <YAxis
      axisLine={false}
      tickLine={false}
      fontSize={9}
      width={ocultos ? 8 : 56}
      tick={ocultos ? false : { fill: COR_EIXO, fontWeight: 700 }}
      tickFormatter={(v: number) => formatarBRLCompacto(v)}
    />
  );

  if (carregando && pontos.length === 0) {
    return <Skeleton className="h-[300px] w-full rounded-2xl bg-white/5" />;
  }
  if (diasComMovimento.length === 0) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 text-center">
        <ChartColumn aria-hidden="true" className="size-6 text-admin-gold/40" />
        <p className="text-xs text-zinc-500">
          Nenhum dinheiro entrou ou saiu nos últimos 30 dias.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-zinc-400">
        <li className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: COR_ENTRADA }}
          />
          Entradas
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: COR_SAIDA }}
          />
          Saídas
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded"
            style={{ background: COR_SALDO }}
          />
          Saldo ao fim do dia
        </li>
      </ul>

      {pronto ? (
        <div
          role="img"
          aria-label="Gráfico do fluxo de caixa dos últimos 30 dias. A tabela logo abaixo tem os mesmos números."
          className="flex flex-col"
        >
          <div className="h-[110px] w-full min-w-0">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              debounce={150}
            >
              <AreaChart
                data={dados}
                syncId="fin-fluxo"
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="fin-saldo" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={COR_SALDO}
                      stopOpacity={0.18}
                    />
                    <stop offset="95%" stopColor={COR_SALDO} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#ffffff"
                  strokeOpacity={0.04}
                />
                <XAxis dataKey="dia" hide />
                {eixoY}
                <Tooltip
                  content={<ConteudoDoTooltip />}
                  cursor={{
                    stroke: "rgba(255,255,255,0.15)",
                    strokeDasharray: "4 4",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="saldo"
                  stroke={COR_SALDO}
                  strokeWidth={2}
                  fill="url(#fin-saldo)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: COR_SALDO,
                    stroke: "#09090b",
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[170px] w-full min-w-0">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              debounce={150}
            >
              <BarChart
                data={dados}
                syncId="fin-fluxo"
                stackOffset="sign"
                barCategoryGap={2}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#ffffff"
                  strokeOpacity={0.04}
                />
                <XAxis
                  dataKey="dia"
                  axisLine={false}
                  tickLine={false}
                  fontSize={9}
                  minTickGap={16}
                  tick={{ fill: COR_EIXO, fontWeight: 700 }}
                  tickFormatter={(dia: string) => formatarDataCurta(dia)}
                  dy={6}
                />
                {eixoY}
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Tooltip
                  content={<ConteudoDoTooltip />}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar
                  dataKey="entradas"
                  stackId="fluxo"
                  fill={COR_ENTRADA}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="saidaNegativa"
                  stackId="fluxo"
                  fill={COR_SAIDA}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <Skeleton className="h-[280px] w-full rounded-2xl bg-white/5" />
      )}

      <details className="group rounded-xl border border-white/5 bg-white/[0.02]">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 text-xs font-bold text-zinc-400 hover:text-white">
          Ver os números em tabela
        </summary>
        <div className="max-h-72 overflow-y-auto px-2 pb-2">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="sticky top-0 bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th scope="col" className="p-2 font-black">
                  Dia
                </th>
                <th scope="col" className="p-2 text-right font-black">
                  Entradas
                </th>
                <th scope="col" className="p-2 text-right font-black">
                  Saídas
                </th>
                <th scope="col" className="p-2 text-right font-black">
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[...diasComMovimento].reverse().map((p) => (
                <tr key={p.dia}>
                  <td className="p-2 text-zinc-300">
                    {formatarDataCurta(p.dia)}
                  </td>
                  <td className="p-2 text-right text-emerald-300">
                    <Dinheiro valor={p.entradas} sentido={1} />
                  </td>
                  <td className="p-2 text-right text-red-300">
                    <Dinheiro valor={p.saidas} sentido={-1} />
                  </td>
                  <td className="p-2 text-right text-white">
                    <Dinheiro valor={p.saldo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
