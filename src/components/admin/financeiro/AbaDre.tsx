import { ChevronRight, FileText } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { useDreFinanceira, useDreMensal } from "@/hooks/useFinanceiro";
import {
  type ChaveDaDre,
  type LinhaDaCascata,
  cascataDaDre,
  formatarPercentual,
  mesesDoIntervalo,
  percentualDaReceita,
  sublinhasDaDre,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type { DreFinanceira, IntervaloDeDatas } from "@/types/financeiro";
import {
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Segmentado,
} from "./partes";
import {
  AVISO_CUSTO_ESTIMADO,
  AvisoDeCustoEstimado,
  EsqueletoDoResultado,
  QuadroDoResultado,
  classeDoValorNaTabela,
  corDoResultado,
} from "./partesDoResultado";

type ModoDaDre = "periodo" | "mensal";

const MAXIMO_DE_MESES = 12;

function RotuloDaLinha({
  linha,
  dre,
  aberta,
  aoAlternar,
}: {
  readonly linha: LinhaDaCascata;
  readonly dre: DreFinanceira;
  readonly aberta: boolean;
  readonly aoAlternar: (chave: ChaveDaDre) => void;
}) {
  const expansivel = sublinhasDaDre(dre, linha.chave).length > 0;
  const estimado = linha.chave === "cmv" && dre.cmvEstimado;
  const texto = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{linha.rotulo}</span>
      {estimado ? <AvisoDeCustoEstimado /> : null}
    </span>
  );
  if (!expansivel) {
    return (
      <span className={cn("block py-2.5", !linha.final && "pl-6")}>
        {texto}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={aberta}
      onClick={() => aoAlternar(linha.chave)}
      className="-ml-1 flex min-h-11 w-full items-center gap-1 rounded-lg px-1 text-left hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 text-zinc-400 transition-transform",
          aberta && "rotate-90",
        )}
      />
      {texto}
    </button>
  );
}

function corDaLinha(chave: ChaveDaDre, valor: number): string {
  return chave === "lucro_bruto" ||
    chave === "margem_contribuicao" ||
    chave === "resultado_operacional" ||
    chave === "resultado_financeiro" ||
    chave === "lucro_liquido"
    ? corDoResultado(valor)
    : "text-white";
}

/** Só o mês a mês usa: subtotal com fundo e o lucro líquido com traço forte. */
function classeDaLinhaMensal(linha: LinhaDaCascata): string {
  if (linha.final) {
    return "border-t-2 border-admin-border-strong bg-admin-raised";
  }
  if (linha.subtotal) return "border-t border-admin-border bg-admin-raised";
  return "";
}

/** Divisória fina entre as linhas da tabela (menos a primeira). */
const DIVISORIA = "border-t border-solid border-admin-border";

/** Caixa do lucro líquido (as pontas arredondadas vêm da primeira e da última célula). */
const CAIXA_DO_LUCRO =
  "border-y border-solid border-admin-border-strong bg-admin-raised";

const CABECALHO_DA_TABELA =
  "border-b border-solid border-admin-border py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400";

/**
 * A demonstração do período, em três colunas (linha, valor, % da receita
 * líquida) em qualquer largura de tela. O lucro líquido, última linha, fica
 * numa caixa própria: por isso a tabela separa as bordas (`border-separate`) e
 * as divisórias moram nas células.
 */
function TabelaDoPeriodo({
  dre,
  abertas,
  aoAlternar,
}: {
  readonly dre: DreFinanceira;
  readonly abertas: ReadonlySet<ChaveDaDre>;
  readonly aoAlternar: (chave: ChaveDaDre) => void;
}) {
  const cascata = cascataDaDre(dre);
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <caption className="sr-only">
        Demonstração do resultado do período, com o percentual de cada linha
        sobre a receita líquida
      </caption>
      <thead>
        <tr>
          <th scope="col" className={cn(CABECALHO_DA_TABELA, "text-left")}>
            Linha
          </th>
          <th
            scope="col"
            className={cn(CABECALHO_DA_TABELA, "pl-2 text-right")}
          >
            Valor
          </th>
          <th
            scope="col"
            className={cn(CABECALHO_DA_TABELA, "w-14 pl-2 text-right")}
          >
            % rec. líq.
          </th>
        </tr>
      </thead>
      <tbody>
        {cascata.map((linha, indice) => {
          const aberta = abertas.has(linha.chave);
          const sublinhas = aberta ? sublinhasDaDre(dre, linha.chave) : [];
          const divisoria = indice > 0 && !linha.final ? DIVISORIA : "";
          return (
            <Fragment key={linha.chave}>
              {linha.final ? (
                <tr data-respiro-do-lucro="">
                  <td colSpan={3} className="h-3 p-0" />
                </tr>
              ) : null}
              <tr
                data-linha-dre={linha.chave}
                data-linha-final={linha.final ? "" : undefined}
                className={
                  linha.subtotal ? "font-bold text-white" : "text-zinc-300"
                }
              >
                <th
                  scope="row"
                  className={cn(
                    "break-words pr-2 text-left font-[inherit]",
                    divisoria,
                    linha.final &&
                      cn(CAIXA_DO_LUCRO, "rounded-l-2xl border-l pl-4"),
                  )}
                >
                  <RotuloDaLinha
                    linha={linha}
                    dre={dre}
                    aberta={aberta}
                    aoAlternar={aoAlternar}
                  />
                </th>
                <td
                  className={cn(
                    "whitespace-nowrap py-2 pl-2 text-right align-middle",
                    divisoria,
                    linha.final && CAIXA_DO_LUCRO,
                  )}
                >
                  <Dinheiro
                    valor={linha.valor}
                    className={cn(
                      classeDoValorNaTabela(linha.valor, linha.final),
                      corDaLinha(linha.chave, linha.valor),
                    )}
                  />
                </td>
                <td
                  className={cn(
                    "w-14 whitespace-nowrap py-2 pl-2 text-right align-middle text-xs font-normal tabular-nums text-zinc-400",
                    divisoria,
                    linha.final &&
                      cn(
                        CAIXA_DO_LUCRO,
                        "rounded-r-2xl border-r pr-4 text-sm font-bold text-white",
                      ),
                  )}
                >
                  {formatarPercentual(
                    percentualDaReceita(linha.valor, dre.receitaLiquida),
                  )}
                </td>
              </tr>
              {sublinhas.map((sub) => (
                <tr
                  key={`${linha.chave}-${sub.rotulo}`}
                  className="text-zinc-300"
                >
                  <th
                    scope="row"
                    className="break-words py-2 pl-7 pr-2 text-left text-[13px] font-normal"
                  >
                    {sub.rotulo}
                  </th>
                  <td className="whitespace-nowrap py-2 pl-2 text-right align-middle">
                    <Dinheiro
                      valor={sub.valor}
                      className={classeDoValorNaTabela(sub.valor)}
                    />
                  </td>
                  <td className="w-14 whitespace-nowrap py-2 pl-2 text-right align-middle text-xs tabular-nums text-zinc-400">
                    {formatarPercentual(
                      percentualDaReceita(sub.valor, dre.receitaLiquida),
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelaMensal({
  total,
  meses,
  rotulos,
  abertas,
  aoAlternar,
}: {
  readonly total: DreFinanceira;
  readonly meses: readonly DreFinanceira[];
  readonly rotulos: readonly string[];
  readonly abertas: ReadonlySet<ChaveDaDre>;
  readonly aoAlternar: (chave: ChaveDaDre) => void;
}) {
  const cascataTotal = cascataDaDre(total);
  const cascatas = meses.map((dre) => cascataDaDre(dre));
  const valorNoMes = (indice: number, chave: ChaveDaDre) =>
    cascatas.at(indice)?.find((l) => l.chave === chave)?.valor ?? 0;
  const colunaFixa =
    "sticky left-0 z-10 w-32 min-w-32 max-w-32 break-words border-r border-admin-border bg-admin-surface pr-3 text-left sm:w-56 sm:min-w-56 sm:max-w-56";

  return (
    <div
      className="overflow-x-auto"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- região rolável precisa de foco para o teclado rolar (axe scrollable-region-focusable)
      tabIndex={0}
      role="region"
      aria-label="Resultado mês a mês, deslize para ver os meses e o total"
    >
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">
          Demonstração do resultado mês a mês
        </caption>
        <thead>
          <tr className="text-xs uppercase tracking-[0.2em] text-zinc-400">
            <th scope="col" className={cn(colunaFixa, "py-2 font-black")}>
              Linha
            </th>
            {rotulos.map((rotulo) => (
              <th
                key={rotulo}
                scope="col"
                className="px-3 py-2 text-right font-black"
              >
                {rotulo}
              </th>
            ))}
            <th
              scope="col"
              className="px-3 py-2 text-right font-black text-white"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {cascataTotal.map((linha) => {
            const aberta = abertas.has(linha.chave);
            const nomesDasSublinhas = aberta
              ? [
                  ...new Set(
                    [total, ...meses].flatMap((dre) =>
                      sublinhasDaDre(dre, linha.chave).map((s) => s.rotulo),
                    ),
                  ),
                ]
              : [];
            return (
              <Fragment key={linha.chave}>
                <tr
                  className={cn(
                    classeDaLinhaMensal(linha),
                    linha.subtotal ? "font-bold text-white" : "text-zinc-300",
                  )}
                >
                  <th scope="row" className={cn(colunaFixa, "font-[inherit]")}>
                    <RotuloDaLinha
                      linha={linha}
                      dre={total}
                      aberta={aberta}
                      aoAlternar={aoAlternar}
                    />
                  </th>
                  {rotulos.map((rotulo, indice) => (
                    <td
                      key={rotulo}
                      className="whitespace-nowrap px-3 py-2 text-right"
                    >
                      <Dinheiro
                        valor={valorNoMes(indice, linha.chave)}
                        className={corDaLinha(
                          linha.chave,
                          valorNoMes(indice, linha.chave),
                        )}
                      />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Dinheiro
                      valor={linha.valor}
                      className={corDaLinha(linha.chave, linha.valor)}
                    />
                  </td>
                </tr>
                {nomesDasSublinhas.map((nome) => (
                  <tr
                    key={`${linha.chave}-${nome}`}
                    className="text-xs text-zinc-400"
                  >
                    <th
                      scope="row"
                      className={cn(colunaFixa, "py-1.5 pl-10 font-normal")}
                    >
                      {nome}
                    </th>
                    {meses.map((dre, indice) => (
                      <td
                        key={rotulos.at(indice) ?? indice}
                        className="whitespace-nowrap px-3 py-1.5 text-right"
                      >
                        <Dinheiro
                          valor={
                            sublinhasDaDre(dre, linha.chave).find(
                              (s) => s.rotulo === nome,
                            )?.valor ?? 0
                          }
                        />
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <Dinheiro
                        valor={
                          sublinhasDaDre(total, linha.chave).find(
                            (s) => s.rotulo === nome,
                          )?.valor ?? 0
                        }
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Aba "Resultado" (a DRE): a demonstração do resultado simplificada, por
 * competência — na tela, "mês de referência" (spec §4). No alto, o controle
 * Período / Mês a mês e quatro quadros (lucro líquido, receita líquida, lucro
 * bruto e a sobra depois dos custos da venda); embaixo, a demonstração com o %
 * da receita líquida de cada linha (análise vertical), subtotais em destaque e
 * o lucro líquido em caixa própria; linhas com categorias abrem por baixo.
 * Período com mais de um mês ganha a visão mês a mês — as colunas dos meses são
 * a ÚNICA coisa da tela que rola de lado no celular. Só desenho: nenhuma conta
 * mudou (vêm de `src/lib/financeiro.ts` e da `fin_dre`).
 */
export function AbaDre({
  ativo,
  intervalo,
  versao,
  rotuloDoPeriodo,
}: {
  readonly ativo: boolean;
  readonly intervalo: IntervaloDeDatas | null;
  readonly versao: number;
  readonly rotuloDoPeriodo: string;
}) {
  const [modo, setModo] = useState<ModoDaDre>("periodo");
  const [abertas, setAbertas] = useState<ReadonlySet<ChaveDaDre>>(
    () => new Set<ChaveDaDre>(["receita_bruta"]),
  );
  const meses = useMemo(
    () => (intervalo ? mesesDoIntervalo(intervalo) : []),
    [intervalo],
  );
  const podeMensal = meses.length > 1 && meses.length <= MAXIMO_DE_MESES;
  const mensal = modo === "mensal" && podeMensal;

  const dre = useDreFinanceira(intervalo, ativo, versao);
  const porMes = useDreMensal(meses, ativo && mensal, versao);

  const alternar = (chave: ChaveDaDre) =>
    setAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave);
      else nova.add(chave);
      return nova;
    });

  if (dre.erro && !dre.dados) {
    return <EstadoDeErro mensagem={dre.erro} aoTentarDeNovo={dre.recarregar} />;
  }
  const dados = dre.dados;
  if (!dados) return <EsqueletoDoResultado />;

  const vazia =
    Math.round(dados.receitaBruta * 100) === 0 &&
    Math.round(dados.lucroLiquido * 100) === 0 &&
    dados.linhas.length === 0;
  const margemBruta = percentualDaReceita(
    dados.lucroBruto,
    dados.receitaLiquida,
  );
  const margemLiquida = percentualDaReceita(
    dados.lucroLiquido,
    dados.receitaLiquida,
  );
  const sobraSobreReceita = percentualDaReceita(
    dados.margemContribuicao,
    dados.receitaLiquida,
  );

  return (
    <div data-aba-resultado="" className="flex flex-col gap-4">
      {podeMensal ? (
        <Segmentado<ModoDaDre>
          rotulo="Visão do resultado"
          valor={modo}
          aoMudar={setModo}
          opcoes={[
            { valor: "periodo", rotulo: "Período" },
            { valor: "mensal", rotulo: "Mês a mês" },
          ]}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuadroDoResultado
          rotulo="Lucro líquido"
          valor={dados.lucroLiquido}
          detalhe={`Margem líquida ${formatarPercentual(margemLiquida)}`}
          comAviso={dados.cmvEstimado}
        />
        <QuadroDoResultado
          rotulo="Receita líquida"
          valor={dados.receitaLiquida}
          neutro
        />
        <QuadroDoResultado
          rotulo="Lucro bruto"
          valor={dados.lucroBruto}
          detalhe={`Margem bruta ${formatarPercentual(margemBruta)}`}
          comAviso={dados.cmvEstimado}
        />
        <QuadroDoResultado
          rotulo="Sobra depois dos custos da venda"
          valor={dados.margemContribuicao}
          detalhe={`${formatarPercentual(sobraSobreReceita)} da receita`}
          comAviso={dados.cmvEstimado}
        />
      </div>

      <CartaoSecao
        titulo="Demonstração do resultado"
        subtitulo={`${rotuloDoPeriodo} · pelo mês de referência`}
      >
        {dre.erro ? (
          <div className="mb-3">
            <EstadoDeErro mensagem={dre.erro} aoTentarDeNovo={dre.recarregar} />
          </div>
        ) : null}
        {vazia ? (
          <EstadoVazio
            icone={FileText}
            titulo="Nada no período ainda"
            texto="Assim que houver venda paga ou despesa lançada com mês de referência neste período, o resultado se monta sozinho."
          />
        ) : mensal ? (
          porMes.erro && !porMes.dados ? (
            <EstadoDeErro
              mensagem={porMes.erro}
              aoTentarDeNovo={porMes.recarregar}
            />
          ) : porMes.dados ? (
            <TabelaMensal
              total={dados}
              meses={porMes.dados}
              rotulos={meses.map((m) => m.rotulo)}
              abertas={abertas}
              aoAlternar={alternar}
            />
          ) : (
            <EsqueletoDeLista linhas={8} />
          )
        ) : (
          <TabelaDoPeriodo
            dre={dados}
            abertas={abertas}
            aoAlternar={alternar}
          />
        )}
      </CartaoSecao>

      <div className="flex flex-col gap-2 px-1 text-xs leading-relaxed text-zinc-400">
        {dados.cmvEstimado ? <p>{AVISO_CUSTO_ESTIMADO}.</p> : null}
        <p>
          Transferências entre contas, compra de mercadoria para estoque e
          aporte ou retirada do dono ficam fora do resultado: não são lucro nem
          prejuízo.
        </p>
      </div>
    </div>
  );
}
