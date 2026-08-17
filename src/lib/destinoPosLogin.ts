import type { View } from "@/types";

/**
 * As únicas views para as quais `handleNavigate` (App.tsx) redireciona ao
 * `auth` por falta de conta. `requested` só é honrado se pertencer a este
 * conjunto — `history.state` é gravável pela própria página, então um valor
 * fora daqui é tratado como lixo, nunca como destino.
 *
 * Esta lista existe em MAIS DOIS lugares, sem nada amarrando os três:
 * `App.tsx` (o `if` de `handleNavigate`, perto de "profile" || "account-
 * settings" || "address-form") e `App.tsx` (o mesmo `if`, na sincronização
 * de rota via `popstate`). Adicionar uma quarta view redirecionável exige
 * mudar os três — os dois em `App.tsx` quebram na cara (a pessoa não é
 * redirecionada), mas esquecer este aqui falha em silêncio: a pessoa volta
 * ao perfil depois de logar em vez de ir para a view nova.
 */
const VIEWS_REDIRECIONAVEIS = new Set<string>([
  "profile",
  "account-settings",
  "address-form",
]);

function comoRegistro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null
    ? (valor as Record<string, unknown>)
    : null;
}

/**
 * Destino do cliente depois de entrar (ou criar conta), calculado a partir
 * de `globalThis.history.state`. Quando devolve uma `View`, é para navegação
 * ABSOLUTA (`handleNavigate(view)`), nunca "volte uma entrada no
 * histórico". Essa escolha existe porque `history.back()` era a única
 * operação relativa de um App em que todo o resto é absoluto, e só por
 * causa dela uma versão anterior desta função precisou de uma trava de
 * idempotência: `AuthView.tsx` dispara `onSuccess` duas vezes no mesmo
 * login (uma em `handleSubmit`, outra no `useEffect` que reage ao `user`
 * sair de `null`), e `history.back()` andava duas entradas na segunda
 * chamada — medido no Chrome real.
 *
 * Devolver a própria view absoluta em vez de "voltar" NÃO bastou sozinho:
 * entre a chamada #1 e a chamada #2 de `onSuccess`, `handleNavigate` já
 * terminou de navegar e já sobrescreveu `history.state` com o `pushState`
 * do DESTINO (`{view: destino, from: "auth"}`) — o `from: "checkout"` (ou
 * `cart`) que a chamada #1 leu não existe mais. A chamada #2 lia esse
 * estado novo e caía sempre no perfil, sobrescrevendo uma navegação que já
 * tinha acertado. Por isso a devolução passou a ser `View | null`: `null`
 * significa "esta chamada já não está olhando a entrada de histórico do
 * login — não navegue".
 *
 * Ordem de precedência das regras (ver o teste de precedência abaixo):
 *   0. `state` é um objeto com um campo `view` que é STRING e diferente de
 *      "auth" — já saiu da tela de login (é o `pushState` do destino, não
 *      o do login). Devolve `null`. Só vale para `view` string: `state`
 *      nulo/undefined/lixo ou objeto sem `view` NÃO cai aqui — continua
 *      nas regras abaixo, terminando em "profile". Essa distinção importa
 *      de verdade: quem confirma cadastro pelo link do e-mail chega numa
 *      aba nova com `history.state` nulo, e precisa ser mandado ao perfil,
 *      não travado na tela de login.
 *   1. `requested` presente e pertencente a `VIEWS_REDIRECIONAVEIS` — a
 *      view que a pessoa pediu e foi barrada por falta de conta.
 *   2. `from` igual a "checkout" ou "cart" — de onde ela veio.
 *   3. qualquer outra coisa (inclusive `state` nulo, lixo, `from`
 *      desconhecido) — cai no perfil.
 */
export function destinoPosLogin(state: unknown): View | null {
  const registro = comoRegistro(state);

  const view = registro?.view;
  if (typeof view === "string" && view !== "auth") {
    return null;
  }

  const requested = registro?.requested;
  if (typeof requested === "string" && VIEWS_REDIRECIONAVEIS.has(requested)) {
    return requested as View;
  }

  const from = registro?.from;
  if (from === "checkout" || from === "cart") {
    return from as View;
  }

  return "profile";
}
