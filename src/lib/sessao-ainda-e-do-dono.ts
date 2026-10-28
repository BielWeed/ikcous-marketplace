import { supabase } from "@/lib/supabase";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * L10 — `true` só se a sessão que o cliente Supabase usa AGORA é a do dono da
 * fila. Conferida antes de CADA envio de uma fila offline: a passada começa
 * com o admin A, a tela troca de conta no meio (tablet de balcão) e o resto
 * da fila sairia com o login do B.
 *
 * Sessão ausente, de outro usuário, ou qualquer falha ao lê-la = `false`
 * ("não sei" nunca vira "pode enviar"). Só se chama ONLINE (a passada já
 * recusa começar sem rede): com token vencido e sem rede o `getSession()`
 * devolveria null, mas aí não há envio a fazer de qualquer jeito.
 *
 * `aoFalharPorRede` (opcional) é chamado quando o `false` veio de a renovação
 * do token não ter saído por falta de internet (o supabase-js 2.117 devolve
 * `session: null` com um erro de rede) -- quem quer dizer "sem conexão" em vez
 * de "sessão expirou" usa esse aviso. O retorno não muda: continua `false`.
 *
 * O uid de GUARDAR não vem daqui — vem do contexto de auth (`user.id`), que
 * continua certo no tablet offline.
 */
export async function sessaoAindaEhDoDono(
  userId: string,
  aoFalharPorRede?: () => void,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (data?.session?.user?.id === userId) return true;
    if (!data?.session && isAuthRetryableFetchError(error)) aoFalharPorRede?.();
    return false;
  } catch {
    return false;
  }
}
