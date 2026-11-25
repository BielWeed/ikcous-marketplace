// A estimativa do DAS do mês, na aba Impostos (Simples Nacional, só comércio).
//
// Componente de APRESENTAÇÃO: recebe o resultado de `estimarDasDoSimples`
// (src/lib/fiscal/estimativa-simples.ts) e desenha. Sem hook de dados, sem
// Supabase, sem botão, sem link.
//
// Regras que mandam aqui (parecer do sócio, 24/11/2026):
//  - é ESTIMATIVA, nunca valor devido: "cerca de R$ 410", de 10 em 10, sem
//    centavos, cor neutra e ícone de calculadora;
//  - TODA estimativa vem com o aviso fixo embaixo (AvisoDaEstimativa);
//  - DAS arredondado a zero com venda no mês: "menos de R$ 10", nunca "cerca
//    de R$ 0"; sem venda no mês: "Sem vendas neste mês";
//  - sem número (recusa do núcleo, série incompleta): só texto, via SemEstimativa;
//  - a estimativa NUNCA aparece como ação ("lançar como despesa"): nada aqui grava;
//  - "Ocultar valores": o valor vira máscara; o aviso continua.

import { Calculator } from "lucide-react";
import type { ReactNode } from "react";

import type { EstimativaDoSimples } from "@/lib/fiscal/estimativa-simples";

import {
  BlocoKpi,
  CartaoSecao,
  Dinheiro,
  useValoresEstaoOcultos,
} from "../partes";
import { AvisoDaEstimativa } from "./AvisoDaEstimativa";
import { SemEstimativa } from "./SemEstimativa";

export interface EstimativaSimplesProps {
  /** O resultado do núcleo. */
  readonly estimativa: EstimativaDoSimples;
  /** O mês das vendas (`yyyy-mm`). */
  readonly competencia: string;
  /** Receita do mês, em reais: distingue "DAS menor que R$ 10" de "não vendeu". */
  readonly receitaDoMes: number;
}

const FORMATADOR_DE_REAIS_INTEIROS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const FORMATADOR_DO_MES = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "outubro de 2026", ou `null` se `competencia` não é um `yyyy-mm` de verdade. */
function rotuloDoMes(competencia: string): string | null {
  const partes = COMPETENCIA.exec(competencia);
  if (!partes) return null;
  return FORMATADOR_DO_MES.format(
    new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, 1)),
  );
}

/** Dezena de reais mais próxima, metade para cima: a tela nunca mostra centavos. */
const paraDezena = (valor: number): number => Math.round(valor / 10) * 10;

function PrefixoDoValor() {
  return <span className="text-sm font-semibold text-zinc-300">cerca de </span>;
}

export function EstimativaSimples({
  estimativa,
  competencia,
  receitaDoMes,
}: EstimativaSimplesProps) {
  const ocultos = useValoresEstaoOcultos();

  if (estimativa.estado === "sem_estimativa") {
    return <SemEstimativa estimativa={estimativa} />;
  }
  // Valor que não é um número de verdade (ou negativo) nunca vira "cerca de".
  if (!Number.isFinite(estimativa.valor) || estimativa.valor < 0) {
    return (
      <SemEstimativa
        estimativa={{ estado: "sem_estimativa", motivo: "receita_invalida" }}
      />
    );
  }

  const arredondado = paraDezena(estimativa.valor);
  const mes = rotuloDoMes(competencia);
  const teveVenda = receitaDoMes > 0;
  const semVenda = arredondado === 0 && !teveVenda;

  let valor: ReactNode;
  if (ocultos) {
    // O valor mascarado é o mesmo para qualquer quantia (inclusive "menos de"
    // e "sem vendas": dizer que o mês não teve venda também é dado escondido).
    valor = (
      <>
        <PrefixoDoValor />
        <Dinheiro valor={arredondado} />
      </>
    );
  } else if (semVenda) {
    valor = "Sem vendas neste mês";
  } else if (arredondado === 0) {
    valor = `menos de ${FORMATADOR_DE_REAIS_INTEIROS.format(10)}`;
  } else {
    valor = (
      <>
        <PrefixoDoValor />
        {FORMATADOR_DE_REAIS_INTEIROS.format(arredondado)}
      </>
    );
  }

  return (
    <CartaoSecao
      titulo="Estimativa do DAS"
      subtitulo={
        mes
          ? `Sobre as vendas de ${mes} que passaram pelo IKCOUS.`
          : "Sobre as vendas do mês que passaram pelo IKCOUS."
      }
    >
      <BlocoKpi rotulo="Estimativa do app" icone={Calculator}>
        <span data-estimativa-valor="">{valor}</span>
      </BlocoKpi>
      <AvisoDaEstimativa />
    </CartaoSecao>
  );
}
