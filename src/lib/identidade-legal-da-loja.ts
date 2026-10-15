// QUEM É A LOJA, em termos legais: razão social (ou nome do titular), CNPJ ou
// CPF e e-mail de atendimento (migration 20261239000000). Os três são OPCIONAIS
// e públicos — a lojista os digita em Minha loja › Dados da empresa e a cliente
// os lê nos Termos, na Política de Privacidade, no bloco de contato e no
// rodapé da vitrine. Loja que não preenche nada não muda para ninguém.
//
// Arquivo PEQUENO e sem texto jurídico, de propósito: o rodapé da Home o
// importa, e `politicas-peso-do-rodape.test.ts` proíbe o texto grande
// (`textos-das-politicas.ts`) no caminho do rodapé. Funções puras, sem I/O.
//
// O DÍGITO VERIFICADOR é conferido AQUI e só aqui; o banco garante apenas a
// FORMA (11 dígitos, ou 12 caracteres [0-9A-Z] + 2 dígitos). Duas contas do
// mesmo documento em dois lugares acabam divergindo.

import { cpfValido } from "@/lib/cpf";

export type TipoDeDocumento = "cpf" | "cnpj";

/** O que a vitrine mostra: cada campo já pronto para a tela, ou `null`. */
export interface IdentidadeLegalDaLoja {
  readonly razaoSocial: string | null;
  readonly tipoDoDocumento: TipoDeDocumento | null;
  /** Já com máscara (`11.222.333/0001-81`), nunca um documento sem DV certo. */
  readonly documento: string | null;
  readonly email: string | null;
}

/** O pedaço do config que importa aqui (lido da `v_store_config`). */
export interface ConfigComIdentidadeLegal {
  readonly storeLegalName?: string | null;
  readonly storeLegalDocument?: string | null;
  readonly storeSupportEmail?: string | null;
}

/** Limite da coluna no banco (CHECK da 20261239000000). */
const LIMITE_DA_RAZAO_SOCIAL = 200;
/** Limite de um e-mail (RFC 5321). Também é a CHECK do banco. */
const LIMITE_DO_EMAIL = 254;

// Mesma forma da CHECK do banco: um @, nada de espaço, um ponto no domínio.
const FORMA_DO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Só letras e números, em maiúsculas: tira máscara, espaço e pontuação. */
function limparDocumento(valor: string | null | undefined): string {
  return (valor ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

// Valor de cada caractere no cálculo do CNPJ: código ASCII menos 48. Dígitos
// valem 0 a 9 (como sempre valeram) e as letras do CNPJ alfanumérico (A=17 …
// Z=42). Por isso o CNPJ numérico antigo passa pela MESMA conta.
function valorDoCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}

const PESOS_DO_PRIMEIRO_DV = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DO_SEGUNDO_DV = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digitoDoCnpj(base: string, pesos: readonly number[]): number {
  let soma = 0;
  pesos.forEach((peso, i) => {
    soma += valorDoCaractere(base.charAt(i)) * peso;
  });
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cnpjValido(limpo: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(limpo)) return false;
  // Sequência repetida passa na conta e nunca é um CNPJ de verdade.
  if (/^(.)\1+$/.test(limpo)) return false;
  const d1 = digitoDoCnpj(limpo.slice(0, 12), PESOS_DO_PRIMEIRO_DV);
  if (d1 !== Number(limpo.charAt(12))) return false;
  const d2 = digitoDoCnpj(limpo.slice(0, 13), PESOS_DO_SEGUNDO_DV);
  return d2 === Number(limpo.charAt(13));
}

/**
 * `"cpf"`, `"cnpj"` ou `null` (documento que não confere). Aceita com ou sem
 * máscara e em qualquer caixa. CPF é só número; CNPJ aceita letras (o CNPJ
 * alfanumérico da Receita, em vigor desde julho de 2026).
 */
export function documentoValido(
  valor: string | null | undefined,
): TipoDeDocumento | null {
  const limpo = limparDocumento(valor);
  if (limpo.length === 11) return cpfValido(limpo) ? "cpf" : null;
  if (limpo.length === 14) return cnpjValido(limpo) ? "cnpj" : null;
  return null;
}

/**
 * A máscara do documento. Para o que já tem DV certo é exata; no meio da
 * digitação segue o comprimento: até 11 dígitos, máscara de CPF; mais que isso
 * (ou com letra), máscara de CNPJ.
 */
export function formatarDocumento(valor: string | null | undefined): string {
  const limpo = limparDocumento(valor).slice(0, 14);
  if (limpo.length === 0) return "";
  if (limpo.length <= 11 && /^[0-9]+$/.test(limpo)) {
    let r = limpo.slice(0, 3);
    if (limpo.length > 3) r += `.${limpo.slice(3, 6)}`;
    if (limpo.length > 6) r += `.${limpo.slice(6, 9)}`;
    if (limpo.length > 9) r += `-${limpo.slice(9, 11)}`;
    return r;
  }
  let r = limpo.slice(0, 2);
  if (limpo.length > 2) r += `.${limpo.slice(2, 5)}`;
  if (limpo.length > 5) r += `.${limpo.slice(5, 8)}`;
  if (limpo.length > 8) r += `/${limpo.slice(8, 12)}`;
  if (limpo.length > 12) r += `-${limpo.slice(12, 14)}`;
  return r;
}

/** E-mail com forma de e-mail (um @, domínio com ponto, sem espaço), até 254. */
export function emailDeAtendimentoValido(
  valor: string | null | undefined,
): boolean {
  const email = (valor ?? "").trim();
  return email.length <= LIMITE_DO_EMAIL && FORMA_DO_EMAIL.test(email);
}

function aparar(valor: string | null | undefined): string {
  return (valor ?? "").trim().replace(/\s+/g, " ");
}

export interface EntradaDaIdentidadeLegal {
  readonly razaoSocial: string;
  readonly documento: string;
  readonly email: string;
}

export interface ErrosDaIdentidadeLegal {
  readonly razaoSocial?: string;
  readonly documento?: string;
  readonly email?: string;
}

export type IdentidadeLegalParaGravar =
  | {
      readonly valido: true;
      /** Chaves do config; `null` = "a loja não disse" (a ausência é UMA só). */
      readonly valores: {
        readonly storeLegalName: string | null;
        readonly storeLegalDocument: string | null;
        readonly storeSupportEmail: string | null;
      };
    }
  | { readonly valido: false; readonly erros: ErrosDaIdentidadeLegal };

export const AVISO_DO_DOCUMENTO =
  "Esse CNPJ ou CPF não confere. Confira os números — ou deixe em branco.";
export const AVISO_DO_EMAIL =
  "Esse e-mail não parece certo. Use o formato nome@dominio.com — ou deixe em branco.";
export const AVISO_DA_RAZAO_SOCIAL = `A razão social aceita até ${LIMITE_DA_RAZAO_SOCIAL} letras.`;

/**
 * O que a lojista digitou → o que vai ao banco. Campo em branco é válido e vira
 * `null`. Valor errado NÃO grava: devolve TODOS os erros de uma vez, para a
 * lojista corrigir tudo numa volta só.
 */
export function identidadeLegalParaGravar(
  entrada: EntradaDaIdentidadeLegal,
): IdentidadeLegalParaGravar {
  const razaoSocial = aparar(entrada.razaoSocial);
  const documentoLimpo = limparDocumento(entrada.documento);
  const email = (entrada.email ?? "").trim();

  const erros: {
    razaoSocial?: string;
    documento?: string;
    email?: string;
  } = {};
  if (razaoSocial.length > LIMITE_DA_RAZAO_SOCIAL) {
    erros.razaoSocial = AVISO_DA_RAZAO_SOCIAL;
  }
  if (documentoLimpo.length > 0 && documentoValido(documentoLimpo) === null) {
    erros.documento = AVISO_DO_DOCUMENTO;
  }
  if (email.length > 0 && !emailDeAtendimentoValido(email)) {
    erros.email = AVISO_DO_EMAIL;
  }
  if (Object.keys(erros).length > 0) return { valido: false, erros };

  return {
    valido: true,
    valores: {
      storeLegalName: razaoSocial || null,
      storeLegalDocument: documentoLimpo || null,
      storeSupportEmail: email || null,
    },
  };
}

/**
 * O que a vitrine lê do config. `null` quando a loja não preencheu NADA (o
 * resto do app segue exatamente como era). Defensivo: um documento ou e-mail
 * que chegou por fora e não confere NÃO é mostrado — melhor omitir do que
 * publicar um CNPJ que não existe.
 */
export function identidadeLegalDaLoja(
  config: ConfigComIdentidadeLegal | null | undefined,
): IdentidadeLegalDaLoja | null {
  if (!config) return null;
  const razaoSocial = aparar(config.storeLegalName) || null;
  const tipo = documentoValido(config.storeLegalDocument);
  const documento = tipo ? formatarDocumento(config.storeLegalDocument) : null;
  const emailBruto = (config.storeSupportEmail ?? "").trim();
  const email =
    emailBruto && emailDeAtendimentoValido(emailBruto) ? emailBruto : null;

  if (!razaoSocial && !documento && !email) return null;
  return { razaoSocial, tipoDoDocumento: tipo, documento, email };
}

/**
 * "Responsável: <razão social> — CNPJ <n> — contato: <e-mail>", só com o que
 * existe. Sem razão social e sem documento não há responsável a declarar
 * (só o e-mail não diz QUEM é): devolve `null`, e o e-mail aparece no bloco de
 * contato.
 */
export function linhaDoResponsavel(
  identidade: IdentidadeLegalDaLoja | null | undefined,
): string | null {
  if (!identidade) return null;
  if (!identidade.razaoSocial && !identidade.documento) return null;
  const partes: string[] = [];
  if (identidade.razaoSocial) partes.push(identidade.razaoSocial);
  if (identidade.documento && identidade.tipoDoDocumento) {
    partes.push(
      `${identidade.tipoDoDocumento === "cnpj" ? "CNPJ" : "CPF"} ${identidade.documento}`,
    );
  }
  if (identidade.email) partes.push(`contato: ${identidade.email}`);
  return `Responsável: ${partes.join(" — ")}`;
}
