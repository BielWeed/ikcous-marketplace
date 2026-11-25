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
//  - "Ocultar valores": o valor vira máscara; o aviso continua;
//  - poucos meses de vendas no app (decisão do sócio, 25/11/2026): quando a faixa saiu da
//    média de 1 a 11 meses, o rótulo diz de quantos meses ("de 1 mês", no singular) e a
//    frase "Com N meses de vendas no app, a faixa foi deduzida pela média..." vem ANTES do
//    aviso fixo. Base que não é um inteiro de 1 ou mais nunca vira número: a tela não
//    descreve o que não sabe contar.

import { Calculator } from "lucide-react";
import type { ReactNode } from "react";

import type { EstimativaDoSimples } from "@/lib/fiscal/estimativa-simples";
import {
  baseDaMediaEhValida,
  fraseDaMediaDePoucosMeses,
  mesesPorExtenso,
} from "@/lib/fiscal/textos";

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

  // O núcleo só devolve base parcial de 1 mês ou mais; qualquer outra coisa é dado torto.
  const base = estimativa.mesesNaMedia;
  if (base !== undefined && !baseDaMediaEhValida(base)) {
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
          ? `Sobre as vendas de ${mes} registradas no app.`
          : "Sobre as vendas do mês registradas no app."
      }
    >
      <BlocoKpi
        rotulo={
          base === undefined
            ? "Estimativa do app"
            : `Estimativa do app (de ${mesesPorExtenso(base)} de vendas)`
        }
        icone={Calculator}
      >
        <span data-estimativa-valor="">{valor}</span>
      </BlocoKpi>
      {base === undefined ? null : (
        <p
          data-base-da-media=""
          className="mt-3 text-xs leading-relaxed text-zinc-300"
        >
          {fraseDaMediaDePoucosMeses(base)}
        </p>
      )}
      <AvisoDaEstimativa />
    </CartaoSecao>
  );
}
