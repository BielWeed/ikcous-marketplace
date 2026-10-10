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
  formatarBRLComSinal,
  formatarBRLCompacto,
  formatarDataCurta,
  formatarDiaPorExtenso,
  paraCentavos,
} from "@/lib/financeiro";
import type { DataIso } from "@/types/financeiro";
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

/**
 * Saldo com sinal, respeitando o "olho" que esconde valores — usada no
 * balão e no painel que substitui o AreaChart quando não há o que desenhar
 * (ver `semLinhaDeSaldo` mais abaixo). Achado do Gabriel: nunca
 * `formatarBRL` puro aqui — ele devolve sempre o valor ABSOLUTO (certo para
 * entradas/saídas, que nunca são negativas; errado para saldo, que pode ser
 * negativo). `formatarBRLComSinal` só quando negativo: nunca um "+" na
 * frente de saldo positivo.
 */
function formatarSaldoComSinal(valor: number, ocultos: boolean): string {
  if (ocultos) return "R$ ••••";
  return valor < 0 ? formatarBRLComSinal(valor) : formatarBRL(valor);
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
    <div
      data-testid="fluxo-tooltip"
      className="pointer-events-none flex min-w-[168px] flex-col gap-1.5 rounded-xl border border-white/10 bg-zinc-950/95 px-3 py-2 text-[11px] shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
    >
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
        {ponto.saldo === null ? (
          // Achado do coordenador: dia ANTES do marco do saldo inicial — a
          // reconstrução "hoje − Σ depois" não é válida aí (fin__saldos só
          // conta movimento com `data >= saldo_inicial_em`). Nunca inventar
          // um número; "—" é a resposta honesta.
          <span className="text-right font-bold text-zinc-400">
            — <span className="font-normal">antes do saldo inicial</span>
          </span>
        ) : (
          <span
            className={`font-bold tabular-nums ${ponto.saldo < 0 ? "text-red-300" : "text-white"}`}
          >
            {formatarSaldoComSinal(ponto.saldo, ocultos)}
          </span>
        )}
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
 *
 * Só o gráfico de BAIXO mostra o balão do tooltip (Pedido do Gabriel,
 * 27/09/2026: com um `<Tooltip content={<ConteudoDoTooltip/>}>` em cada
 * gráfico, o `syncId` ativa os dois ao mesmo tempo — dois balões iguais, um
 * em cima do outro). O de cima mantém seu `<Tooltip>` (sem ele o
 * `activeDot` da linha do saldo não acende — depende de o recharts achar um
 * `Tooltip` entre os filhos) só com `content={() => null}`: o cursor
 * tracejado continua sincronizado nos dois, mas o balão nasce uma vez só.
 *
 * `pontos[i].saldo` pode ser `null` (dia antes do marco do saldo inicial —
 * ver `marcoDoSaldoInicial`/`serieDoFluxoDeCaixa` em src/lib/financeiro.ts):
 * a linha do saldo não é desenhada aí, o balão mostra "—" em vez de um
 * número, e a nota abaixo do gráfico explica a partir de quando o saldo
 * existe.
 */
export function FluxoDeCaixaGrafico({
  pontos,
  carregando,
  ativo,
  marco,
}: {
  readonly pontos: readonly PontoDoFluxo[];
  readonly carregando: boolean;
  readonly ativo: boolean;
  /**
   * Maior `saldoInicialEm` entre as contas ativas (`marcoDoSaldoInicial`,
   * src/lib/financeiro.ts) — dias de `pontos` antes dele já chegam com
   * `saldo: null`; este valor só serve para a NOTA escrever a data por
   * extenso (inclusive quando o marco cai fora da janela e nenhum ponto
   * "conhece" a data). `null` = sem marco (contas ainda carregando, erro na
   * 1ª busca, ou nenhuma conta ativa com saldo inicial informado) — a tela
   * não teve motivo para cortar nada, comportamento de sempre.
   */
  readonly marco: DataIso | null;
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
  // Achado da revisão independente: com o marco perto de hoje (bem provável
  // na loja real — as contas de sistema nascem com `saldoInicialEm` = o dia
  // em que a migration rodou), quase todo dia da janela fica com `saldo:
  // null`. Um AreaChart com 0 ou 1 ponto de saldo VERDADEIRO desenha um eixo
  // Y sem sentido (recharts inventa uma escala pro domínio de largura zero —
  // "R$ 1, R$ 2, R$ 3, R$ 4") e nenhuma linha. Com menos de 2 pontos
  // conhecidos, nem tentamos desenhar: um texto curto substitui o painel.
  const pontosComSaldo = useMemo(
    () => pontos.filter((p) => p.saldo !== null),
    [pontos],
  );
  const poucosPontosDeSaldo = pontosComSaldo.length < 2;
  // Segundo achado da mesma revisão: mesmo com 2+ pontos, se TODOS tiverem o
  // saldo igual (marco perto de hoje e nenhum movimento desde então — bem
  // comum: a loja acabou de configurar a conta e ainda não vendeu de novo),
  // o AreaChart desenha uma linha reta sobre um domínio de largura zero — o
  // mesmo eixo Y sem sentido do caso de poucos pontos, só que com uma linha
  // (e um "toco" na borda) em vez de nada. Uma reta não diz nada que a
  // própria frase não diga melhor.
  const saldoConstante = useMemo(() => {
    if (poucosPontosDeSaldo) return null;
    const primeiro = pontosComSaldo[0].saldo!;
    const primeiroEmCentavos = paraCentavos(primeiro);
    const todosIguais = pontosComSaldo.every(
      (p) => paraCentavos(p.saldo!) === primeiroEmCentavos,
    );
    return todosIguais ? primeiro : null;
  }, [pontosComSaldo, poucosPontosDeSaldo]);
  const semLinhaDeSaldo = poucosPontosDeSaldo || saldoConstante !== null;

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
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-400">
            Saldo
          </p>
          {semLinhaDeSaldo ? (
            <div className="flex min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/10 px-3 py-2 text-center">
              {poucosPontosDeSaldo ? (
                <>
                  <p className="text-[11px] text-zinc-400">
                    {marco
                      ? `O saldo aparece aqui a partir de ${formatarDataCurta(marco)}, data do saldo inicial das contas.`
                      : "Ainda não há saldo suficiente nesta janela para desenhar a linha."}
                  </p>
                  {pontosComSaldo.length === 1 ? (
                    <p className="text-[11px] font-bold text-white">
                      Saldo de hoje:{" "}
                      {formatarSaldoComSinal(pontosComSaldo[0].saldo!, ocultos)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[11px] font-bold text-white">
                  Saldo sem mudança desde{" "}
                  {formatarDataCurta(pontosComSaldo[0].dia)}:{" "}
                  {formatarSaldoComSinal(saldoConstante!, ocultos)}
                </p>
              )}
            </div>
          ) : (
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
                      <stop
                        offset="95%"
                        stopColor={COR_SALDO}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="#ffffff"
                    strokeOpacity={0.04}
                  />
                  <XAxis dataKey="dia" hide />
                  {eixoY}
                  {/* Sem balão aqui — só o cursor tracejado, sincronizado com
                      o gráfico de baixo pelo `syncId`. O balão de verdade é
                      renderizado uma vez só, no `<Tooltip>` do BarChart. */}
                  <Tooltip
                    content={() => null}
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
                    // Dia antes do marco do saldo inicial chega com `saldo:
                    // null` (achado do coordenador) — `connectNulls={false}`
                    // (explícito, já é o padrão do recharts) deixa a linha
                    // NASCER a partir do marco, em vez de "inventar" um
                    // trecho ligando o último dia sem saldo conhecido ao
                    // primeiro com saldo de verdade.
                    connectNulls={false}
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
          )}

          {/* Linha + rótulo entre os dois painéis: sem isto, o fim do eixo
              de cima ("−R$ 150") ficava colado no começo do eixo de baixo
              ("R$ 200") — dois painéis com escalas independentes, fáceis de
              ler como um só. */}
          <div className="my-1.5 h-px w-full bg-white/5" />
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-zinc-400">
            Entradas e saídas
          </p>
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
      {marco && pontos.some((p) => p.saldo === null) ? (
        <p className="text-[11px] text-zinc-400">
          {semLinhaDeSaldo ? (
            // O painel que substitui o AreaChart (acima) já diz "a partir de
            // DD/MM" (ou "sem mudança desde DD/MM") — repetir aqui seria a
            // MESMA informação duas vezes na tela; só a dica de ação fica de
            // pé.
            "Ajuste o saldo inicial em Contas e categorias para ver o saldo de dias anteriores."
          ) : (
            <>
              O saldo só aparece a partir de {formatarDataCurta(marco)}, data do
              saldo inicial das contas. Para ver antes disso, ajuste o saldo
              inicial em Contas e categorias.
            </>
          )}
        </p>
      ) : null}

      <details className="group rounded-xl border border-white/5 bg-white/[0.02]">
        <summary className="flex min-h-11 cursor-pointer select-none items-center px-4 text-xs font-bold text-zinc-400 hover:text-white">
          Ver os números em tabela
        </summary>
        <div className="max-h-72 overflow-y-auto px-2 pb-2">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="sticky top-0 bg-zinc-950 text-[11px] uppercase tracking-wider text-zinc-500">
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
                    {p.saldo === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <Dinheiro valor={p.saldo} />
                    )}
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
