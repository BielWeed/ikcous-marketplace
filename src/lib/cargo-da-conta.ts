// Mudar o cargo de uma conta (cliente <-> administrador) pelo painel.
//
// Quem decide é o BANCO: a função `definir_cargo(p_user_id, p_cargo)` só
// aceita 'admin' ou 'customer', só deixa o "dono da loja" chamar e recusa os
// demais com mensagem em português (42501 sem permissão, 22023 cargo inválido,
// P0002 pessoa inexistente). A tela só chama e traduz o que o banco devolve —
// nunca decide quem pode (esconder o botão é conforto, não segurança).
import { supabase } from "@/lib/supabase";

export type CargoDaConta = "admin" | "customer";

export type ResultadoDoCargo =
  | { readonly ok: true; readonly para: CargoDaConta; readonly mudou: boolean }
  | {
      readonly ok: false;
      readonly mensagem: string;
      readonly codigo: string | null;
    };

export const MENSAGEM_FUNCAO_INATIVA =
  "Esta função ainda não está ativa nesta loja.";
export const MENSAGEM_SEM_REDE =
  "Sem conexão com a internet. Confira a rede e tente de novo.";
export const MENSAGEM_DONO_INCOMPLETO =
  "O cadastro do dono da loja está incompleto. Fale com o suporte para acertar.";
const MENSAGEM_GENERICA =
  "Não foi possível mudar o acesso agora. Tente de novo em instantes.";

// Copiada de `mensagemDoErro` (src/lib/devolucao.ts): importar aquele módulo
// só por esta expressão puxaria a tela de devolução inteira para o cartão.
const RE_REDE =
  /failed to fetch|networkerror|network request failed|load failed/i;

// O cliente do Supabase ainda não conhece esta função nos tipos gerados
// (src/types/database.types.ts é gerado e compartilhado): tipo mínimo local.
interface ClienteComRpc {
  rpc(
    funcao: "definir_cargo",
    argumentos: { p_user_id: string; p_cargo: CargoDaConta },
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function campo(objeto: unknown, nome: string): unknown {
  return objeto && typeof objeto === "object"
    ? Object.getOwnPropertyDescriptor(objeto, nome)?.value
    : undefined;
}

/** Traduz o erro do banco/rede na frase que o leigo lê. */
function falha(erro: unknown): ResultadoDoCargo {
  const codigo = texto(campo(erro, "code")) || null;
  const mensagem =
    texto(campo(erro, "message")) ||
    (erro instanceof Error ? erro.message.trim() : "");

  if (codigo === "PGRST202") {
    return { ok: false, codigo, mensagem: MENSAGEM_FUNCAO_INATIVA };
  }
  if (RE_REDE.test(mensagem)) {
    return { ok: false, codigo, mensagem: MENSAGEM_SEM_REDE };
  }
  // O dono não está como administrador nas duas fontes (auth.users e
  // profiles): o texto do banco cita tabela, e isso não é para o lojista.
  if (codigo === "42501" && /duas fontes/i.test(mensagem)) {
    return { ok: false, codigo, mensagem: MENSAGEM_DONO_INCOMPLETO };
  }
  return { ok: false, codigo, mensagem: mensagem || MENSAGEM_GENERICA };
}

/**
 * Chama `definir_cargo`. Nunca lança: falha de rede, função ausente na loja e
 * recusa do banco voltam como `{ ok: false, mensagem }` pronta para o toast.
 */
export async function definirCargo(
  userId: string,
  cargo: CargoDaConta,
): Promise<ResultadoDoCargo> {
  try {
    const { data, error } = await (supabase as unknown as ClienteComRpc).rpc(
      "definir_cargo",
      { p_user_id: userId, p_cargo: cargo },
    );
    if (error) return falha(error);
    const para = campo(data, "para");
    const mudou = campo(data, "mudou");
    return {
      ok: true,
      para: para === "admin" || para === "customer" ? para : cargo,
      mudou: typeof mudou === "boolean" ? mudou : true,
    };
  } catch (erro) {
    return falha(erro);
  }
}

/**
 * O toast de sucesso. Sem gênero ("administrador" vale para qualquer pessoa).
 * Promoção: a sessão que a pessoa já tem aberta pode guardar a resposta
 * antiga, então pedimos para sair e entrar. Remoção: a leitura do cargo vem do
 * token de acesso, que dura até cerca de 1 hora — nunca prometemos "na hora".
 */
export function textoDoSucesso(nome: string, para: CargoDaConta): string {
  const quem = nome.trim() || "Esta pessoa";
  return para === "admin"
    ? `${quem} agora é administrador. Peça para essa pessoa sair e entrar de novo no app.`
    : `${quem} voltou a ser cliente. O acesso ao painel pode levar até cerca de 1 hora para acabar por completo.`;
}
