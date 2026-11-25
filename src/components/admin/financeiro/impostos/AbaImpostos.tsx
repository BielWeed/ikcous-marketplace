// A aba Impostos do Financeiro, montada (Gestão Fiscal, Fase 1): o cadastro fiscal,
// o que cada regime tem de conta, o caderno das guias e o arquivo para o contador.
//
// QUEM TEM CONTA (e só eles; nenhum regime é suposto):
//   sem cadastro            estado vazio "Configure o regime da sua empresa"; NADA de
//                           estimativa e NENHUMA leitura do `fin_dre`
//   MEI                     medidor do limite do ano (vendas do ano, as mesmas do Resultado;
//                           só conclui enquadramento se o app já vendia desde o começo do
//                           período medido: a `cobertura` vem do cadastro fiscal). Em
//                           janeiro, até os valores do ano novo serem conferidos, mostra
//                           "2026 fechado" com o limite de 2026 (`qualAnoOMedidorMostra`)
//   Simples + só comércio   estimativa do DAS do ÚLTIMO MÊS FECHADO (a guia que vem
//                           aí), pela receita dos 12 meses anteriores; com menos de 12
//                           meses de vendas no app, a partir de 2 meses, pela média
//   o resto                 a frase honesta (Simples com serviço, Presumido, Real, "Não sei")
// O Caderno das guias e o arquivo para o contador funcionam em TODOS os casos: só leem
// o que a lojista lançou e o extrato.
//
// A LINHA DE VENDAS DO CADERNO (decisão do sócio, 25/11/2026): cada um dos 3 meses mostra
// "Vendas registradas no app (menos devoluções): R$ X", o MESMO número do Resultado (a
// receita líquida do `fin_dre`), para TODO regime com cadastro. É informação do mês, nunca
// um valor de guia. Por isso quem tem cadastro lê, no mínimo, os 3 meses do caderno; a
// série longa do MEI e do Simples já cobre esses meses, e o mês atual (pela metade) entra
// nela só para essa linha: ele NUNCA ganha estimativa nem entra na comparação com a guia.
//
// POR QUE O ÚLTIMO MÊS FECHADO, e não o mês atual: com o mês pela metade a conta mostraria
// "cerca de R$ 60" no dia 3 e a lojista leria como o imposto do mês. O mês fechado é o
// da guia que ela vai receber e pagar. O mês atual entra só no medidor do MEI (o limite
// conta as vendas até hoje) e no caderno (onde se lança a guia dele).
//
// A ESTIMATIVA MORA SÓ AQUI, em memória: ela nunca vai para Resultado, Pagar e receber ou
// Início e nunca vira lançamento (a trava estática `fiscal-nunca-vira-lancamento` vigia
// este arquivo). O valor que a lojista lança vem da guia dela, nunca desta tela. Também
// fica de fora do caderno o mês atual na comparação com a guia: estimativa de mês
// pela metade comparada com guia de mês inteiro enganaria.
//
// A receita vem do MESMO `fin_dre` do Resultado (um por mês, líquida de devoluções) e
// só é lida para quem tem conta. O cadastro é lido UMA vez, aqui, e entregue ao cartão
// do cadastro por prop: gravar nele relê a aba toda.

import { useCallback, useMemo } from "react";

import { useAuth } from "@/hooks/useAuth";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import {
  type GuiaLida,
  lerLinhasParaOContador,
  useCadastroFiscal,
  useGuiasDeImpostos,
  useSerieDaReceita,
} from "@/hooks/useImpostos";
import { ehDataIso, paraCentavos } from "@/lib/financeiro";
import {
  type CadastroFiscal as CadastroFiscalLido,
  quemTemConta,
} from "@/lib/fiscal/cadastro";
import { montarCaderno } from "@/lib/fiscal/caderno";
import {
  type EstimativaDoSimples,
  estimarDasDoSimples,
} from "@/lib/fiscal/estimativa-simples";
import {
  coberturaDaReceitaDoAno,
  medirLimiteDoMei,
  qualAnoOMedidorMostra,
} from "@/lib/fiscal/medidor-mei";
import { receitaDoMes } from "@/lib/fiscal/receita-do-mes";
import type {
  DataIso,
  DreFinanceira,
  IntervaloDeDatas,
} from "@/types/financeiro";

import type { AbrirFolha, AlvoDaBaixa } from "../navegacao";
import { CartaoSecao, EsqueletoDeLista, EstadoDeErro } from "../partes";
import { CadastroFiscal } from "./CadastroFiscal";
import { CadernoDeGuias, type MesParaOCaderno } from "./CadernoDeGuias";
import { EstimativaSimples } from "./EstimativaSimples";
import { ExportarParaContador } from "./ExportarParaContador";
import { MedidorMei } from "./MedidorMei";
import { SemEstimativa } from "./SemEstimativa";

export interface AbaImpostosProps {
  /** A aba está à vista: com `false` nada é lido. */
  readonly ativo: boolean;
  /** Sobe depois de uma escrita do Financeiro: tudo que a aba lê, lê de novo. */
  readonly versao: number;
  /** O dia de hoje em São Paulo (`useDiaDeSaoPaulo`), como no resto do Financeiro. */
  readonly hoje: DataIso;
  /** O `abrirFolha` do Financeiro: o único caminho para lançar ou pagar uma guia. */
  readonly abrirFolha: AbrirFolha;
  /** Leva a Minha loja › Dados da empresa, onde o CNPJ se preenche. */
  readonly aoIrParaMinhaLoja: () => void;
}

/** Quantos meses o caderno mostra: o atual e os dois anteriores. */
const MESES_DO_CADERNO = 3;
/** A receita dos 12 meses anteriores ao mês estimado. O núcleo é quem decide a conta. */
const MESES_ANTES_DO_MES_ESTIMADO = 12;

// ---------------------------------------------------------------------------
// Calendário (competências `aaaa-mm`)
// ---------------------------------------------------------------------------

function somarMeses(competencia: string, meses: number): string {
  const indice =
    Number(competencia.slice(0, 4)) * 12 +
    Number(competencia.slice(5, 7)) -
    1 +
    meses;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

/** O mês inteiro (primeiro e último dia) de uma competência `aaaa-mm`. */
function intervaloDoMes(competencia: string): IntervaloDeDatas {
  const ultimo = new Date(
    Date.UTC(
      Number(competencia.slice(0, 4)),
      Number(competencia.slice(5, 7)),
      0,
    ),
  ).getUTCDate();
  return {
    inicio: `${competencia}-01`,
    fim: `${competencia}-${String(ultimo).padStart(2, "0")}`,
  };
}

/** Os meses de `de` a `ate` (inclusive), cada um inteiro. */
function mesesDe(de: string, ate: string): IntervaloDeDatas[] {
  const meses: IntervaloDeDatas[] = [];
  for (let m = de; m <= ate; m = somarMeses(m, 1)) {
    meses.push(intervaloDoMes(m));
  }
  return meses;
}

// ---------------------------------------------------------------------------
// Receita: da série do Resultado para os números da aba
// ---------------------------------------------------------------------------

/**
 * A receita de cada mês da série, em reais, LÍQUIDA de devoluções e estornos (a regra
 * do núcleo: "vendas menos devoluções"), pelo mês do intervalo. `null` enquanto a série
 * não chegou, ou se ela não tem um `fin_dre` por mês pedido (nunca uma série furada).
 */
function receitasLiquidasPorMes(
  meses: readonly IntervaloDeDatas[],
  dres: readonly DreFinanceira[] | null,
): ReadonlyMap<string, number> | null {
  if (dres === null || dres.length !== meses.length) return null;
  const porMes = new Map<string, number>();
  for (const [i, mes] of meses.entries()) {
    const dre = dres.at(i);
    // Só para o tipo (o tamanho já foi conferido): série furada nunca segue adiante.
    if (dre === undefined) return null;
    const { receita, devolucoes } = receitaDoMes(dre, null);
    porMes.set(
      mes.inicio.slice(0, 7),
      (paraCentavos(receita) - paraCentavos(devolucoes)) / 100,
    );
  }
  return porMes;
}

/** A estimativa do DAS de um mês. Mês que a série não trouxe nunca vira "zero vendas". */
function estimarOMes(
  cadastro: CadastroFiscalLido,
  competencia: string,
  receitas: ReadonlyMap<string, number>,
): EstimativaDoSimples {
  const doMes = receitas.get(competencia);
  if (doMes === undefined) {
    return { estado: "sem_estimativa", motivo: "receita_invalida" };
  }
  return estimarDasDoSimples({
    cadastro,
    competencia,
    receitaDoMes: doMes,
    receitasMensais: Object.fromEntries(receitas),
  });
}

// ---------------------------------------------------------------------------
// Guias que ainda faltam pagar, no formato da folha de baixa
// ---------------------------------------------------------------------------

/**
 * As guias do mês que ainda estão a pagar (`previsto`), com o que a folha de baixa
 * pede. Cada uma só aparece no mês da sua COMPETÊNCIA (o mês das vendas). Guia com
 * valor que não é número fica de fora do "Pagar" (a soma do caderno já a ignora).
 * O lado é sempre saída: imposto é despesa, e o servidor recusa categoria que não combina.
 */
function guiasAPagarDoMes(
  guias: readonly GuiaLida[],
  mes: string,
): AlvoDaBaixa[] {
  const alvos: AlvoDaBaixa[] = [];
  for (const g of guias) {
    if (g.status !== "previsto" || !Number.isFinite(g.valor)) continue;
    if (
      typeof g.data_competencia !== "string" ||
      g.data_competencia.slice(0, 7) !== mes
    ) {
      continue;
    }
    alvos.push({
      id: g.id,
      descricao: g.descricao,
      valor: g.valor,
      contaId: g.conta_id,
      lado: "saida",
      vencimento: ehDataIso(g.data_vencimento) ? g.data_vencimento : null,
    });
  }
  return alvos;
}

// ---------------------------------------------------------------------------
// O bloco do regime (medidor, estimativa ou frase honesta)
// ---------------------------------------------------------------------------

function BlocoDaConta({
  cadastro,
  mesAtual,
  anoDoMedidor,
  serie,
  receitas,
}: {
  readonly cadastro: CadastroFiscalLido;
  readonly mesAtual: string;
  /** O ano que o medidor do MEI mede e se ele já fechou (`qualAnoOMedidorMostra`). */
  readonly anoDoMedidor: { readonly ano: number; readonly fechado: boolean };
  readonly serie: ConsultaFinanceira<DreFinanceira[]>;
  readonly receitas: ReadonlyMap<string, number> | null;
}) {
  const conta = quemTemConta(cadastro);
  if (conta.tipo === "nenhuma") return <SemEstimativa cadastro={cadastro} />;

  const titulo = conta.tipo === "mei" ? "Limite do MEI" : "Estimativa do DAS";
  if (receitas === null) {
    if (serie.erro) {
      return (
        <EstadoDeErro mensagem={serie.erro} aoTentarDeNovo={serie.recarregar} />
      );
    }
    return (
      <CartaoSecao titulo={titulo}>
        <EsqueletoDeLista linhas={2} />
      </CartaoSecao>
    );
  }

  const avisoDeAtualizacao = serie.erro ? (
    <p role="alert" className="mb-3 text-xs leading-relaxed text-amber-300">
      Não deu para atualizar agora; estes são os últimos valores lidos.{" "}
      {serie.erro}
    </p>
  ) : null;

  if (conta.tipo === "mei") {
    const { ano, fechado } = anoDoMedidor;
    let centavos = 0;
    for (const [mes, valor] of receitas) {
      if (mes.startsWith(`${ano}-`)) centavos += paraCentavos(valor);
    }
    const receitaAcumulada = centavos / 100;
    return (
      <div className="min-w-0">
        {avisoDeAtualizacao}
        <MedidorMei
          medidor={medirLimiteDoMei({ receitaAcumulada, ano, cadastro })}
          ano={ano}
          receitaAcumulada={receitaAcumulada}
          // O `fin_dre` só vê as vendas feitas pelo app: sem saber que o app já
          // vendia desde o começo do período medido, o número é PARCIAL e o
          // medidor não conclui enquadramento sobre ele.
          cobertura={coberturaDaReceitaDoAno({ ano, cadastro })}
          fechado={fechado}
        />
      </div>
    );
  }

  const competencia = somarMeses(mesAtual, -1);
  return (
    <div className="min-w-0">
      {avisoDeAtualizacao}
      <EstimativaSimples
        estimativa={estimarOMes(cadastro, competencia, receitas)}
        competencia={competencia}
        receitaDoMes={receitas.get(competencia) ?? 0}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// A aba
// ---------------------------------------------------------------------------

export function AbaImpostos({
  ativo,
  versao,
  hoje,
  abrirFolha,
  aoIrParaMinhaLoja,
}: AbaImpostosProps) {
  const { user } = useAuth();
  const contaId = user?.id ?? null;
  const mesAtual = hoje.slice(0, 7);

  // O cadastro é lido UMA vez e decide tudo o que vem depois.
  const consulta = useCadastroFiscal(ativo, versao);
  const lido = consulta.dados;
  const cadastro = lido?.estado === "com_cadastro" ? lido.cadastro : null;
  const conta = cadastro ? quemTemConta(cadastro) : null;
  const tipoDaConta = conta?.tipo ?? null;

  // Que meses da receita ler. Vazio = não lê nada (sem cadastro). Todo regime com cadastro
  // lê, no mínimo, os 3 meses do caderno (a linha de vendas de cada mês); quem tem conta lê
  // a série que a conta pede, e ela já cobre esses meses (a lista é sempre UM intervalo
  // contínuo, do mais antigo ao mais novo).
  const anoDoMedidor = useMemo(() => qualAnoOMedidorMostra(hoje), [hoje]);
  const mesesDaSerie = useMemo(() => {
    if (tipoDaConta === null) return [];
    const primeiroDoCaderno = somarMeses(mesAtual, -(MESES_DO_CADERNO - 1));
    if (tipoDaConta === "mei") {
      // O ano medido inteiro (até hoje, ou até dezembro se ele já fechou) e, se o caderno
      // sai dele (janeiro e fevereiro), também os meses do caderno.
      const { ano, fechado } = anoDoMedidor;
      const janeiro = `${ano}-01`;
      const fim = fechado ? `${ano}-12` : mesAtual;
      return mesesDe(
        janeiro < primeiroDoCaderno ? janeiro : primeiroDoCaderno,
        fim > mesAtual ? fim : mesAtual,
      );
    }
    if (tipoDaConta === "simples_comercio") {
      return mesesDe(
        somarMeses(primeiroDoCaderno, -MESES_ANTES_DO_MES_ESTIMADO),
        mesAtual,
      );
    }
    return mesesDe(primeiroDoCaderno, mesAtual);
  }, [tipoDaConta, mesAtual, anoDoMedidor]);
  const serie = useSerieDaReceita(mesesDaSerie, lido, ativo, versao);
  const receitas = useMemo(
    () => receitasLiquidasPorMes(mesesDaSerie, serie.dados),
    [mesesDaSerie, serie.dados],
  );

  // O caderno não depende do cadastro: toda loja vê as guias que lançou.
  const periodoDoCaderno = useMemo<IntervaloDeDatas>(
    () => ({
      inicio: `${somarMeses(mesAtual, -(MESES_DO_CADERNO - 1))}-01`,
      fim: intervaloDoMes(mesAtual).fim,
    }),
    [mesAtual],
  );
  const guias = useGuiasDeImpostos(periodoDoCaderno, ativo, versao);
  const meses = useMemo<readonly MesParaOCaderno[] | null>(() => {
    const lancadas = guias.dados;
    if (lancadas === null) return null;
    return montarCaderno(lancadas, periodoDoCaderno, hoje).map((caderno) => {
      // A estimativa só acompanha a guia de quem tem conta, e só de mês FECHADO: o mês
      // atual (pela metade) está na série (para a linha de vendas), mas nunca ganha
      // estimativa para comparar com a guia de um mês inteiro.
      let estimativa: number | null = null;
      if (
        cadastro &&
        tipoDaConta === "simples_comercio" &&
        receitas &&
        caderno.mes < mesAtual
      ) {
        const estimada = estimarOMes(cadastro, caderno.mes, receitas);
        if (estimada.estado === "com_estimativa") {
          estimativa = estimada.valor;
        }
      }
      return {
        caderno,
        estimativa,
        // O número do Resultado (vendas menos devoluções). Sem a série, ou sem o mês
        // nela, não há linha: nunca "R$ 0,00" no lugar do que não se sabe.
        vendasDoMes: receitas?.get(caderno.mes) ?? null,
        guiasAPagar: guiasAPagarDoMes(lancadas, caderno.mes),
      };
    });
  }, [
    guias.dados,
    periodoDoCaderno,
    hoje,
    mesAtual,
    cadastro,
    tipoDaConta,
    receitas,
  ]);

  const buscarLinhas = useCallback(
    (periodo: Parameters<typeof lerLinhasParaOContador>[0]) =>
      lerLinhasParaOContador(periodo, contaId),
    [contaId],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {cadastro ? (
        <BlocoDaConta
          cadastro={cadastro}
          mesAtual={mesAtual}
          anoDoMedidor={anoDoMedidor}
          serie={serie}
          receitas={receitas}
        />
      ) : null}

      <CadastroFiscal
        consulta={consulta}
        ativo={ativo}
        versao={versao}
        hoje={hoje}
        aoIrParaMinhaLoja={aoIrParaMinhaLoja}
      />

      {meses ? (
        <>
          {guias.erro ? (
            <p role="alert" className="text-xs leading-relaxed text-amber-300">
              Não deu para atualizar as guias agora; estas são as últimas lidas.{" "}
              {guias.erro}
            </p>
          ) : null}
          <CadernoDeGuias
            meses={meses}
            cadastro={cadastro}
            abrirFolha={abrirFolha}
          />
        </>
      ) : guias.erro ? (
        <EstadoDeErro mensagem={guias.erro} aoTentarDeNovo={guias.recarregar} />
      ) : (
        <CartaoSecao titulo="Caderno das guias">
          <EsqueletoDeLista linhas={3} />
        </CartaoSecao>
      )}

      <ExportarParaContador buscarLinhas={buscarLinhas} />
    </div>
  );
}
