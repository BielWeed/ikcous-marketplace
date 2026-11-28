// Lista branca de PREFIXOS de `localStorage` que sobrevivem a uma purga
// completa do aparelho. Duas rotinas diferentes fazem essa purga do mesmo
// jeito — `Object.keys(localStorage)` + `startsWith` — e as duas existiam
// com listas SEPARADAS até 26/08/2026:
//
//  - `useUpdateCheck.ts` (Nuclear Purge): dispara SOZINHA no boot quando o
//    app está abaixo de `minAppVersion` (`checkMandatoryUpdate`), sem
//    ninguém tocar em nada.
//  - `GlobalErrorBoundary.tsx` (recovery): dispara quando a pessoa clica no
//    único botão da tela de "Algo deu errado".
//
// Achado da revisão de contexto limpo (26/08/2026): a lista do
// GlobalErrorBoundary já cobria escrita PENDENTE ainda não confirmada no
// servidor — `orders_offline_updates_queue` (useOrders.ts),
// `products_offline_updates_queue` (useProducts.ts) e
// `admin_banner_form_draft` — mas a Nuclear Purge continuava com a lista
// antiga e apagava as duas filas do mesmo jeito. Como ela dispara sozinha,
// isso é pior que o botão: lojista sem rede marca pedido como enviado ou
// edita preço/estoque, sobe uma versão nova, e a fila de escrita some no
// primeiro boot sem ninguém decidir nada. Uma lista, um lugar, os dois
// consumindo — divergir de novo exige editar os DOIS lugares para o mesmo
// prefixo, e isso é o que este arquivo existe para impedir.
export const LOCALSTORAGE_PURGE_WHITELIST: readonly string[] = [
  "sb-",
  "supabase.auth",
  "pwa_",
  "marketplace_",
  "ikcous_",
  "cart_",
  "favorites_",
  "notificacoes-",
  "orders_offline_updates_queue",
  "products_offline_updates_queue",
  "admin_banner_form_draft",
  // C3.1 (PDV de balcão): mesmo motivo do rascunho de banner — é cupom em
  // curso, escrita PENDENTE que o servidor ainda não confirmou. Sem isto,
  // a Nuclear Purge (useUpdateCheck.ts:196) apaga uma venda montada sozinha
  // no boot, sem ninguém decidir nada.
  "admin_pdv_venda_draft",
  // Chave da compra (src/lib/chave-do-pedido.ts, validade de 30 min): é ela
  // que faz a retentativa de um Finalizar com a resposta perdida devolver o
  // MESMO pedido. O prefixo real usa HIFEN, entao o "ikcous_" acima nao a
  // cobre; sem esta linha a purga a apagava e o proximo Finalizar criava o
  // segundo pedido. Literal de proposito (este arquivo e so string in,
  // boolean out); o teste amarra o literal ao prefixo exportado pelo modulo.
  "ikcous-chave-do-pedido:",
  // Chave da devolucao do painel (src/lib/chave-da-devolucao.ts, validade de
  // 30 min): mesmo papel da chave da compra, do lado do ESTORNO. E ela que faz
  // o "Devolver" repetido depois de um "nao da para saber" devolver a MESMA
  // linha em vez de criar outra. Prefixo com HIFEN, fora do "ikcous_" acima;
  // sem esta linha a purga de versao e o botao "Recarregar o app" a apagavam,
  // o toque seguinte levava chave nova e o servidor criava o SEGUNDO estorno
  // (o cliente recebia em dobro). Cobre tambem o formato antigo, so lido
  // ("<prefixo><pedido>", sem os centavos). Registro adulterado nao trava
  // nada: a leitura descarta o malformado e gera chave nova.
  "ikcous-chave-da-devolucao:",
  // CPF digitado no cadastro, esperando a confirmação do e-mail
  // (src/lib/cpf-pendente-do-cadastro.ts, validade de 24 h). A chave usa
  // DOIS-PONTOS ("ikcous:cpf-..."), entao o "ikcous_" acima nao a cobre; sem
  // esta linha a purga de versao e o botao "Recarregar o app" a apagavam e a
  // pessoa tinha de redigitar o CPF depois de confirmar o e-mail. Literal
  // EXATO de proposito (outras chaves "ikcous:" nao ficam); o teste amarra o
  // literal a CHAVE_CPF_PENDENTE do modulo.
  "ikcous:cpf-pendente-cadastro",
];

// Lista branca do `sessionStorage` para a purga do botão "Recarregar o app"
// (GlobalErrorBoundary.handleReset). Antes dela o botão fazia
// `sessionStorage.clear()` e apagava o que a pessoa ainda estava fazendo:
//
//  - o PIX pendente (src/lib/pedido-pendente-do-checkout.ts): só o ID do
//    pedido, validado como uuid na leitura; o resto volta do servidor. Chave
//    por conta: "ikcous:checkout-pedido-pendente:<id da conta>".
//  - o rascunho do checkout (src/lib/rascunho-do-checkout.ts): formulário e
//    cupom digitados. Sem CPF (o módulo proíbe) e saneado na leitura.
//  - o pedido de visitante com resposta perdida (src/lib/pedido-sem-resposta.ts):
//    é a "mesma compra" congelada, que o checkout reabre para reenviar. Sem ele
//    o checkout remonta o pedido do carrinho (que pode ter mudado de preço ou
//    estoque) e a pessoa cria um segundo pedido sem perceber. Sem CPF (removido
//    na gravação) e vale no máximo 30 min (vencido, a leitura o descarta).
//  - as tentativas de lançamento do financeiro ainda sem resposta
//    (src/components/admin/financeiro/tentativasEmAberto.ts): a chave que faz
//    salvar de novo o MESMO lançamento não gravá-lo duas vezes. Guarda só um
//    resumo (hash) do conteúdo, a conta e a chave; vence em 10 min.
//  - o rascunho do pedido de devolução da cliente
//    (src/lib/rascunho-da-devolucao.ts): passo, itens, motivo, texto e QUANTAS
//    fotos havia — nunca a foto em si (o módulo não a grava), então cabe na
//    cota. Chave por conta e pedido: "ikcous:rascunho-da-devolucao:<conta>:<pedido>".
//
// SÓ estas cinco. Nada de sessão/token do Supabase (mora no localStorage, sob
// `sb-`, e a purga do localStorage já cuida dele). Os literais espelham os dos
// módulos (nem todos exportam as constantes); o teste amarra cada um gravando
// pelo módulo de verdade. As duas últimas também não travam a recuperação: a
// leitura delas descarta o registro malformado.
export const SESSIONSTORAGE_PURGE_WHITELIST: readonly string[] = [
  "ikcous:checkout-pedido-pendente:",
  "ikcous-rascunho-do-checkout-v1",
  "ikcous-pedido-sem-resposta-v1",
  "fin-lancamento-tentativas-em-aberto",
  "ikcous:rascunho-da-devolucao:",
];

// Compartilha também o CRITÉRIO, não só a lista: os dois chamadores testam
// `chave.startsWith(prefixo)` para cada prefixo da lista, e duplicar essa
// linha nos dois arquivos é exatamente o tipo de divergência silenciosa que
// causou o defeito original (a lista podia mudar num lugar e não no outro).
// Testável sem DOM, sem localStorage e sem os módulos virtuais do PWA que
// `useUpdateCheck.ts` importa — só string in, boolean out.
export function chaveSobreviveAPurga(key: string): boolean {
  return LOCALSTORAGE_PURGE_WHITELIST.some((prefix) => key.startsWith(prefix));
}

/** Mesmo critério (`startsWith`) para o `sessionStorage`. */
export function chaveDeSessaoSobreviveAPurga(key: string): boolean {
  return SESSIONSTORAGE_PURGE_WHITELIST.some((prefix) =>
    key.startsWith(prefix),
  );
}
