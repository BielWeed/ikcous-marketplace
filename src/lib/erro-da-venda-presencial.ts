// Tarefa C3.4 (plano §5.3): traduz a falha de `registrar_venda_presencial`
// para uma frase em português que o balconista consegue agir — sem código,
// sem stack e sem `DOMException` crua na tela.
//
// POR QUE UM ARQUIVO PRÓPRIO, e não `src/lib/recusaDoPedido.ts`: aquele
// arquivo casa por TEXTO porque as 11 recusas de
// `create_marketplace_order_v23/v24` usam `RAISE EXCEPTION` sem `USING
// ERRCODE` — todas chegam como `P0001` (o cabeçalho dele, :1-16, é explícito
// sobre isso). `registrar_venda_presencial` é o oposto: TODA recusa levanta
// com `ERRCODE` explícito (migration 20261162000000, contexto da tarefa,
// fato 3). Casar por CÓDIGO é mais forte (o texto de uma frase pode mudar
// numa revisão futura da migration sem que o código mude) e mais barato do
// que decorar 12 frases — e misturar as duas réguas num arquivo só
// reabriria a confusão que o cabeçalho de `recusaDoPedido.ts` descreve.
//
// As mensagens de "22023" e "42501" abaixo são LITERAIS as que o banco já
// escreve (mesmas linhas citadas no comentário de cada `if`) — reescrevê-las
// aqui criaria DUAS verdades sobre a mesma recusa (risco medido na tarefa).

/** O que a tela precisa para decidir o que mostrar e se vale oferecer um
 * botão de "tentar de novo" — nunca a mensagem crua do erro. */
export interface FalhaDaVendaTraduzida {
  readonly mensagem: string;
  readonly podeTentarDeNovo: boolean;
  /** `true` só em 42501 (sem permissão/sessão): a saída não é "tentar de
   * novo" nem "começar venda nova" — é a CONTA que precisa ser renovada.
   * Achado "ANTES DE CRESCER" da revisão: sem este sinal, a tela convidava a
   * martelar um botão que nunca resolveria sozinho (`podeTentarDeNovo:
   * false` não diz POR QUE). */
  readonly precisaEntrarDeNovo: boolean;
}

/** Mensagem honesta de D3: sem rede (ou sem forma de saber o motivo), a
 * venda é RECUSADA e o cupom fica salvo — nunca "tente de novo" escondendo
 * um erro que não vai se resolver sozinho, e nunca "deu erro" seco. */
const FALHA_DE_REDE: FalhaDaVendaTraduzida = {
  mensagem:
    "Não consegui falar com o servidor. O cupom está salvo aqui; tente de novo quando a conexão voltar.",
  podeTentarDeNovo: true,
  precisaEntrarDeNovo: false,
};

/** O supabase-js devolve `{code, message}` tanto para `PostgrestError`
 * quanto para o erro sintético de função fora do cache de schema
 * (`PGRST202`) — nenhum dos dois tem um tipo público exportado, então lemos
 * pela FORMA, com guardas, em vez de importar um tipo interno da lib. */
function codigoDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("code" in erro)) {
    return null;
  }
  const codigo = (erro as { code: unknown }).code;
  return typeof codigo === "string" ? codigo : null;
}

function mensagemDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("message" in erro)) {
    return null;
  }
  const mensagem = (erro as { message: unknown }).message;
  return typeof mensagem === "string" && mensagem.trim() !== ""
    ? mensagem
    : null;
}

/**
 * Traduz a falha de `registrar_venda_presencial` (ou de qualquer coisa que
 * impeça a chamada de chegar lá — rede caindo, `DOMException` de um
 * `fetch` abortado) para `{mensagem, podeTentarDeNovo}`.
 *
 * A REGRA, por `erro.code`:
 *  · SEM `code` (string) — inclui `TypeError`, `DOMException` e qualquer
 *    erro que não veio do Postgres/PostgREST — é a mesma frase de "sem
 *    rede" do D3: não sabemos o motivo real, e a coisa honesta é dizer que
 *    o cupom está salvo e convidar a tentar de novo. Isto também cobre o
 *    caso específico citado na tarefa, `TypeError: Failed to fetch`.
 *  · "PGRST202" — a RPC não existe neste servidor (schema cache sem a
 *    função — sintoma exato de uma migration não aplicada). Mensagem
 *    honesta em vez de "tente de novo" para sempre, porque tentar de novo
 *    nunca vai funcionar sozinho.
 *  · "42501" — Acesso negado/não autenticado (migration :220 e :227). A
 *    frase do banco JÁ é a certa; só repassamos.
 *  · "23505" — a `p_idempotency_key` já foi usada por OUTRO pedido
 *    (migration :250/:410) — não é o caso de "duplo toque" (que devolve
 *    `ja_existia:true` sem erro nenhum), é uma corrida perdida de verdade.
 *    Recuperar daqui é "começar uma venda nova" (gira a chave), não
 *    "tentar de novo" com a mesma chave.
 *  · "22023" — as 12 recusas de validação da migration (:264 a :460), todas
 *    com frase própria em português. `podeTentarDeNovo` só é `true` quando a
 *    frase é de ESTOQUE ("Estoque insuficiente…", migration :348 e :441/:460)
 *    — nesses casos o balconista pode ajustar a quantidade e reenviar; nas
 *    outras (forma de pagamento, motivo do desconto, cliente não encontrado…)
 *    tentar de novo sem mudar nada só repetiria a mesma recusa.
 *  · Qualquer outro `code` — desconhecido, mas ainda assim veio do
 *    servidor: se ele escreveu uma frase, ela pelo menos foi pensada para
 *    gente ler; sem frase, cai na mensagem de rede.
 */
export function mensagemDaFalhaDaVenda(erro: unknown): FalhaDaVendaTraduzida {
  const codigo = codigoDoErro(erro);
  const mensagemDoBanco = mensagemDoErro(erro);

  if (codigo === null) return FALHA_DE_REDE;

  if (codigo === "PGRST202") {
    return {
      mensagem:
        "O balcão ainda não está liberado neste servidor. Avise quem cuida do app.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    };
  }

  if (codigo === "42501") {
    // migration :220 ('Acesso negado…') e :227 ('Não autorizado…').
    return {
      mensagem:
        mensagemDoBanco ?? "Acesso negado: só a loja registra venda no balcão.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: true,
    };
  }

  if (codigo === "23505") {
    // migration :250 e :410 — chave de idempotência já usada por OUTRO pedido.
    return {
      mensagem: "Esta chave de venda já foi usada por outro pedido.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    };
  }

  if (codigo === "22023") {
    return {
      mensagem: mensagemDoBanco ?? "Não foi possível registrar a venda.",
      podeTentarDeNovo:
        mensagemDoBanco?.includes("Estoque insuficiente") ?? false,
      precisaEntrarDeNovo: false,
    };
  }

  // Código desconhecido: nunca mostramos o código cru. Se o banco escreveu
  // uma frase, ela é honesta o bastante para aparecer; sem frase, a mensagem
  // de rede é o fallback mais seguro (não afirma nada que não sabemos).
  return mensagemDoBanco
    ? {
        mensagem: mensagemDoBanco,
        podeTentarDeNovo: false,
        precisaEntrarDeNovo: false,
      }
    : FALHA_DE_REDE;
}
