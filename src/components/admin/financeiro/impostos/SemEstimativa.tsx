// "Aqui não há estimativa": a frase honesta, sem NENHUM número.
//
// Dois jeitos de chegar aqui, e os dois mostram só texto:
//  - o regime da loja não tem conta (Simples com serviço, Presumido, Real, "Não
//    sei"): a frase vem de `fraseSemEstimativa` (src/lib/fiscal/textos.ts), a
//    mesma do cartão do cadastro: "Ainda não fazemos estimativa para ...";
//  - o núcleo recusou a conta (`estimarDasDoSimples`): um texto por motivo, e
//    "faltam N meses" quando a série de vendas medidas está incompleta.
// Nunca aparece valor, nem "cerca de", nem o aviso da estimativa (não há
// estimativa para avisar). Não tem botão: quem lança guia é o caderno.
//
// Quando o resultado do núcleo é dado, o MOTIVO manda (ele é a verdade do
// cálculo); o cadastro sozinho só vale quando não há resultado.

import { Info } from "lucide-react";

import type { CadastroFiscal, MotivoSemConta } from "@/lib/fiscal/cadastro";
import type { EstimativaDoSimples } from "@/lib/fiscal/estimativa-simples";
import { fraseSemEstimativa } from "@/lib/fiscal/textos";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";

import { CLASSE_CASCA_DO_CARTAO, CartaoSecao } from "../partes";

/** O resultado do núcleo que NÃO tem número. */
export type SemEstimativaDoSimples = Extract<
  EstimativaDoSimples,
  { estado: "sem_estimativa" }
>;

export type SemEstimativaProps =
  | {
      /** Regime e atividade da loja, quando ainda não houve cálculo. */
      readonly cadastro: Pick<CadastroFiscal, "regime" | "atividade">;
    }
  | {
      /** A recusa do núcleo (`estimarDasDoSimples`). */
      readonly estimativa: SemEstimativaDoSimples;
    };

// O regime que cada motivo de "sem conta" representa. Para Presumido, Real e
// "Não sei" a atividade não muda a frase (só o Simples fala dela).
const CADASTRO_DO_MOTIVO: Record<
  MotivoSemConta,
  Pick<CadastroFiscal, "regime" | "atividade">
> = {
  simples_com_servico: { regime: "simples", atividade: "com_servico" },
  presumido: { regime: "presumido", atividade: "comercio" },
  real: { regime: "real", atividade: "comercio" },
  nao_sei: { regime: "nao_sei", atividade: "comercio" },
};

const FRASE_GENERICA_DE_REGIME =
  "Ainda não fazemos estimativa para este caso. Seu caderno de guias e o arquivo para o contador funcionam normalmente.";

const TEXTO_DE_MEI =
  "Quem é MEI paga um valor fixo por mês, por isso não fazemos estimativa. O que ajuda é o medidor do limite de vendas do ano.";

const CAUDA_DE_SERIE =
  "Só estimamos quando o app mediu os meses necessários (no mínimo 1 mês de vendas), para não mostrar um número que engana.";

function textoDeFaltamMeses(faltam: number): string {
  if (!Number.isInteger(faltam) || faltam < 1) {
    return `Ainda faltam meses de vendas registradas no app para estimar o DAS. ${CAUDA_DE_SERIE}`;
  }
  const quantos = faltam === 1 ? "Falta 1 mês" : `Faltam ${faltam} meses`;
  return `${quantos} de vendas registradas no app para estimar o DAS. ${CAUDA_DE_SERIE}`;
}

function textoDaRecusa(estimativa: SemEstimativaDoSimples): string {
  if (estimativa.motivo === "faltam_meses") {
    return textoDeFaltamMeses(estimativa.faltam);
  }
  // Um `switch` (e não um mapa indexado por texto): se o núcleo ganhar um motivo
  // novo, este arquivo deixa de compilar até a tela ganhar a frase dele.
  switch (estimativa.motivo) {
    case "simples_com_servico":
    case "presumido":
    case "real":
    case "nao_sei":
      return (
        fraseSemEstimativa(CADASTRO_DO_MOTIVO[estimativa.motivo]) ??
        FRASE_GENERICA_DE_REGIME
      );
    case "mei":
      return TEXTO_DE_MEI;
    case "competencia_invalida":
      return "Não deu para entender qual é o mês desta estimativa.";
    case "ano_nao_conferido":
      return "Os valores da lei deste ano ainda não foram conferidos, por isso não fazemos estimativa. O valor certo está na guia ou com o seu contador.";
    case "receita_invalida":
      return "Não deu para calcular a estimativa: não conseguimos somar as vendas deste mês agora. Tente de novo daqui a pouco.";
    case "sem_mes_de_inicio_das_vendas":
      return "Para estimar, precisamos saber em que mês você começou a vender pelo app. Preencha isso no cadastro fiscal.";
    case "abertura_invalida":
      return "A data de abertura da empresa, no cadastro fiscal, não parece uma data de verdade. Corrija no cadastro fiscal para ver a estimativa.";
    case "competencia_antes_da_abertura":
      return "Este mês é anterior à abertura da empresa, por isso não há estimativa.";
    case "mes_antes_das_vendas_no_app":
      return "Este mês é anterior ao começo das suas vendas pelo app, por isso não há estimativa.";
    case "acima_do_sublimite":
      return "As vendas dos últimos 12 meses passaram do sublimite do Simples Nacional, e a partir dele o ICMS passa a ser cobrado fora do DAS. Esta conta deixa de valer: veja o valor certo com o seu contador.";
    case "acima_do_teto":
      return "As vendas dos últimos 12 meses passaram do teto do Simples Nacional. Esta conta deixa de valer: fale com o seu contador.";
  }
}

function textoDoCadastro(
  cadastro: Pick<CadastroFiscal, "regime" | "atividade">,
): string {
  const frase = fraseSemEstimativa(cadastro);
  if (frase !== null) return frase;
  // Quem TEM conta e chegou aqui sem resultado do cálculo.
  return cadastro.regime === "mei"
    ? TEXTO_DE_MEI
    : "A estimativa deste mês ainda não foi calculada.";
}

export function SemEstimativa(props: SemEstimativaProps) {
  const texto =
    "estimativa" in props
      ? textoDaRecusa(props.estimativa)
      : textoDoCadastro(props.cadastro);
  return (
    <CartaoSecao titulo="Estimativa do DAS">
      <div className={cn(CLASSE_CASCA_DO_CARTAO, "flex items-start gap-3 p-4")}>
        <Info
          aria-hidden="true"
          className={cn("mt-0.5 size-5 shrink-0", classeDoTexto("neutro"))}
        />
        <p className="min-w-0 text-sm leading-relaxed text-zinc-300">{texto}</p>
      </div>
    </CartaoSecao>
  );
}
