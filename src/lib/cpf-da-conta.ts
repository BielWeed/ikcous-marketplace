// O CPF MORA NA CONTA (23/09/2026) — única porta entre a tela e
// `profiles.cpf`, embrulhando as RPCs `get_my_cpf`/`set_my_cpf`
// (supabase/migrations/20261173000000_o_cpf_mora_na_conta.sql,
// SECURITY DEFINER, só `authenticated`, sempre a PRÓPRIA linha via
// `auth.uid()`). Nenhuma outra parte do app lê/grava `profiles.cpf`
// diretamente — perfil, checkout e cadastro passam por aqui.
//
// AJUSTE DE SEGURANÇA (23/09/2026, pedido do dono): NUNCA devolver nem
// exibir `error.message`/`details`/`hint` da RPC ou do PostgREST, nem
// texto de erro de rede — mensagem de erro do Postgres pode mudar sem
// aviso, e erro de CONVERSÃO costuma ecoar o VALOR do parâmetro
// ("invalid input syntax for type ...: <valor>"). O contrato daqui para
// fora é um resultado DISCRIMINADO por `motivo`, mapeado só pelo
// `error.code` (SQLSTATE) que a migration atribui de propósito — qualquer
// código desconhecido (ou falha de rede) vira "falha" genérica. Quem
// chama nunca vê texto do servidor; a mensagem que aparece na tela é
// SEMPRE fixa (`mensagemFalhaCpf`, abaixo). Nada aqui usa `console.*`: o
// erro bruto (que pode carregar o CPF) nunca é logado.
import { somenteDigitosDoCpf } from "@/lib/cpf";
import { supabase } from "@/lib/supabase";

export type MotivoFalhaCpf = "sem_sessao" | "cpf_invalido" | "falha";

export type ResultadoLeituraCpf =
  | { ok: true; cpf: string | null }
  | { ok: false; motivo: MotivoFalhaCpf };

export type ResultadoGravacaoCpf =
  | { ok: true }
  | { ok: false; motivo: MotivoFalhaCpf };

// ERRCODE customizado que `set_my_cpf` atribui a cada família de recusa
// (ver o corpo da função na migration) — CPF01 = CPF inválido (qualquer
// uma das três checagens), CPF02 = sem sessão dentro da função. 42501 é o
// código PADRÃO do Postgres para "sem privilégio" (`insufficient_
// privilege`): como o `REVOKE ALL ... FROM PUBLIC, anon` tira a permissão
// de EXECUTAR a função, uma chamada sem sessão autenticada nem chega a
// entrar no corpo — o banco recusa antes, com esse código.
const ERRCODE_CPF_INVALIDO = "CPF01";
const ERRCODE_SEM_SESSAO = "CPF02";
const ERRCODE_SEM_PRIVILEGIO = "42501";

function motivoPorCodigo(code: string | undefined): MotivoFalhaCpf {
  if (code === ERRCODE_SEM_SESSAO || code === ERRCODE_SEM_PRIVILEGIO) {
    return "sem_sessao";
  }
  if (code === ERRCODE_CPF_INVALIDO) return "cpf_invalido";
  return "falha";
}

/** Mensagem FIXA em português por motivo — nunca o texto que o servidor
 * mandou. `contexto` deixa o chamador apontar onde a pessoa pode tentar de
 * novo (perfil, checkout, cadastro têm caminhos diferentes). */
export function mensagemFalhaCpf(
  motivo: MotivoFalhaCpf,
  contexto?: string,
): string {
  if (motivo === "cpf_invalido") {
    return "CPF inválido. Confira os números e tente de novo.";
  }
  if (motivo === "sem_sessao") {
    return "Entre na conta para salvar o CPF.";
  }
  const onde = contexto ?? "Minha conta > Informações pessoais";
  return `Não foi possível salvar o CPF agora. Tente de novo em ${onde}.`;
}

/**
 * Lê o CPF gravado na conta logada. Best-effort: qualquer recusa vira
 * `{ ok: false, motivo }` (nunca lança), então prefill de tela nenhuma
 * precisa de try/catch.
 */
export async function lerCpfDaConta(): Promise<ResultadoLeituraCpf> {
  try {
    const { data, error } = await supabase.rpc("get_my_cpf");
    if (error) {
      return {
        ok: false,
        motivo: motivoPorCodigo((error as { code?: string }).code),
      };
    }
    return { ok: true, cpf: (data as string | null) ?? null };
  } catch {
    return { ok: false, motivo: "falha" };
  }
}

/**
 * Grava (ou limpa, com `cpf` vazio) o CPF da conta logada. Normaliza para
 * só dígitos antes de mandar — o mesmo contrato que `set_my_cpf` já impõe
 * no servidor.
 */
export async function gravarCpfDaConta(
  cpf: string,
): Promise<ResultadoGravacaoCpf> {
  try {
    const { error } = await supabase.rpc("set_my_cpf", {
      p_cpf: somenteDigitosDoCpf(cpf),
    });
    if (error) {
      return {
        ok: false,
        motivo: motivoPorCodigo((error as { code?: string }).code),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, motivo: "falha" };
  }
}
