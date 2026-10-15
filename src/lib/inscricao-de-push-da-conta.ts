import { supabase } from "@/lib/supabase";

// A inscrição de notificação push nasce no NAVEGADOR (um endpoint por
// navegador/aparelho) e é gravada em `push_subscriptions` com o `user_id` de
// quem estava logado. Quem sai da conta não leva a inscrição junto: ela fica
// no navegador, no nome dele. O push dirigido a ele (o aviso do pedido dele,
// o que o lojista mandar) passava a cair no celular de quem entrasse depois, e
// o aviso do lojista que saiu continuava chegando no aparelho dele.
//
// A RLS da tabela (`push_subscriptions_all_policy`: dono OU admin) deixa cada
// conta mexer só nas SUAS linhas — a conta nova não consegue assumir nem
// apagar a linha de quem saiu. Por isso a limpeza tem de acontecer enquanto a
// sessão de quem sai ainda existe (`cancelarInscricaoDaConta`, antes do
// `signOut`), e, quando já não há sessão (outra aba saiu, a sessão expirou, a
// conta mudou direto), o que sobra é desinscrever o navegador
// (`soltarInscricaoDoAparelho`): o endpoint morre, o provedor de push passa a
// responder 404/410 e o `send-push` apaga a linha órfã sozinho.
//
// Nada daqui lança. Sair da conta nunca pode falhar nem demorar por causa de
// push.

/** Quanto o "Sair" espera, no máximo, pela limpeza do push. */
export const PRAZO_DO_PUSH_NO_LOGOUT_MS = 3000;

function temPush(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.serviceWorker !== undefined &&
    navigator.serviceWorker !== null &&
    typeof globalThis.PushManager !== "undefined"
  );
}

// `getRegistration()` e não `ready`: `ready` NUNCA resolve quando não há
// service worker ativo (aba nova, navegador que bloqueou), e o logout
// esperaria o prazo inteiro à toa. `getRegistration()` responde na hora.
async function inscricaoDoNavegador(): Promise<PushSubscription | null> {
  try {
    if (!temPush()) return null;
    const container = navigator.serviceWorker;
    if (typeof container.getRegistration !== "function") return null;
    const registro = await container.getRegistration();
    if (!registro) return null;
    return (await registro.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

async function desinscreverNoNavegador(
  inscricao: PushSubscription,
): Promise<void> {
  try {
    await inscricao.unsubscribe();
  } catch (erro) {
    console.warn("[push] Não foi possível desinscrever o navegador:", erro);
  }
}

async function apagarLinhaDaConta(
  endpoint: string,
  userId: string,
): Promise<void> {
  try {
    // `user_id` no filtro além da RLS: o admin enxerga (e poderia apagar) a
    // linha de qualquer conta, e aqui só interessa a da conta que está saindo.
    const { error } = await (supabase.from("push_subscriptions" as any) as any)
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", userId);
    if (error) {
      console.warn("[push] Não foi possível apagar a inscrição:", error);
    }
  } catch (erro) {
    console.warn("[push] Não foi possível apagar a inscrição:", erro);
  }
}

/**
 * Desinscreve o navegador, SEM falar com o servidor. Para quando a sessão já
 * acabou (ou já é de outra conta) e a linha da conta anterior não é mais
 * nossa para apagar.
 */
export async function soltarInscricaoDoAparelho(): Promise<void> {
  const inscricao = await inscricaoDoNavegador();
  if (inscricao) await desinscreverNoNavegador(inscricao);
}

/**
 * Cancela a inscrição DESTE aparelho para a conta que está saindo: apaga a
 * linha dela no servidor (a sessão ainda vale — chame ANTES do `signOut`) e
 * desinscreve o navegador. As duas coisas andam em paralelo e uma não depende
 * da outra: o servidor com rede ruim não segura o navegador, e o navegador
 * desinscrito já basta para o push parar de chegar.
 *
 * Volta em, no máximo, `prazoMs`. Passado o prazo o trabalho que ficou no ar
 * segue sozinho e ninguém o espera.
 */
export async function cancelarInscricaoDaConta(
  userId: string,
  prazoMs: number = PRAZO_DO_PUSH_NO_LOGOUT_MS,
): Promise<void> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<void>((resolve) => {
    relogio = setTimeout(resolve, prazoMs);
  });
  const trabalho = (async () => {
    const inscricao = await inscricaoDoNavegador();
    if (!inscricao) return;
    await Promise.allSettled([
      apagarLinhaDaConta(inscricao.endpoint, userId),
      desinscreverNoNavegador(inscricao),
    ]);
  })().catch(() => {});
  try {
    await Promise.race([trabalho, prazo]);
  } finally {
    clearTimeout(relogio);
  }
}

export type DonoDaInscricao = "esta-conta" | "outra-conta" | "desconhecido";

/**
 * De quem é a inscrição que este navegador tem, do ponto de vista da conta
 * `userId`. A RLS esconde a linha das outras contas, então "nenhuma linha
 * minha" vale como "não é minha" (de outra conta, ou já apagada — nos dois
 * casos esta conta não recebe nada por ela). Só afirma "outra-conta" quando
 * a consulta FOI feita com a sessão desta conta e voltou sem erro: sem isso
 * a consulta iria como anônima, voltaria vazia, e uma inscrição boa seria
 * destruída. Na dúvida, "desconhecido" (não se destrói o que não se sabe).
 */
export async function dequemEAInscricao(
  endpoint: string,
  userId: string,
): Promise<DonoDaInscricao> {
  try {
    const { data: sessao } = await supabase.auth.getSession();
    if (sessao?.session?.user?.id !== userId) return "desconhecido";
    const { data, error } = await (
      supabase.from("push_subscriptions" as any) as any
    )
      .select("user_id")
      .eq("endpoint", endpoint);
    if (error || !Array.isArray(data)) return "desconhecido";
    return data.some((linha: { user_id?: unknown }) => linha.user_id === userId)
      ? "esta-conta"
      : "outra-conta";
  } catch {
    return "desconhecido";
  }
}
