import type { View } from "@/types";

/**
 * As únicas views para as quais `handleNavigate` (App.tsx) redireciona ao
 * `auth` por falta de conta. `requested` só é honrado se pertencer a este
 * conjunto — `history.state` é gravável pela própria página, então um valor
 * fora daqui é tratado como lixo, nunca como destino.
 *
 * Esta lista existe em MAIS DOIS lugares, sem nada amarrando os três:
 * `App.tsx` (o `if` de `handleNavigate`, perto de "user-profile" ||
 * "profile" || "account-settings" || "address-form") e `App.tsx` (o mesmo
 * `if`, na sincronização de rota via `popstate`). Adicionar uma quinta view
 * redirecionável exige mudar os três — os dois em `App.tsx` quebram na cara
 * (a pessoa não é redirecionada), mas esquecer este aqui falha em silêncio:
 * a pessoa volta ao perfil depois de logar em vez de ir para a view nova
 * (foi o que aconteceu com "user-profile" no #561, corrigido em 13/09/2026).
 *
 * `admin-orders` (14/10/2026) é a exceção que NÃO passa por aquele `if`: o
 * painel sem conta é tratado por `painelSemContaPedeEntrada` (abaixo), usada
 * nos dois pontos de `App.tsx` (leitura do endereço e `handleNavigate`). Ela
 * está aqui porque é a única tela do painel que um aviso (push de "pedido
 * novo") abre — a lojista que toca nele sem sessão entra e volta para os
 * pedidos. NÃO é uma permissão: quem entra e não é admin continua barrada
 * pelo portão de admin do App (`adminStatus`) e pelo servidor (`is_admin`).
 * `admin` (26/10/2026) é a porta do painel: a lojista cuja sessão venceu e
 * abriu `/admin` entrava de novo e caía no Perfil de cliente, com o pedido
 * guardado e ignorado. É tela sem `id` nem formulário, e a permissão continua
 * sendo do portão do App e do servidor.
 * `admin-settings` e `admin-product-form` (18/11/2026) entraram pelo mesmo
 * motivo: são as telas em que a lojista fica com a sessão aberta enquanto
 * trabalha (os Ajustes, e o produto em edição, que tem rascunho por conta), e a
 * que perdia a sessão ali entrava de novo e caía no Perfil de cliente, tendo de
 * reencontrar a edição. O produto leva o `id` (uuid, validado por
 * `idDeProdutoDoPainel`); os Ajustes não têm id. A permissão segue sendo do
 * portão do App (`isAdmin`) e do servidor: quem entra e não é admin vai à
 * vitrine com "Acesso restrito", como com `admin-orders`. O Financeiro
 * também pode ser retomado e não recebe id. As demais telas do painel
 * continuam fora da lista fechada.
 */
const VIEWS_REDIRECIONAVEIS = new Set<string>([
  "user-profile",
  "profile",
  "account-settings",
  "address-form",
  "admin-orders",
  "admin",
  "admin-settings",
  "admin-product-form",
  "admin-financeiro",
  // Quem pediu login pelas "Perguntas ao vendedor" volta ao produto. Como o
  // "user-profile", só vale COM o id do produto no state (ver abaixo).
  "product-detail",
]);

/**
 * O painel (`admin*`, menos a entrada própria `admin-login`) foi pedido por
 * quem NÃO tem sessão? Então ela precisa de uma tela de entrada, não da
 * vitrine: sem isto o app a mandava para a home em silêncio (só um
 * `console.warn`), e quem tocava no aviso de "pedido novo" sem estar logada
 * não via login nenhum.
 *
 * Só olha para a AUSÊNCIA de sessão: com sessão (logada não-admin, ou admin
 * ainda sendo confirmado pelo servidor) devolve `false` e as guardas de admin
 * de `App.tsx` seguem exatamente como eram. Durante `authLoading` também
 * devolve `false` — a sessão em cache ainda está sendo verificada, e mandar um
 * admin legítimo ao login nesse instante seria o piscar que o `adminStatus`
 * "unknown" existe para evitar.
 */
export function painelSemContaPedeEntrada(
  view: string,
  sessao: { readonly authLoading: boolean; readonly user: unknown },
): boolean {
  return (
    view.startsWith("admin") &&
    view !== "admin-login" &&
    !sessao.authLoading &&
    !sessao.user
  );
}

function comoRegistro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null
    ? (valor as Record<string, unknown>)
    : null;
}

function idUtilizavel(registro: Record<string, unknown> | null): boolean {
  return typeof registro?.id === "string" && registro.id !== "";
}

/**
 * As únicas views de destino que recebem o `id` do state do login. Id nas
 * outras criaria `?id` fantasma em URL que nunca o teve.
 */
const DESTINOS_QUE_RECEBEM_ID = new Set<string>([
  "user-profile",
  "product-detail",
  "order-details",
]);

/**
 * O id de pedido que o aviso de "Pedido novo" carrega em
 * `/admin-orders?id=<uuid>` (`supabase/functions/notify-new-order`). O pedido é
 * uma linha com `id uuid`: só esse formato (36 caracteres, hex e hífens nos
 * lugares certos) atravessa o login. O resto — `javascript:`, `//host`, `../`,
 * texto longo, uuid com sobra ou quebra de linha — vira `undefined` e a lojista
 * cai na lista de pedidos, como antes. É a ÚNICA porta de validação: a leitura
 * da URL (`syncWithUrl`) e a saída do login (`idDoDestinoPosLogin`) usam esta
 * função, e o `history.state` é gravável pela própria página.
 *
 * Maiúsculas passam (o banco aceita o uuid do link em maiúsculas); a âncora
 * `$` do JS só casa no fim da entrada, então `uuid\n` NÃO passa.
 */
const UUID_DE_REGISTRO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idDePedidoDoPainel(valor: unknown): string | undefined {
  return typeof valor === "string" && UUID_DE_REGISTRO.test(valor)
    ? valor
    : undefined;
}

/**
 * O id do produto em edição (`/admin-product-form?id=<uuid>`) que atravessa o
 * login. `produtos.id` também é `uuid`, então vale o MESMO formato do pedido —
 * e a mesma regra: o resto vira `undefined` e a tela abre sem `?id`. Mesmas
 * duas portas de entrada que o pedido (`syncWithUrl` e `idDoDestinoPosLogin`).
 */
export function idDeProdutoDoPainel(valor: unknown): string | undefined {
  return typeof valor === "string" && UUID_DE_REGISTRO.test(valor)
    ? valor
    : undefined;
}

/**
 * Endereços da conta têm UUID. A lista da conta compara o id como texto,
 * então links com maiúsculas também precisam voltar no formato do banco.
 */
export function idDeEndereco(valor: unknown): string | undefined {
  return typeof valor === "string" && UUID_DE_REGISTRO.test(valor)
    ? valor.toLowerCase()
    : undefined;
}

/**
 * O `id` que `handleAuthSuccess` (App.tsx) repassa a `handleNavigate` junto do
 * destino. Lê o state do login (precisa ser chamado ANTES de navegar, que o
 * sobrescreve). `undefined` para toda view fora de `DESTINOS_QUE_RECEBEM_ID`,
 * `admin-orders`, `admin-product-form` e `address-form`, e para id ausente,
 * vazio ou que não é string.
 *
 * `admin-orders` (17/11/2026) é a exceção que valida: o aviso de "Pedido novo"
 * abre a ficha pelo id, e a lojista que entra depois de a sessão vencer tem de
 * chegar nela, não na lista. Aqui o id só passa se for um uuid de pedido
 * (`idDePedidoDoPainel`). `admin-product-form` (18/11/2026) idem, com
 * `idDeProdutoDoPainel`: a lojista volta ao produto que editava. Nenhuma outra
 * tela do painel recebe id.
 */
export function idDoDestinoPosLogin(
  destino: View,
  state: unknown,
): string | undefined {
  const registro = comoRegistro(state);
  if (destino === "address-form") {
    return registro?.requested === "address-form"
      ? idDeEndereco(registro.id)
      : undefined;
  }
  if (destino === "admin-orders") {
    return idDePedidoDoPainel(registro?.id);
  }
  if (destino === "admin-product-form") {
    return idDeProdutoDoPainel(registro?.id);
  }
  if (!DESTINOS_QUE_RECEBEM_ID.has(destino) || !idUtilizavel(registro)) {
    return undefined;
  }
  return registro?.id as string;
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
 *      view que a pessoa pediu e foi barrada por falta de conta. Para
 *      "user-profile" o pedido só vale com um `id` utilizável no state
 *      (string não vazia): a view só desenha com `userId`, e honrar sem id
 *      mandaria a um skeleton eterno. Sem id, cai nas regras seguintes.
 *   2. `from` igual a "checkout", "cart", "orders" ou "notifications" — de
 *      onde ela veio ("orders" e "notifications" entraram em 03/11/2026:
 *      quem tocava em "Entrar" na aba Pedidos ou nos Avisos voltava ao
 *      Perfil; as duas telas não têm id nem formulário). `from` igual a
 *      "order-details" (05/11/2026) vale SÓ com `id` utilizável no state
 *      (string não vazia, o que a tela passa em `onNavigate("auth", id)`);
 *      sem id cai no perfil, como antes. Aqui NÃO se olha `requested`: o App
 *      não redireciona essa tela ao login, então ele nunca é gravado.
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
    // Um id inválido não transforma uma edição em cadastro. Sem id, a
    // navegação interna que pediu explicitamente um endereço novo continua.
    if (
      requested === "address-form" &&
      registro?.id !== undefined &&
      idDeEndereco(registro.id) === undefined
    ) {
      return "profile";
    }
    // `user-profile` sem id utilizável é tela morta: a view só desenha com
    // `userId`, e honrar o pedido sem id trocaria o login por um skeleton
    // eterno (o "product-detail" idem: produto sem id). Sem id, ignora o `requested` e segue para as regras
    // seguintes — o pior caso volta a ser o comportamento de antes.
    if (
      (requested !== "user-profile" && requested !== "product-detail") ||
      idUtilizavel(registro)
    ) {
      return requested as View;
    }
  }

  const from = registro?.from;
  // "order-details" (05/11/2026): a tela do pedido NÃO é redirecionada ao login
  // pelo App (o convidado que rastreou por código a usa), então o `requested`
  // nunca é gravado nesse fluxo — só o `from` e o `id` que a tela passa ao
  // tocar em "Entrar". Com id volta ao pedido; sem id não há o que desenhar.
  // Quem manda no que a tela mostra é a própria tela (e o banco): o id só
  // escolhe QUAL pedido da conta logada abrir.
  if (from === "order-details" && idUtilizavel(registro)) {
    return "order-details";
  }
  if (
    from === "checkout" ||
    from === "cart" ||
    from === "orders" ||
    from === "notifications"
  ) {
    return from as View;
  }

  return "profile";
}
