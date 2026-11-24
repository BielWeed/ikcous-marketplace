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
