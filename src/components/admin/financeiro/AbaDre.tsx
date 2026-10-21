import {
  BarChart3,
  ChevronRight,
  FileText,
  Info,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
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
import { classeDoTexto, tomDoValor } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { DreFinanceira, IntervaloDeDatas } from "@/types/financeiro";
import {
  BlocoKpi,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeKpis,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Etiqueta,
  Segmentado,
} from "./partes";

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
      {estimado ? (
        <Etiqueta tom="aviso">Inclui estimativa pelo custo atual</Etiqueta>
      ) : null}
    </span>
  );
  if (!expansivel) return <span className="block py-1 pl-6">{texto}</span>;
  return (
    <button
      type="button"
      aria-expanded={aberta}
      onClick={() => aoAlternar(linha.chave)}
      className="-ml-1 flex min-h-11 w-full items-center gap-1 rounded-lg px-1 text-left hover:bg-white/5"
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
    ? classeDoTexto(tomDoValor(valor))
    : "text-white";
}

function classeDaLinha(linha: LinhaDaCascata): string {
  if (linha.final) return "border-t-2 border-violet-400/40 bg-violet-400/5";
  if (linha.subtotal) return "border-t border-admin-border bg-admin-raised";
  return "";
}

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
    <table className="block w-full border-collapse text-sm sm:table">
      <caption className="sr-only">
        Demonstração do resultado do período, com o percentual de cada linha
        sobre a receita líquida
      </caption>
      <thead>
        <tr className="text-xs text-zinc-400">
          <th scope="col" className="py-2 text-left font-black">
            Linha
          </th>
          <th scope="col" className="py-2 text-right font-black">
            Valor
          </th>
          <th scope="col" className="w-16 py-2 text-right font-black sm:w-20">
            % rec. líq.
          </th>
        </tr>
      </thead>
      <tbody className="block sm:table-row-group">
        {cascata.map((linha) => {
          const aberta = abertas.has(linha.chave);
          const sublinhas = aberta ? sublinhasDaDre(dre, linha.chave) : [];
          return (
            <Fragment key={linha.chave}>
              <tr
                data-linha-dre={linha.chave}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-admin-border py-3 sm:table-row sm:py-0",
                  classeDaLinha(linha),
                  linha.subtotal ? "font-black text-white" : "text-zinc-300",
                )}
              >
                <th
                  scope="row"
                  className="col-span-2 break-words pr-2 text-left font-[inherit]"
                >
                  <RotuloDaLinha
                    linha={linha}
                    dre={dre}
                    aberta={aberta}
                    aoAlternar={aoAlternar}
                  />
                </th>
                <td className="min-w-0 py-2 text-left text-xl sm:text-right sm:text-sm">
                  <Dinheiro
                    valor={linha.valor}
                    className={cn(
                      linha.final && "text-2xl sm:text-base",
                      corDaLinha(linha.chave, linha.valor),
                    )}
                  />
                </td>
                <td className="self-center py-2 text-right text-xs font-normal tabular-nums text-zinc-400">
                  {formatarPercentual(
                    percentualDaReceita(linha.valor, dre.receitaLiquida),
                  )}
                </td>
              </tr>
              {sublinhas.map((sub) => (
                <tr
                  key={`${linha.chave}-${sub.rotulo}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-admin-border py-3 text-xs text-zinc-400 sm:table-row sm:py-0"
                >
                  <th
                    scope="row"
                    className="col-span-2 break-words px-2 py-1.5 text-left font-normal sm:pl-10"
                  >
                    {sub.rotulo}
                  </th>
                  <td className="py-1.5 pl-2 text-left text-lg font-bold sm:pl-0 sm:text-right sm:text-xs">
                    <Dinheiro valor={sub.valor} />
                  </td>
                  <td className="self-center py-1.5 text-right tabular-nums text-zinc-400">
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
                    classeDaLinha(linha),
                    linha.subtotal ? "font-black text-white" : "text-zinc-300",
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
 * competência — na tela, "mês de referência" (spec §4). Cada linha mostra
 * o % da receita líquida (análise vertical); subtotais em destaque; linhas com categorias abrem por baixo. Período com
 * mais de um mês ganha a visão mês a mês — as colunas dos meses são a ÚNICA
 * coisa da tela que rola de lado no celular.
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
  if (!dados) {
    return (
      <div className="flex flex-col gap-4">
        <EsqueletoDeKpis quantos={3} />
        <EsqueletoDeLista linhas={8} />
      </div>
    );
  }

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

  return (
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-4">
        <BlocoKpi
          rotulo="Lucro líquido"
          icone={BarChart3}
          destaque="text-violet-300"
          className="bg-admin-raised"
          detalhe={`Margem líquida ${formatarPercentual(margemLiquida)}`}
        >
          <Dinheiro
            valor={dados.lucroLiquido}
            className={classeDoTexto(tomDoValor(dados.lucroLiquido))}
          />
        </BlocoKpi>
        <BlocoKpi
          rotulo="Receita líquida"
          icone={ReceiptText}
          destaque="text-blue-300"
        >
          <Dinheiro valor={dados.receitaLiquida} />
        </BlocoKpi>
        <BlocoKpi
          rotulo="Lucro bruto"
          icone={TrendingUp}
          destaque="text-teal-300"
          detalhe={`Margem bruta ${formatarPercentual(margemBruta)}`}
        >
          <Dinheiro
            valor={dados.lucroBruto}
            className={classeDoTexto(tomDoValor(dados.lucroBruto))}
          />
        </BlocoKpi>
        <BlocoKpi
          rotulo="Sobra depois dos custos da venda"
          icone={Wallet}
          destaque="text-sky-300"
          detalhe={formatarPercentual(
            percentualDaReceita(dados.margemContribuicao, dados.receitaLiquida),
          )}
        >
          <Dinheiro
            valor={dados.margemContribuicao}
            className={classeDoTexto(tomDoValor(dados.margemContribuicao))}
          />
        </BlocoKpi>
      </div>

      <CartaoSecao
        titulo="Demonstração do resultado"
        subtitulo={`${rotuloDoPeriodo} · pelo mês de referência`}
        acao={
          podeMensal ? (
            <Segmentado<ModoDaDre>
              rotulo="Visão do resultado"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: "periodo", rotulo: "Período" },
                { valor: "mensal", rotulo: "Mês a mês" },
              ]}
            />
          ) : undefined
        }
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
        <p className="mt-4 flex items-start gap-2 text-xs text-zinc-400">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Transferências entre contas, compra de mercadoria para estoque e
          aporte ou retirada do dono ficam fora do resultado: não são lucro nem
          prejuízo.
        </p>
      </CartaoSecao>
    </div>
  );
}
