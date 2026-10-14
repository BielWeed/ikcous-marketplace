import { PRAZO_DE_RESPOSTA_EM_DIAS } from "@/config/textos-de-privacidade";
import type { Database } from "@/types/database.types";

/**
 * Pedidos de privacidade da cliente (migration 20261238000000): "excluir minha
 * conta" e "corrigir meu e-mail". O app só REGISTRA o pedido; a loja atende à mão
 * (docs/runbooks/atender-pedido-de-privacidade.md) — nada aqui apaga dado.
 */

export type TipoDoPedidoDePrivacidade = "excluir_conta" | "corrigir_email";
export type SituacaoDoPedidoDePrivacidade = "aberto" | "atendido" | "recusado";

export type PedidoDePrivacidade = Omit<
  Database["public"]["Tables"]["pedidos_de_privacidade"]["Row"],
  "tipo" | "situacao"
> & {
  tipo: TipoDoPedidoDePrivacidade;
  situacao: SituacaoDoPedidoDePrivacidade;
};

/** As colunas que a tela da LOJA lê (nunca `select *`: coluna nova não vaza sozinha). */
export const COLUNAS_DO_PEDIDO_DE_PRIVACIDADE =
  "id, user_id, tipo, email_novo, situacao, criado_em, atendido_em, atendido_por, observacao";

/**
 * As colunas que a tela da CLIENTE lê: só o que ela mostra. `atendido_por` (o
 * identificador de quem na loja respondeu) não é dela e nunca viaja até o
 * aparelho dela, mesmo a política de leitura deixando ver a linha inteira.
 */
export const COLUNAS_DO_PEDIDO_DA_CLIENTE =
  "id, user_id, tipo, email_novo, situacao, criado_em, atendido_em, observacao";

const TIPOS = new Set<string>(["excluir_conta", "corrigir_email"]);
const SITUACOES = new Set<string>(["aberto", "atendido", "recusado"]);

/**
 * O banco responde com `string`; a tela só aceita as formas que conhece. Linha de
 * forma estranha some da lista em vez de derrubar a tela (o banco também recusa
 * valor fora da lista por CHECK, então isto é só o cinto).
 */
export function lerPedidosDePrivacidade(
  linhas: readonly unknown[] | null | undefined,
): PedidoDePrivacidade[] {
  const lidos: PedidoDePrivacidade[] = [];
  for (const linha of linhas ?? []) {
    if (typeof linha !== "object" || linha === null) continue;
    const p = linha as Record<string, unknown>;
    if (
      typeof p.id !== "string" ||
      typeof p.user_id !== "string" ||
      typeof p.tipo !== "string" ||
      !TIPOS.has(p.tipo) ||
      typeof p.situacao !== "string" ||
      !SITUACOES.has(p.situacao) ||
      typeof p.criado_em !== "string"
    ) {
      continue;
    }
    lidos.push({
      id: p.id,
      user_id: p.user_id,
      tipo: p.tipo as TipoDoPedidoDePrivacidade,
      email_novo: typeof p.email_novo === "string" ? p.email_novo : null,
      situacao: p.situacao as SituacaoDoPedidoDePrivacidade,
      criado_em: p.criado_em,
      atendido_em: typeof p.atendido_em === "string" ? p.atendido_em : null,
      atendido_por: typeof p.atendido_por === "string" ? p.atendido_por : null,
      observacao: typeof p.observacao === "string" ? p.observacao : null,
    });
  }
  return lidos;
}

// A MESMA régua do banco (CHECK `pedidos_de_privacidade_email_formato_check`):
// algo@algo.algo, sem espaço, até 254 caracteres. O banco é a palavra final.
const FORMATO_DO_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TAMANHO_MAXIMO_DO_EMAIL = 254;

export type MotivoDeEmailRecusado = "vazio" | "formato" | "igual";

export type ResultadoDoEmail =
  | { ok: true; email: string }
  | { ok: false; motivo: MotivoDeEmailRecusado };

/** E-mail novo: tira espaço das pontas, põe em minúscula e confere o formato. */
export function validarEmailNovo(
  digitado: string,
  emailAtual: string | null | undefined,
): ResultadoDoEmail {
  const email = digitado.trim().toLowerCase();
  if (email === "") return { ok: false, motivo: "vazio" };
  if (email.length > TAMANHO_MAXIMO_DO_EMAIL || !FORMATO_DO_EMAIL.test(email)) {
    return { ok: false, motivo: "formato" };
  }
  if (email === (emailAtual ?? "").trim().toLowerCase()) {
    return { ok: false, motivo: "igual" };
  }
  return { ok: true, email };
}

export type FalhaDoPedido = "ja_existe" | "sem_sessao" | "sem_rede" | "outra";

function codigoDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("code" in erro)) {
    return null;
  }
  const { code } = erro as { code: unknown };
  return typeof code === "string" ? code : null;
}

/**
 * Classifica a falha de gravar/ler pelo CÓDIGO do Postgres (nunca pelo texto, que
 * a tela não mostra): 23505 = já existe pedido aberto igual (índice único); 42501
 * ou JWT vencido = sessão; sem código (TypeError de fetch, DOMException, aparelho
 * sem internet) = rede; o resto = "outra".
 */
export function classificarFalhaDoPedido(erro: unknown): FalhaDoPedido {
  const codigo = codigoDoErro(erro);
  if (codigo === "23505") return "ja_existe";
  if (codigo === "42501" || codigo === "PGRST301") return "sem_sessao";
  // Sem código: não veio do Postgres/PostgREST (fetch que não chegou, aborto).
  if (codigo === null || codigo === "") return "sem_rede";
  return "outra";
}

/** O pedido mais recente de cada tipo (a tela mostra um estado por tipo). */
export function ultimoPedidoDoTipo(
  pedidos: readonly PedidoDePrivacidade[],
  tipo: TipoDoPedidoDePrivacidade,
): PedidoDePrivacidade | null {
  let melhor: PedidoDePrivacidade | null = null;
  for (const pedido of pedidos) {
    if (pedido.tipo !== tipo) continue;
    if (melhor === null || pedido.criado_em > melhor.criado_em) melhor = pedido;
  }
  return melhor;
}

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Até quando a loja deve responder: a data do pedido mais o prazo prometido
 * (`PRAZO_DE_RESPOSTA_EM_DIAS`). Data ilegível = `null` (a tela não inventa prazo).
 */
export function prazoFinalDoPedido(criadoEm: string): Date | null {
  const inicio = new Date(criadoEm);
  if (Number.isNaN(inicio.getTime())) return null;
  return new Date(
    inicio.getTime() + PRAZO_DE_RESPOSTA_EM_DIAS * MILISSEGUNDOS_POR_DIA,
  );
}

/** O prazo de resposta já passou? (Só vale para pedido aberto.) */
export function prazoVencido(criadoEm: string, agora: Date): boolean {
  const fim = prazoFinalDoPedido(criadoEm);
  return fim !== null && agora.getTime() > fim.getTime();
}

/** 14/10/2026, no fuso do aparelho; data ilegível vira texto vazio. */
export function formatarDataDoPedido(quando: string | null): string {
  if (!quando) return "";
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR");
}
