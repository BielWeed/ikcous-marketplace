import {
  completarSerieDe14Dias,
  diaEmSaoPaulo,
  formatarData,
  formatarMoeda,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { PontoDaSerieDiaria } from "@/types/painel";
import { type PointerEvent, useState } from "react";

const MESES_ABREVIADOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

type AncoragemDoRotulo = "esquerda" | "centro" | "direita";

/**
 * O rótulo do valor do pico é bem mais largo que uma coluna (~24px) e
 * cresce para os dois lados quando centralizado — o que estoura a borda do
 * cartão quando o pico cai numa das primeiras/últimas colunas (achado do
 * Gabriel: "hoje", a última coluna, é o caso mais comum). Perto da borda o
 * rótulo ancora para o lado de DENTRO do cartão (onde sobra coluna); só no
 * meio, com coluna sobrando dos dois lados, ele fica centralizado de
 * verdade — `left-1/2 -translate-x-1/2` (não `inset-x-0 text-center`: essa
 * combinação limita a CAIXA à largura da coluna, e um texto mais largo que
 * a caixa saía alinhado ao início dela, não centralizado na tela).
 */
function ancoragemDoRotulo(indice: number, total: number): AncoragemDoRotulo {
  if (indice <= 3) return "esquerda";
  if (indice >= total - 4) return "direita";
  return "centro";
}

/**
 * Minigráfico de barras dos últimos 14 dias (receita por dia). Pedido do
 * Gabriel (27/09/2026): "não tem clareza: tem que dar para entender cada
 * barra de cada dia" — com poucas vendas o gráfico virava um bloco cinza
 * quase invisível (13 riscos de 1px, só o 1º/último rótulo). Agora:
 *
 * - `completarSerieDe14Dias` (src/lib/crm.ts) garante as 14 COLUNAS sempre,
 *   mesmo se a série chegar menor — cada dia tem seu "trilho" de fundo, e um
 *   dia sem venda nunca some nem vira uma barra;
 * - as 14 colunas mostram o número do dia SEMPRE (mês só na 1ª/na virada,
 *   linha reservada em toda coluna para a fileira de dias não desalinhar),
 *   Hoje sai escrito por extenso e no dourado do painel;
 * - venda em tom esmeralda (mesmo tom de "ótimo" do CRM), hoje em
 *   admin-gold; tocar/passar numa coluna marca ela — as barras das OUTRAS
 *   colunas esmaecem (opacity-40) para o destaque não depender só do trilho,
 *   que uma barra em 100% de altura cobre por inteiro — e mostra o dia +
 *   valor na linha de cima; a barra de maior valor ganha o rótulo do valor
 *   em cima, para dar escala.
 *
 * HTML puro (sem recharts): 14 barras não pedem biblioteca, e o Início abre
 * mais leve. A tabela escondida dá o mesmo dado a quem usa leitor de tela.
 */
export function SerieDe14Dias({
  serie,
  carregando,
}: Readonly<{ serie: readonly PontoDaSerieDiaria[]; carregando: boolean }>) {
  const [marcado, setMarcado] = useState<number | null>(null);
  const serieCompleta = completarSerieDe14Dias(serie);
  const total = serieCompleta.reduce((soma, ponto) => soma + ponto.receita, 0);
  const maximo = serieCompleta.reduce(
    (maior, ponto) => Math.max(maior, ponto.receita),
    0,
  );
  const indicePico =
    maximo > 0 ? serieCompleta.findIndex((p) => p.receita === maximo) : -1;
  const ancoragemDoRotuloDoPico =
    indicePico >= 0
      ? ancoragemDoRotulo(indicePico, serieCompleta.length)
      : "centro";
  const pontoMarcado =
    marcado == null ? null : (serieCompleta.at(marcado) ?? null);
  const diaDeHoje = diaEmSaoPaulo(new Date());

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
          ) : serieCompleta.length > 0 ? (
            <>
              Total{" "}
              <strong className="font-bold tabular-nums text-white">
                {formatarMoeda(total)}
              </strong>
            </>
          ) : null}
        </p>
      </div>

      {carregando && serieCompleta.length === 0 ? (
        <div
          className="premium-shimmer mt-4 h-28 w-full rounded-xl"
          aria-hidden="true"
        />
      ) : serieCompleta.length === 0 ? (
        <p className="mt-4 flex h-24 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-zinc-500">
          Sem vendas registradas nos últimos 14 dias.
        </p>
      ) : (
        <>
          <div
            data-testid="serie-14d-barras"
            className="mt-6 flex touch-pan-y gap-0.5"
            onPointerMove={aoMoverPonteiro}
            onPointerDown={aoMoverPonteiro}
            onPointerLeave={() => setMarcado(null)}
            aria-hidden="true"
          >
            {serieCompleta.map((ponto, indice) => {
              const hoje = ponto.dia === diaDeHoje;
              const temVenda = ponto.receita > 0;
              const alturaPct = maximo > 0 ? (ponto.receita / maximo) * 100 : 0;
              const [, mesTexto, diaTexto] = ponto.dia.split("-");
              const mesAnterior =
                indice > 0 ? serieCompleta[indice - 1].dia.split("-")[1] : null;
              const mostrarMes = indice === 0 || mesTexto !== mesAnterior;
              // As 14 colunas mostram o rótulo do dia SEMPRE (pedido do
              // Gabriel: "cada barra de cada dia") — a folga medida a 375px
              // e até a 320px é positiva, então nada de alternar dia
              // sim/dia não; se algum dia isso apertar de verdade num
              // celular menor, é a fonte do rótulo que cede, não a
              // presença dele.
              const outraColunaMarcada = marcado != null && marcado !== indice;
              return (
                <div
                  key={ponto.dia}
                  data-testid="serie-14d-coluna"
                  data-dia={ponto.dia}
                  data-hoje={hoje ? "true" : "false"}
                  data-com-venda={temVenda ? "true" : "false"}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                >
                  <div className="relative flex h-24 w-full items-end overflow-visible">
                    {indice === indicePico ? (
                      <span
                        data-testid="serie-14d-pico"
                        className={cn(
                          "pointer-events-none absolute -top-4 whitespace-nowrap text-[9px] font-bold tabular-nums text-zinc-400",
                          // O rótulo é bem mais largo que uma coluna
                          // (~24px): centralizado, ele estoura a borda do
                          // cartão quando o pico é uma das últimas colunas
                          // (achado do Gabriel — "hoje" é o caso mais
                          // comum). Perto do INÍCIO da janela ele cresce
                          // para a direita (left-0, sem right-0: sobra
                          // coluna à direita); perto do FIM cresce para a
                          // esquerda (right-0, sem left-0); no meio sobra
                          // cartão dos dois lados e ele fica centralizado
                          // de verdade com `left-1/2 -translate-x-1/2`
                          // (`inset-x-0 text-center` prendia a caixa à
                          // largura da coluna e o texto saía alinhado ao
                          // início dela, não centralizado na tela).
                          ancoragemDoRotuloDoPico === "esquerda" &&
                            "left-0 text-left",
                          ancoragemDoRotuloDoPico === "direita" &&
                            "right-0 text-right",
                          ancoragemDoRotuloDoPico === "centro" &&
                            "left-1/2 -translate-x-1/2",
                        )}
                      >
                        {formatarMoeda(ponto.receita)}
                      </span>
                    ) : null}
                    {/* Trilho + barra ficam num wrapper à parte porque só
                        ELES esmaecem quando outra coluna está marcada — o
                        texto (rótulo do pico, dia, mês) nunca perde
                        contraste por causa de um toque em outro lugar. */}
                    <div
                      data-testid="serie-14d-grafico"
                      className={cn(
                        "absolute inset-0 flex items-end transition-opacity",
                        outraColunaMarcada && "opacity-40",
                      )}
                    >
                      {/* Trilho: SEMPRE visível, ocupa a altura inteira da
                          coluna — é o que faz um dia sem venda continuar
                          sendo uma coluna (não sumir). Opacidade baixa e
                          altura fixa o distinguem de uma barra de venda
                          (cor cheia, altura proporcional ao valor). */}
                      <div
                        className={cn(
                          "absolute inset-x-0 bottom-0 h-full rounded-[4px] bg-zinc-800/50",
                          marcado === indice && "bg-zinc-700/60",
                          hoje && "ring-1 ring-inset ring-admin-gold/40",
                        )}
                      />
                      {temVenda ? (
                        <div
                          data-testid="serie-14d-barra"
                          className={cn(
                            "relative w-full rounded-t-[4px] transition-[height]",
                            hoje ? "bg-admin-gold" : "bg-emerald-400",
                          )}
                          style={{ height: `${Math.max(6, alturaPct)}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                  <div
                    data-testid="serie-14d-rotulo"
                    className="flex flex-col items-center gap-0.5 text-center"
                  >
                    {/* A linha do mês é reservada em TODAS as colunas (só
                        fica invisível fora da 1ª/virada) — sem isto, as
                        colunas sem mês tinham uma linha a menos e o número
                        do dia descia, desalinhando a fileira toda. */}
                    <span
                      data-testid="serie-14d-rotulo-mes"
                      aria-hidden="true"
                      className={cn(
                        "text-[9px] uppercase leading-none text-zinc-400",
                        !mostrarMes && "invisible",
                      )}
                    >
                      {MESES_ABREVIADOS[Number(mesTexto) - 1]}
                    </span>
                    <span
                      data-testid="serie-14d-rotulo-dia"
                      className={cn(
                        "text-[10px] leading-none tabular-nums",
                        hoje ? "font-bold text-admin-gold" : "text-zinc-400",
                      )}
                    >
                      {hoje ? "Hoje" : diaTexto}
                    </span>
                  </div>
                </div>
              );
            })}
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
              {serieCompleta.map((ponto) => (
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
