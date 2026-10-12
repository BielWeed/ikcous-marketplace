/**
 * ADMIN DE AGORA — a conferência que as edges de dinheiro fazem antes de
 * qualquer efeito (04/10/2026). É a MESMA regra de `public.is_admin_atual()`
 * (migration 20261197000000), para o banco e as edges terem uma autoridade só:
 *
 *   - a sessão é validada no Auth (`auth.getUser()` com a chave pública): o
 *     GET /user carrega o usuário do BANCO, então `user.app_metadata.role` é o
 *     `auth.users.raw_app_meta_data` de AGORA — nunca as claims do JWT, que
 *     valem até expirar (um JWT velho dizendo admin não decide nada);
 *   - `profiles.role`, lido com a chave de serviço;
 *   - papel `admin` nas DUAS fontes. Contradição (rebaixado em uma só) NÃO é
 *     admin.
 *
 * Qualquer falha (sem sessão, Auth fora, perfil ausente, exceção) devolve
 * `null` — o lado seguro. Devolve o id do usuário quando é admin, para quem
 * precisa registrar QUEM agiu.
 *
 * Quem usa: `estornar-pagamento` (`verifyIsAdmin`) e a ação `cancelar` da
 * `criar-pagamento` (cancelar-pedido.ts). Não duplique esta regra: chame-a.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type OpcoesDoAdminAtual = {
  /** URL do projeto (SUPABASE_URL). */
  url: string;
  /** Chave pública (publishable/anon) — só para validar a sessão. */
  chavePublica: string;
  /** Chave de serviço — só para ler `profiles`. */
  chaveDeServico: string;
  /** Costura de teste: em produção, o `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Prefixo do log de falha (nome da edge). */
  rotulo?: string;
};

export async function adminAtualDaSessao(
  authorization: string | null,
  opcoes: OpcoesDoAdminAtual,
): Promise<string | null> {
  if (!authorization) return null;
  try {
    const comFetch = opcoes.fetchImpl ? { fetch: opcoes.fetchImpl } : {};
    const doUsuario = createClient(opcoes.url, opcoes.chavePublica, {
      global: { ...comFetch, headers: { Authorization: authorization } },
    });
    const { data: { user }, error: erroUsuario } = await doUsuario.auth.getUser();
    if (erroUsuario || !user?.id) return null;
    const { data: perfil, error: erroPerfil } = await createClient(
      opcoes.url,
      opcoes.chaveDeServico,
      { global: comFetch },
    )
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (erroPerfil || !perfil) return null;
    return perfil.role === "admin" && user.app_metadata?.role === "admin" ? user.id : null;
  } catch (erro) {
    console.error(`${opcoes.rotulo ?? "[admin-atual]"} Falha no check de admin:`, erro);
    return null;
  }
}
