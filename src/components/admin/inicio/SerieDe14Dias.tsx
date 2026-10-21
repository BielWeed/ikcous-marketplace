import { useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import { completarSerieDe14Dias, formatarData, formatarMoeda } from "@/lib/crm";
import { type TomDeEstado, classeDoPonto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { PontoDaSerieDiaria } from "@/types/painel";
import { Check, ChevronLeft, ChevronRight, List } from "lucide-react";
import { type PointerEvent, useId, useState } from "react";
import { BOTAO_INICIO, FalhaDoInicio, VALOR_INICIO } from "./visualDoInicio";

const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const dataCurta = (dia: string) =>
  DATA_CURTA.format(new Date(`${dia}T12:00:00Z`))
    .replace(" de ", " ")
    .replace(".", "");

/**
 * HTML puro: a série dos 14 dias, escolhida por toque, setas e tabela. Mora
 * dentro do cartão "Este mês": barras neutras e só o último dia na cor do
 * resultado do mês (`tomDoUltimoDia`: verde, ou vermelho se for prejuízo).
 */
export function SerieDe14Dias({
  serie,
  carregando,
  falhou = false,
  onTentarDeNovo,
  tomDoUltimoDia = "positivo",
}: Readonly<{
  serie: readonly PontoDaSerieDiaria[];
  carregando: boolean;
  falhou?: boolean;
  onTentarDeNovo?: () => void;
  tomDoUltimoDia?: TomDeEstado;
}>) {
  const [marcado, setMarcado] = useState<number | null>(null);
  const [tabelaAberta, setTabelaAberta] = useState(false);
  const tabelaId = useId();
  const serieCompleta = completarSerieDe14Dias(serie);
  const total = serieCompleta.reduce((soma, ponto) => soma + ponto.receita, 0);
  const maximo = serieCompleta.reduce(
    (maior, ponto) => Math.max(maior, ponto.receita),
    0,
  );
  const indicePico =
    maximo > 0 ? serieCompleta.findIndex((p) => p.receita === maximo) : -1;
  const selecionado = Math.min(
    marcado ?? serieCompleta.length - 1,
    serieCompleta.length - 1,
  );
  const pontoMarcado = serieCompleta.at(selecionado);
  const diaDeHoje = useDiaDeSaoPaulo();

  const aoMoverPonteiro = (evento: PointerEvent<HTMLDivElement>) => {
    if (serieCompleta.length === 0) return;
    const caixa = evento.currentTarget.getBoundingClientRect();
    if (caixa.width <= 0) return;
    const fracao = (evento.clientX - caixa.left) / caixa.width;
    const indice = Math.min(
      serieCompleta.length - 1,
      Math.max(0, Math.floor(fracao * serieCompleta.length)),
    );
    setMarcado(indice);
  };

  return (
    <section
      aria-labelledby="inicio-serie-titulo"
      aria-busy={carregando && serieCompleta.length === 0}
      className="min-w-0 border-t border-admin-border pt-3"
    >
      <h3
        id="inicio-serie-titulo"
        className="mb-2 text-sm font-medium text-zinc-400"
      >
        Últimos 14 dias
        <span className="sr-only"> · vendas pagas por dia</span>
      </h3>
      {carregando && serieCompleta.length === 0 ? (
        <div>
          <div className="premium-shimmer h-24 rounded-xl" aria-hidden="true" />
          <p className="mt-3 text-sm text-zinc-400">Carregando as vendas…</p>
        </div>
      ) : serieCompleta.length === 0 ? (
        falhou ? (
          <FalhaDoInicio onTentarDeNovo={onTentarDeNovo}>
            <p>Não consegui carregar as vendas dos últimos 14 dias.</p>
            <p aria-live="polite">—</p>
          </FalhaDoInicio>
        ) : (
          <div>
            <p className="text-base font-semibold text-white">
              Sem vendas registradas nos últimos 14 dias.
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Os pagamentos confirmados aparecem aqui.
            </p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Dia anterior"
              disabled={selecionado <= 0}
              onClick={() => setMarcado(selecionado - 1)}
              className={`${BOTAO_INICIO} !w-11 min-w-11 shrink-0 !px-0`}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <p
              aria-live="polite"
              aria-atomic="true"
              className="min-w-0 flex-1 text-center"
            >
              <span className="block text-sm font-semibold text-zinc-300">
                {formatarData(pontoMarcado?.dia)}
                {pontoMarcado?.dia === diaDeHoje ? " · Hoje" : ""}
              </span>
              <strong className={`mt-1 block text-xl ${VALOR_INICIO}`}>
                {formatarMoeda(pontoMarcado?.receita)}
              </strong>
            </p>
            <button
              type="button"
              aria-label="Próximo dia"
              disabled={selecionado >= serieCompleta.length - 1}
              onClick={() => setMarcado(selecionado + 1)}
              className={`${BOTAO_INICIO} !w-11 min-w-11 shrink-0 !px-0`}
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div
            data-testid="serie-14d-barras"
            className="flex touch-pan-y gap-1"
            onPointerMove={aoMoverPonteiro}
            onPointerDown={aoMoverPonteiro}
            aria-hidden="true"
          >
            {serieCompleta.map((ponto, indice) => {
              const hoje = ponto.dia === diaDeHoje;
              const temVenda = ponto.receita > 0;
              const alturaPct = maximo > 0 ? (ponto.receita / maximo) * 100 : 0;
              return (
                <div
                  key={ponto.dia}
                  data-testid="serie-14d-coluna"
                  data-dia={ponto.dia}
                  data-hoje={hoje ? "true" : "false"}
                  data-com-venda={temVenda ? "true" : "false"}
                  data-selecionado={indice === selecionado ? "true" : "false"}
                  className="min-w-0 flex-1"
                  title={`${formatarData(ponto.dia)}: ${formatarMoeda(ponto.receita)}`}
                >
                  <div
                    data-testid="serie-14d-grafico"
                    className="relative flex h-24 items-end rounded bg-white/[0.02]"
                  >
                    {temVenda ? (
                      <div
                        data-testid="serie-14d-barra"
                        className={cn(
                          "w-full rounded-t-[5px]",
                          indice === serieCompleta.length - 1
                            ? classeDoPonto(tomDoUltimoDia)
                            : indice === selecionado
                              ? "bg-zinc-300"
                              : "bg-zinc-600",
                        )}
                        style={{ height: `${Math.max(6, alturaPct)}%` }}
                      />
                    ) : null}
                    {indice === selecionado ? (
                      <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-zinc-300" />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="flex justify-between gap-3 text-xs text-zinc-400"
            aria-hidden="true"
          >
            <span>{dataCurta(serieCompleta[0].dia)}</span>
            <span>
              {dataCurta(serieCompleta[serieCompleta.length - 1].dia)}
              {serieCompleta[serieCompleta.length - 1].dia === diaDeHoje
                ? " · Hoje"
                : ""}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-400">
            Deslize no gráfico ou use as setas para escolher um dia.
          </p>
          <dl className="grid grid-cols-2 gap-3 border-t border-admin-border pt-3">
            <div className="min-w-0">
              <dt className="text-xs text-zinc-400">
                Pico
                {indicePico >= 0
                  ? ` · ${dataCurta(serieCompleta.at(indicePico)?.dia ?? "")}`
                  : ""}
              </dt>
              <dd
                data-testid="serie-14d-pico"
                className={`mt-1 text-sm ${VALOR_INICIO}`}
              >
                {formatarMoeda(maximo)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-zinc-400">Total · 14 dias</dt>
              <dd className={`mt-1 text-sm ${VALOR_INICIO}`}>
                {formatarMoeda(total)}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className={BOTAO_INICIO}
            aria-expanded={tabelaAberta}
            aria-controls={tabelaId}
            onClick={() => setTabelaAberta((aberta) => !aberta)}
          >
            <List className="size-5" aria-hidden="true" />
            {tabelaAberta ? "Esconder tabela" : "Ver os 14 dias em tabela"}
          </button>
          {/* A tabela fechada é sr-only (posição absoluta): o recorte do envoltório
              impede que o conteúdo dela crie rolagem lateral em tela estreita. */}
          <div className="relative overflow-hidden">
            <table
              id={tabelaId}
              className={
                tabelaAberta
                  ? "w-full table-fixed border-separate border-spacing-y-2 text-sm"
                  : "sr-only"
              }
            >
              <caption className="text-left font-semibold text-white">
                Vendas pagas por dia nos últimos 14 dias
              </caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Dia</th>
                  <th scope="col">Vendas pagas</th>
                </tr>
              </thead>
              <tbody>
                {serieCompleta.map((ponto, indice) => (
                  <tr
                    key={ponto.dia}
                    className={
                      indice === selecionado
                        ? "bg-white/[0.12]"
                        : "bg-white/[0.03]"
                    }
                  >
                    <td className="rounded-l-xl p-2 text-zinc-400">
                      {tabelaAberta ? (
                        <button
                          type="button"
                          aria-label={`Selecionar ${formatarData(ponto.dia)}${ponto.dia === diaDeHoje ? " · Hoje" : ""}`}
                          aria-pressed={indice === selecionado}
                          onClick={() => setMarcado(indice)}
                          className="flex min-h-11 w-full items-center gap-1 text-left text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                        >
                          <span data-testid="serie-14d-rotulo">
                            <span
                              data-testid="serie-14d-rotulo-dia"
                              className={
                                ponto.dia === diaDeHoje
                                  ? "text-[12px] font-bold text-white"
                                  : "text-[12px] text-zinc-400"
                              }
                            >
                              {ponto.dia === diaDeHoje
                                ? "Hoje"
                                : ponto.dia.slice(8, 10)}
                            </span>{" "}
                            <span
                              data-testid="serie-14d-rotulo-mes"
                              className="text-[12px] text-zinc-400"
                            >
                              {dataCurta(ponto.dia).split(" ")[1]}
                            </span>
                          </span>
                          {indice === selecionado ? (
                            <Check
                              className="size-4 shrink-0"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      ) : (
                        <>
                          {formatarData(ponto.dia)}
                          {ponto.dia === diaDeHoje ? " · Hoje" : ""}
                        </>
                      )}
                    </td>
                    <td
                      className={`rounded-r-xl p-2 text-right ${VALOR_INICIO}`}
                    >
                      {formatarMoeda(ponto.receita)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
