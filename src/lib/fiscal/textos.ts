// Textos do cadastro fiscal, em português simples: o rótulo de cada regime e
// atividade, a frase honesta de quem ainda não tem estimativa e as frases da
// trava "só o dono" (plano da Gestão Fiscal, seções 1 e 4).
//
// Lógica pura. As frases são constantes aqui, e não espalhadas pelas telas, de
// propósito: o texto que a lojista lê é o mesmo no cartão, no estado vazio e no
// teste, e uma frase mudada vira UM diff.

import {
  type AtividadeFiscal,
  type CadastroFiscal,
  type MotivoSemConta,
  type RegimeFiscal,
  quemTemConta,
} from "@/lib/fiscal/cadastro";

export function rotuloDoRegime(regime: RegimeFiscal): string {
  switch (regime) {
    case "mei":
      return "MEI";
    case "simples":
      return "Simples Nacional";
    case "presumido":
      return "Lucro Presumido";
    case "real":
      return "Lucro Real";
    case "nao_sei":
      return "Não sei, meu contador cuida";
  }
}

export function rotuloDaAtividade(atividade: AtividadeFiscal): string {
  switch (atividade) {
    case "comercio":
      return "Só comércio";
    case "com_servico":
      return "Tem serviço";
  }
}

// O que continua valendo para TODA loja, com ou sem estimativa: o caderno lê só
// o que a lojista lançou e o arquivo do contador não depende de regime.
const CAUDA_DA_FRASE =
  "Seu caderno de guias e o arquivo para o contador funcionam normalmente.";

// Uma frase por motivo. Presumido, Real e "Não sei" têm o mesmo texto com
// qualquer atividade (ali a atividade não muda nada); só o Simples fala dela.
// "Não sei, meu contador cuida" tem frase própria: dizer "para Não sei" seria
// um erro de português na tela de quem acabou de dizer que o contador cuida.
const ALVO_DA_FRASE: Record<MotivoSemConta, string> = {
  simples_com_servico: "para Simples Nacional com serviço",
  presumido: "para Lucro Presumido",
  real: "para Lucro Real",
  nao_sei: "quando o contador cuida dos impostos",
};

/**
 * A frase honesta de quem não tem conta ("Ainda não fazemos estimativa para
 * [regime/atividade]. Seu caderno de guias e o arquivo para o contador
 * funcionam normalmente."). `null` para quem TEM conta (MEI e Simples de só
 * comércio): ali a tela mostra o medidor ou a estimativa, nunca esta frase.
 */
export function fraseSemEstimativa(
  cadastro: Pick<CadastroFiscal, "regime" | "atividade">,
): string | null {
  const conta = quemTemConta(cadastro);
  if (conta.tipo !== "nenhuma") return null;
  return `Ainda não fazemos estimativa ${ALVO_DA_FRASE[conta.motivo]}. ${CAUDA_DA_FRASE}`;
}

// A trava "só o dono" (plano, seção 4). O texto é EXATO: é o caminho escrito
// para quem não pode alterar, e o suporte do IKCOUS procura por ele.
export const FRASE_SO_O_DONO_ALTERA =
  "Só o dono da loja altera o cadastro fiscal.";

export const FRASE_SEM_DONO_CADASTRADO =
  "Esta loja ainda não tem um dono cadastrado. Peça ao suporte do IKCOUS para cadastrar o dono; depois, recarregue a página.";

export const FRASE_NAO_CONFIRMOU_QUEM_PODE =
  "Não deu para confirmar quem pode alterar.";

export const ROTULO_TENTAR_DE_NOVO = "Tentar de novo";

/** As cinco situações de `useDonoDaLoja` que a tabela da seção 4 distingue. */
export type SituacaoDoDono =
  | "carregando"
  | "sou_o_dono"
  | "outro_e_o_dono"
  | "sem_dono"
  | "leitura_falhou";

/**
 * A frase que o cartão do cadastro mostra em cada situação. `null` = sem frase:
 * enquanto carrega o cartão fica travado em silêncio, e o dono edita.
 */
export function fraseDaSituacaoDoDono(situacao: SituacaoDoDono): string | null {
  switch (situacao) {
    case "carregando":
    case "sou_o_dono":
      return null;
    case "outro_e_o_dono":
      return FRASE_SO_O_DONO_ALTERA;
    case "sem_dono":
      return FRASE_SEM_DONO_CADASTRADO;
    case "leitura_falhou":
      return FRASE_NAO_CONFIRMOU_QUEM_PODE;
  }
}

// O medidor do limite do MEI (aba Impostos). TODO o texto do medidor mora neste bloco, num
// lugar só e fácil de trocar. Texto final decidido pelo sócio (dono aprovou o rumo).
//
// A receita do medidor vem do `fin_dre`, que só enxerga as vendas REGISTRADAS no app. Por
// isso o número é sempre um MÍNIMO: o que a lojista vendeu sem registrar aqui (Instagram,
// WhatsApp, feira) também conta para o limite e nunca entra. Dois casos, escolhidos por
// `coberturaDaReceitaDoAno` (medidor-mei.ts):
//  - cobertura COMPLETA (o app já registrava desde o começo do período medido): o medidor
//    mostra as faixas de sempre, mas todo veredito começa com "Pelo que o IKCOUS
//    registrou," e nunca afirma que "nada muda" ou que está tudo certo;
//  - cobertura PARCIAL: o número vem rotulado e NENHUMA frase conclui enquadramento sobre
//    ele (sem percentual, sem barra, sem veredito). Só passar do teto vira alerta, porque
//    o total real é igual ou MAIOR que o número do app: aí a conclusão é segura, e é por
//    isso que o alerta não repete a faixa "até 20%" / "mais de 20%".
// O aviso fixo só aparece nas telas COM número; nas telas sem número (data inválida, ano
// não conferido, falha ao somar) vale só a instrução daquela tela.

const NOMES_DOS_MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/** O mês por extenso de uma data `aaaa-mm-dd` ("2026-03-01" vira "março"); `null` se não for um mês. */
export function nomeDoMesDaData(data: string | null): string | null {
  if (data === null) return null;
  const mes = Number(data.slice(5, 7));
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return NOMES_DOS_MESES[mes - 1] ?? null;
}

const PELO_QUE_O_IKCOUS_REGISTROU = "Pelo que o IKCOUS registrou,";

/** Cada faixa do medidor de ano completo (a mesma do núcleo, `FaixaDoMei`). */
type FaixaDoVeredito = "dentro" | "excesso_ate_20" | "excesso_acima_20";

/**
 * O efeito de cada faixa no ano COMPLETO, conforme a LC 123 art. 18-A §7º, III e IV (e §§9º e
 * 10) e a Resolução CGSN 140/2018 art. 115 §2º, II, "a" (a lei nova, LC 238/2026, não mexeu
 * nisso). Tudo começa com "Pelo que o IKCOUS registrou,": o número é um mínimo. O prazo para
 * avisar é "até o último dia útil do mês seguinte ao do excesso".
 */
export function efeitoDoVeredito(
  faixa: FaixaDoVeredito,
  anoDeAbertura: boolean,
): string {
  if (faixa === "dentro") {
    return `${PELO_QUE_O_IKCOUS_REGISTROU} você está dentro do limite do MEI. Confira as vendas feitas por fora do app: elas também contam para o limite.`;
  }
  const prazo =
    "Avise a Receita até o último dia útil do mês seguinte ao do excesso.";
  if (faixa === "excesso_ate_20") {
    return anoDeAbertura
      ? `${PELO_QUE_O_IKCOUS_REGISTROU} você passou do limite proporcional em até 20%. Você deixa de ser MEI a partir de 1º de janeiro do ano seguinte. ${prazo}`
      : `${PELO_QUE_O_IKCOUS_REGISTROU} você passou do limite em até 20%. Você deixa de ser MEI a partir de 1º de janeiro do ano seguinte, e a diferença é paga, sem acréscimos, junto com o DAS de janeiro. ${prazo}`;
  }
  return anoDeAbertura
    ? `${PELO_QUE_O_IKCOUS_REGISTROU} você passou do limite proporcional em mais de 20%. Você deixa de ser MEI com efeito retroativo ao início da atividade e passa a pagar pelo Simples Nacional normal. ${prazo}`
    : `${PELO_QUE_O_IKCOUS_REGISTROU} você passou do limite em mais de 20%. Você deixa de ser MEI com efeito retroativo a 1º de janeiro do ano do excesso e passa a pagar pelo Simples Nacional normal. ${prazo}`;
}

export const TEXTOS_DO_MEDIDOR_DO_MEI = {
  /** Embaixo do medidor, SÓ nas telas com número (ano completo e incompleto). */
  avisoFixo:
    "Este número só tem as vendas registradas no IKCOUS. O que você vendeu sem registrar aqui (Instagram, WhatsApp, feira) também conta para o limite do MEI: some por sua conta.",
  /** O rótulo do número quando a cobertura é parcial. */
  rotuloDoNumeroParcial: "Vendas registradas no IKCOUS neste ano",
  /** O título de cada faixa no ano COMPLETO. */
  titulosDaFaixa: {
    dentro: `${PELO_QUE_O_IKCOUS_REGISTROU} você está dentro do limite`,
    excesso_ate_20: `${PELO_QUE_O_IKCOUS_REGISTROU} você passou do limite em até 20%`,
    excesso_acima_20: `${PELO_QUE_O_IKCOUS_REGISTROU} você passou do limite em mais de 20%`,
  },
  /** Por que não há veredito (cobertura parcial, abaixo do teto), um texto por motivo. */
  semVeredito: {
    sem_data_de_inicio:
      "Falta informar, no cadastro fiscal, o mês em que você começou a vender pelo IKCOUS. Sem isso, não dá para mostrar quanto do limite você já usou.",
    /** `desde`: a data de `vendeNoAppDesde`; sem mês legível, vale a frase genérica. */
    comecou_depois_do_inicio: (desde: string | null): string =>
      `O IKCOUS só tem as suas vendas ${
        nomeDoMesDaData(desde) !== null
          ? `a partir de ${nomeDoMesDaData(desde)}`
          : "a partir do mês em que você começou a vender por aqui"
      }. Para saber quanto do limite você já usou, some a este número o que você vendeu antes disso neste ano.`,
  },
  /** Cobertura parcial e o número do app já acima do teto do ano. */
  acimaDoLimiteComCoberturaParcial: {
    titulo: "Suas vendas no IKCOUS, sozinhas, já passam do limite",
    texto:
      "O limite conta todas as vendas do ano, registradas aqui ou não. Então o seu total é este número ou mais. Fale logo com um contador ou com o Sebrae, que atende MEI de graça: quem passa do limite tem prazo para avisar a Receita.",
  },
} as const;
