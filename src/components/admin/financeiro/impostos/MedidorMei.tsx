// Medidor do limite do MEI na tela da aba Impostos: "quanto do limite do ano
// você já usou, e o que acontece se passar".
//
// Componente de APRESENTAÇÃO: recebe o resultado de `medirLimiteDoMei`
// (src/lib/fiscal/medidor-mei.ts) e desenha. Não busca dado, não fala com o
// banco e não tem botão: quem decide se mostra (só MEI) e de onde vem a receita
// é a aba, que liga isto depois.
//
// Regras que mandam aqui:
//  - cada faixa tem TEXTO + ÍCONE + cor de significado; a cor nunca é a única pista;
//  - o percentual escrito nunca contradiz a faixa (a faixa é decidida em
//    centavos no núcleo; 100,004% aparece como "101%", nunca como "100%", e
//    99,99% dentro do limite aparece como "99%");
//  - ano sem valores conferidos: aviso no lugar do número, nada de R$ nem %;
//  - "Ocultar valores": dinheiro e percentual viram máscara e a barra some (o
//    tamanho dela entregaria o percentual). O aviso da faixa continua: quem
//    passou do limite precisa saber mesmo com os valores escondidos;
//  - o número vem do `fin_dre`, que só enxerga as vendas feitas pelo app. O aviso fixo
//    "só contam as vendas pelo IKCOUS" vai embaixo em TODO estado. E quando a
//    `cobertura` é PARCIAL (o app não vendia desde o começo do período medido), o
//    número é só "vendas pelo IKCOUS no ano": sem percentual, sem barra, sem a frase
//    de "dentro do limite" nem o efeito no enquadramento (o `fin_dre` devolve zero
//    para o que veio antes do app, e a conclusão sairia de um número incompleto). Só
//    passar do teto mostra alerta, porque o total real é igual ou maior. Os textos
//    novos moram em `TEXTOS_DO_MEDIDOR_DO_MEI` (src/lib/fiscal/textos.ts).

import {
  CircleCheck,
  Info,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";

import { formatarBRL } from "@/lib/financeiro";
import type {
  CoberturaDaReceita,
  FaixaDoMei,
  MedidorDoMei,
  MotivoSemContaDoMedidor,
} from "@/lib/fiscal/medidor-mei";
import { ULTIMO_ANO_CONFERIDO } from "@/lib/fiscal/parametros-da-lei";
import { TEXTOS_DO_MEDIDOR_DO_MEI } from "@/lib/fiscal/textos";
import {
  type TomDeEstado,
  classeDoPonto,
  classeDoTexto,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";

import {
  CLASSE_CASCA_DO_CARTAO,
  CLASSE_ROTULO_DO_CARTAO,
  CartaoSecao,
  Dinheiro,
  useValoresEstaoOcultos,
} from "../partes";
import { MASCARA_DO_VALOR } from "../tamanhoDoValor";

export interface MedidorMeiProps {
  /** O resultado do núcleo (`medirLimiteDoMei`). */
  readonly medidor: MedidorDoMei;
  /** O ano medido (o núcleo não o devolve; é preciso para o aviso de ano não conferido). */
  readonly ano: number;
  /** Receita bruta do ano até agora, em reais (a mesma que foi ao núcleo). */
  readonly receitaAcumulada: number;
  /**
   * Se o número do app é a receita do ano inteiro (`coberturaDaReceitaDoAno`). Sem
   * valor padrão de propósito: quem esquecer de dizer não recebe veredito por engano.
   */
  readonly cobertura: CoberturaDaReceita;
}

interface VisualDaFaixa {
  readonly tom: TomDeEstado;
  readonly Icone: LucideIcon;
  readonly titulo: string;
  /** Frase de ação que o parecer pede só na faixa mais grave. */
  readonly chamada?: string;
}

const VISUAL_DA_FAIXA: Record<FaixaDoMei, VisualDaFaixa> = {
  dentro: {
    tom: "positivo",
    Icone: CircleCheck,
    titulo: "Dentro do limite",
  },
  excesso_ate_20: {
    tom: "atencao",
    Icone: TriangleAlert,
    titulo: "Passou do limite em até 20%",
  },
  excesso_acima_20: {
    tom: "negativo",
    Icone: OctagonAlert,
    titulo: "Passou do limite em mais de 20%",
    chamada: "Fale com o seu contador hoje.",
  },
};

/** A barra vai de 0% a 120% do teto (acima de 120% a lei muda de efeito). */
const FIM_DA_ESCALA_EM_PERCENTUAL = 120;
const MARCA_DO_LIMITE_EM_PERCENTUAL = 100;

/**
 * O percentual inteiro que a tela escreve, SEM contradizer a faixa: dentro do
 * limite arredonda para baixo (99,99% é "99%", e "100%" só quando é exatamente
 * 100%); passou do limite arredonda para cima (100,004% é "101%").
 */
function percentualParaMostrar(percentual: number, faixa: FaixaDoMei): number {
  // O núcleo divide em ponto flutuante: 23.490/81.000 chega como 28,999999999999996.
  // Arredondar a 9 casas absorve esse resíduo sem mexer em frações reais
  // (100,004% continua 100,004%). Achado 1 da revisão Opus, 24/11/2026.
  const valor = Math.max(0, Math.round(percentual * 1e9) / 1e9);
  return faixa === "dentro" ? Math.floor(valor) : Math.ceil(valor);
}

function mesesDeAtividade(meses: number): string {
  return meses === 1 ? "1 mês" : `${meses} meses`;
}

const TEXTO_SEM_CONTA = (
  ano: number,
): Record<MotivoSemContaDoMedidor, string> => ({
  ano_nao_conferido: `Temos os valores da lei de ${ULTIMO_ANO_CONFERIDO}; os de ${ano} ainda não foram conferidos. Por isso não mostramos quanto do limite você já usou. Veja o limite de ${ano} com o seu contador.`,
  receita_invalida:
    "Não deu para somar as vendas do ano agora. Tente de novo daqui a pouco.",
  abertura_invalida:
    "A data de abertura da empresa, no cadastro fiscal, não parece uma data de verdade. Corrija no cadastro fiscal para ver o medidor.",
  abertura_depois_do_ano: `A data de abertura da empresa, no cadastro fiscal, é depois de ${ano}. Confira a data no cadastro fiscal para ver o medidor.`,
});

/** O aviso fixo, embaixo do medidor em todo estado (mesmo desenho do aviso da estimativa). */
function AvisoDoMedidor() {
  return (
    <div
      role="note"
      aria-label="Aviso sobre o medidor"
      className="mt-3 flex min-w-0 items-start gap-3 rounded-2xl border border-admin-border bg-admin-bg p-3"
    >
      <Info
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", classeDoTexto("neutro"))}
      />
      <p className="min-w-0 text-xs leading-relaxed text-zinc-300">
        {TEXTOS_DO_MEDIDOR_DO_MEI.avisoFixo}
      </p>
    </div>
  );
}

export function MedidorMei({
  medidor,
  ano,
  receitaAcumulada,
  cobertura,
}: MedidorMeiProps) {
  const ocultos = useValoresEstaoOcultos();
  const titulo = `Limite do MEI em ${ano}`;

  if (medidor.estado === "sem_conta") {
    return (
      <CartaoSecao titulo={titulo}>
        <div
          className={cn(CLASSE_CASCA_DO_CARTAO, "flex items-start gap-3 p-4")}
        >
          <Info
            aria-hidden="true"
            className={cn("mt-0.5 size-5 shrink-0", classeDoTexto("info"))}
          />
          <p className="min-w-0 text-sm leading-relaxed text-zinc-300">
            {TEXTO_SEM_CONTA(ano)[medidor.motivo]}
          </p>
        </div>
        <AvisoDoMedidor />
      </CartaoSecao>
    );
  }

  const vendasDoAno = Number.isFinite(receitaAcumulada)
    ? Math.max(0, receitaAcumulada)
    : 0;

  if (cobertura.tipo === "parcial") {
    // Faixa fora de "dentro" = o número do app JÁ passou do teto. Só isso se conclui.
    const acimaDoTeto = medidor.faixa !== "dentro";
    const alerta = TEXTOS_DO_MEDIDOR_DO_MEI.acimaDoLimiteComCoberturaParcial;
    return (
      <CartaoSecao
        titulo={titulo}
        subtitulo={TEXTOS_DO_MEDIDOR_DO_MEI.subtituloParcial}
      >
        <div className={cn(CLASSE_CASCA_DO_CARTAO, "flex flex-col gap-4 p-4")}>
          <div className="flex min-w-0 flex-col gap-1">
            <span className={CLASSE_ROTULO_DO_CARTAO}>
              {TEXTOS_DO_MEDIDOR_DO_MEI.rotuloDoNumeroParcial}
            </span>
            <p
              data-vendas-pelo-app=""
              className="text-3xl font-black tabular-nums leading-none tracking-tight text-white"
            >
              <Dinheiro valor={vendasDoAno} />
            </p>
            <p className="text-xs leading-relaxed text-zinc-400">
              Limite: {formatarBRL(medidor.tetoUsado)}
            </p>
            {medidor.tetoProporcional ? (
              <p className="text-xs leading-relaxed text-zinc-400">
                No ano em que a empresa abre, o limite é proporcional:{" "}
                {mesesDeAtividade(medidor.mesesDeAtividade)} de atividade,
                contando o mês da abertura inteiro.
              </p>
            ) : null}
          </div>

          {acimaDoTeto ? (
            <div role="alert" className="flex min-w-0 items-start gap-3">
              <OctagonAlert
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  classeDoTexto("negativo"),
                )}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p
                  className={cn(
                    "text-sm font-bold leading-snug",
                    classeDoTexto("negativo"),
                  )}
                >
                  {alerta.titulo}
                </p>
                <p className="text-sm leading-relaxed text-zinc-300">
                  {alerta.texto}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-start gap-3">
              <Info
                aria-hidden="true"
                className={cn("mt-0.5 size-5 shrink-0", classeDoTexto("info"))}
              />
              <p className="min-w-0 text-sm leading-relaxed text-zinc-300">
                {TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito[cobertura.motivo]}
              </p>
            </div>
          )}
        </div>
        <AvisoDoMedidor />
      </CartaoSecao>
    );
  }

  const {
    tom,
    Icone,
    titulo: tituloDaFaixa,
    chamada,
  } = VISUAL_DA_FAIXA[medidor.faixa];
  const percentual = percentualParaMostrar(medidor.percentual, medidor.faixa);
  const larguraDaBarra =
    (Math.min(Math.max(0, medidor.percentual), FIM_DA_ESCALA_EM_PERCENTUAL) /
      FIM_DA_ESCALA_EM_PERCENTUAL) *
    100;
  const posicaoDaMarca =
    (MARCA_DO_LIMITE_EM_PERCENTUAL / FIM_DA_ESCALA_EM_PERCENTUAL) * 100;

  return (
    <CartaoSecao
      titulo={titulo}
      subtitulo="Quanto das suas vendas do ano já conta para o limite."
    >
      <div className={cn(CLASSE_CASCA_DO_CARTAO, "flex flex-col gap-4 p-4")}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={CLASSE_ROTULO_DO_CARTAO}>
            Parte do limite que você já usou
          </span>
          <p className="text-3xl font-black tabular-nums leading-none tracking-tight text-white">
            {ocultos ? (
              <>
                <span aria-hidden="true">{MASCARA_DO_VALOR}</span>
                <span className="sr-only">Valor oculto</span>
              </>
            ) : (
              `${percentual}%`
            )}
          </p>
          <p className="text-xs leading-relaxed text-zinc-400">
            Vendas do ano: <Dinheiro valor={vendasDoAno} /> · Limite:{" "}
            {formatarBRL(medidor.tetoUsado)}
          </p>
          {medidor.tetoProporcional ? (
            <p className="text-xs leading-relaxed text-zinc-400">
              No ano em que a empresa abre, o limite é proporcional:{" "}
              {mesesDeAtividade(medidor.mesesDeAtividade)} de atividade,
              contando o mês da abertura inteiro.
            </p>
          ) : null}
        </div>

        {ocultos ? null : (
          <div aria-hidden="true" className="flex flex-col gap-1.5">
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div
                data-barra-enchimento=""
                className={cn("h-full rounded-full", classeDoPonto(tom))}
                style={{ width: `${larguraDaBarra}%` }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-white"
                style={{ left: `${posicaoDaMarca}%` }}
              />
            </div>
            <span className="text-[11px] leading-tight text-zinc-400">
              A marca na barra é o limite (100%).
            </span>
          </div>
        )}

        <div className="flex min-w-0 items-start gap-3">
          <Icone
            data-faixa-icone=""
            aria-hidden="true"
            className={cn("mt-0.5 size-5 shrink-0", classeDoTexto(tom))}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <p
              data-faixa-titulo=""
              className={cn(
                "text-sm font-bold leading-snug",
                classeDoTexto(tom),
              )}
            >
              {tituloDaFaixa}
            </p>
            <p className="text-sm leading-relaxed text-zinc-300">
              {medidor.efeito}
            </p>
            {chamada ? (
              <p className="text-sm font-bold leading-relaxed text-white">
                {chamada}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <AvisoDoMedidor />
    </CartaoSecao>
  );
}
