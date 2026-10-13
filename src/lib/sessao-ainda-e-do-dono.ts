import { supabase } from "@/lib/supabase";

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
 * O uid de GUARDAR não vem daqui — vem do contexto de auth (`user.id`), que
 * continua certo no tablet offline.
 */
export async function sessaoAindaEhDoDono(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id === userId;
  } catch {
    return false;
  }
}
