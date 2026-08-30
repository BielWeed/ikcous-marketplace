/**
 * Classifica a recusa que o banco deu no último clique do checkout, para a
 * tela poder oferecer A AÇÃO que a mensagem manda executar.
 *
 * POR QUE POR TEXTO, e não por código de erro: as 11 recusas de
 * `create_marketplace_order_v23/v24` usam `RAISE EXCEPTION` sem `USING
 * ERRCODE`, então todas chegam como `P0001`. Dar código próprio a cada uma
 * mexeria na RPC — no caminho do dinheiro — e `mensagemAmigavelErroPedido`
 * trata `P0001` de forma especial, então mudar isso quebraria peça que hoje
 * funciona.
 *
 * A fragilidade de casar por texto está contida pelo teste
 * `recusa-do-pedido-ancora-nas-migrations.test.ts`: se alguém trocar uma
 * mensagem no SQL, ele reprova NOMEANDO qual, em vez de esta função cair
 * calada no caso genérico.
 *
 * A REGRA REAL, corrigida em 28/08/2026 depois de a revisão medir que a
 * versão anterior deste parágrafo prometia mais do que o código cumpre: NÃO
 * é "nada vira `tentar_de_novo`, exceto um caso" — é "TEXTO QUE VEIO DO
 * BANCO (P0001 COM `message`) nunca vira `tentar_de_novo`". Mandar "tente de
 * novo" sobre um pedido que a própria RPC recusou por nome é o que duplica
 * pedido — estoque debitado duas vezes, cupom de uso único consumido duas
 * vezes. Fora dessa frase escrita pelo banco, virar `tentar_de_novo` é o
 * comportamento certo, não uma falha da regra.
 *
 * 🔴 SÃO DUAS EXCEÇÕES à regra acima, não uma — e a segunda cobre mais casos
 * do que a primeira, mas nunca tinha sido escrita aqui:
 *
 * 1. OS TRÊS CÓDIGOS DO POSTGREST que PROVAM que a chamada nem chegou ao
 *    Postgres, porque falham na fase de autenticação/roteamento (doc
 *    oficial, citada em `useOrders.ts`): `PGRST202` (função fora do cache de
 *    schema), `PGRST301` (JWT inválido ou expirado) e `PGRST302` (papel
 *    anônimo desabilitado). Mandar "conferir se o pedido apareceu" mandaria
 *    a pessoa procurar um pedido que provadamente não existe — e, no caso do
 *    JWT expirado, para uma tela que nem vai carregar.
 *
 * 2. `FORMATO_SQLSTATE`: QUALQUER `code` de 5 caracteres `[0-9A-Z]` também
 *    devolve `tentar_de_novo` — inclusive `P0001` SEM texto (`message`
 *    ausente ou vazia), porque `"P0001"` bate o mesmo formato. Medido pela
 *    revisão: `{code:"P0001"}` sem `message`, `{code:"12345"}` e
 *    `{code:"ABCDE"}` devolvem todos `tentar_de_novo`. Isto está certo — o
 *    formato prova que o erro veio de dentro do Postgres, e sem texto não há
 *    frase do banco para preservar —, mas não estava escrito: a versão
 *    anterior deste comentário chamava só o item 1 de "A EXCEÇÃO", no
 *    singular, como se fosse a única.
 *
 * 🔴 E ESTA LISTA TEM DE CONCORDAR COM `mensagemAmigavelErroPedido`
 * (`src/hooks/useOrders.ts`), porque as duas aparecem para a MESMA pessoa, na
 * MESMA tela, no MESMO instante — o painel ao lado do toast. O comentário de
 * `CheckoutView.tsx` escreve a invariante em letra: "mesma tradução aqui, para
 * não haver dois textos diferentes para a mesma falha". A primeira versão deste
 * módulo quebrou isso: ela não tinha os três códigos e mandava a pessoa
 * "conferir antes" enquanto o toast, do lado, dizia "tente novamente". Achado
 * pela revisão de contexto limpo em 28/08/2026.
 *
 * A Task 6 fecha a duplicação: `useOrders.ts` passa a IMPORTAR este conjunto em
 * vez de manter a cópia dele. Enquanto as duas cópias existirem, mexer numa sem
 * mexer na outra reabre exatamente este defeito.
 */
export type AcaoDeRecusa =
  | "reconferir_carrinho"
  | "recotar_frete"
  | "ajustar_estoque"
  | "remover_item"
  | "escolher_variacao"
  | "trocar_endereco"
  | "trocar_entrega"
  | "remover_cupom"
  | "tentar_de_novo"
  | "conferir_antes";

export interface RecusaDoPedido {
  acao: AcaoDeRecusa;
  /** A frase que a pessoa lê. Vem do banco quando o banco escreveu uma. */
  mensagem: string;
  /** Nome do produto, quando a mensagem o nomeia. */
  produto?: string;
  /** Quantidade ainda disponível, quando a mensagem a informa. */
  disponivel?: number;
}

const FORMATO_SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Os três que provam que a chamada nem chegou ao Postgres. Tem de ser o MESMO
 * conjunto de `mensagemAmigavelErroPedido` — ver o cabeçalho deste arquivo.
 */
const CODIGOS_POSTGREST_REVERTIDO_COMPROVADO = new Set([
  "PGRST202",
  "PGRST301",
  "PGRST302",
]);

/**
 * Ordem IMPORTA: o padrão de estoque COM número precisa ser testado antes do
 * padrão sem número, senão o sem-número casa primeiro e a quantidade se perde.
 *
 * 🔴 `[\s\S]` e não `.` no nome do produto: `.` NÃO casa quebra de linha, e o
 * nome é digitado pelo lojista. Medido pela revisão de 28/08/2026 — um produto
 * chamado "Caneca\nAzul" caía no caso genérico e a pessoa PERDIA o botão. E `*`
 * em vez de `+` porque nome vazio também é possível: com `+`, um produto sem
 * nome tirava a ação junto.
 */
const REGRAS: ReadonlyArray<{ padrao: RegExp; acao: AcaoDeRecusa }> = [
  {
    padrao:
      /^Estoque insuficiente para o produto ([\s\S]*) \(Disponível: (\d+), Solicitado: \d+\)$/,
    acao: "ajustar_estoque",
  },
  {
    padrao: /^Estoque insuficiente para o produto ([\s\S]*)$/,
    acao: "ajustar_estoque",
  },
  { padrao: /^Produto ([\s\S]*) não disponível\.$/, acao: "remover_item" },
  {
    padrao: /^Escolha uma variação para o produto ([\s\S]*)\.$/,
    acao: "escolher_variacao",
  },
  // Item 16 do laudo de 29/08: a recusa final do cupom diz o MOTIVO real
  // (migration 20261025000000 — RAISE específico por causa nas v23 e v24).
  // Todas levam à mesma ação: remover o cupom. `[\s\S]` e não `.` pelo
  // mesmo motivo das regras de produto: o código é digitado pelo lojista.
  // A frase antiga fica por último para a corrida residual (cupom mudou
  // entre as duas consultas no banco) e para banco ainda sem a migration.
  {
    padrao: /^O cupom ([\s\S]+) não existe\. Confira o código\.$/,
    acao: "remover_cupom",
  },
  {
    padrao: /^O cupom ([\s\S]+) está desativado pela loja\.$/,
    acao: "remover_cupom",
  },
  {
    padrao: /^O cupom ([\s\S]+) expirou em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\.$/,
    acao: "remover_cupom",
  },
  {
    padrao: /^O cupom ([\s\S]+) já atingiu o limite de usos\.$/,
    acao: "remover_cupom",
  },
  {
    padrao: /^O cupom ([\s\S]+) exige uma compra mínima de R\$ \d+,\d{2}\.$/,
    acao: "remover_cupom",
  },
  { padrao: /^Cupom .+ inválido ou expirado\.$/, acao: "remover_cupom" },
  { padrao: /^A cotação de frete expirou\./, acao: "recotar_frete" },
  {
    padrao: /^Entrega local não disponível para o CEP informado\.$/,
    acao: "trocar_entrega",
  },
  {
    padrao: /^Endereço inválido ou não pertence ao usuário\.$/,
    acao: "trocar_endereco",
  },
  {
    padrao: /^Quantidade inválida para um dos itens\.$/,
    acao: "reconferir_carrinho",
  },
  { padrao: /^Os valores do pedido mudaram\./, acao: "reconferir_carrinho" },
];

export const classificarRecusaDoPedido = (error: unknown): RecusaDoPedido => {
  const detalhes = (error ?? {}) as { code?: unknown; message?: unknown };
  const codigo = typeof detalhes.code === "string" ? detalhes.code : "";
  const texto = typeof detalhes.message === "string" ? detalhes.message : "";

  if (codigo === "P0001" && texto) {
    for (const { padrao, acao } of REGRAS) {
      const casou = padrao.exec(texto);
      if (!casou) continue;
      const resultado: RecusaDoPedido = { acao, mensagem: texto };
      if (casou[1] !== undefined) resultado.produto = casou[1];
      if (casou[2] !== undefined) resultado.disponivel = Number(casou[2]);
      return resultado;
    }
    // P0001 que ninguém previu: o texto do banco é bom, a ação é que não se sabe.
    return { acao: "conferir_antes", mensagem: texto };
  }

  if (
    CODIGOS_POSTGREST_REVERTIDO_COMPROVADO.has(codigo) ||
    FORMATO_SQLSTATE.test(codigo)
  ) {
    return {
      acao: "tentar_de_novo",
      mensagem:
        "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    };
  }

  return {
    acao: "conferir_antes",
    mensagem:
      "Não conseguimos confirmar se o pedido foi enviado. Verifique se ele já apareceu antes de tentar de novo.",
  };
};
