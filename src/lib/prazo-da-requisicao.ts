/** Limita apenas a espera da tela; a requisição pode concluir no servidor depois. */
export async function aguardarComPrazo<T>(
  requisicao: Promise<T>,
  prazoMs: number,
  erroAoEsgotar: () => Error,
): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      requisicao,
      new Promise<never>((_, reject) => {
        temporizador = setTimeout(() => reject(erroAoEsgotar()), prazoMs);
      }),
    ]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}

// PRAZOS DAS CONSULTAS DO CHECKOUT (14/10/2026). Rede "pendurada" conecta e
// não responde: sem prazo a tela girava para sempre, sem erro e sem botão.
// Vizinhos já existentes: busca de CEP 8 s, PIX 20 s, pedido 30 s, revisão do
// frete no envio 12 s.
//
// - 12 s: consulta barata (revisão da configuração do frete, validar e listar
//   cupons) — o mesmo prazo da revisão que o checkout já faz no envio.
// - 15 s: cotação do frete. A edge dá até 10 s a CADA transportadora
//   (`TEMPO_LIMITE_DO_PROVEDOR_MS`, em paralelo); 12 s cortaria uma cotação
//   que só está lenta e que o servidor ainda ia entregar.
export const PRAZO_DA_CONSULTA_DO_CHECKOUT_MS = 12_000;
export const PRAZO_DA_COTACAO_DO_FRETE_MS = 15_000;

// PRAZO DAS AÇÕES DO LOJISTA QUE GRAVAM NO PEDIDO (07/11/2026): marcar
// pagamento recebido (e desfazer), "O produto voltou", código de rastreio,
// anotação interna e "Já estornei". Uma gravação de uma RPC/linha, sem
// terceiros: 20 s. Só encerra a ESPERA DA TELA — o servidor pode ter gravado —,
// por isso a frase NÃO diz que falhou: diz que não houve resposta e manda
// conferir o pedido antes de tentar de novo (repetir o toque é seguro: as RPCs
// de dinheiro são idempotentes no banco).
export const PRAZO_DAS_ACOES_DO_PEDIDO_MS = 20_000;
export const MENSAGEM_ACAO_DO_PEDIDO_SEM_RESPOSTA =
  "Sem resposta da rede. Confira o pedido antes de tentar de novo.";

// PRAZOS DE ABRIR E SALVAR UM PRODUTO NO PAINEL (08/11/2026). Rede "pendurada"
// conecta e não responde: o botão ficava em "Salvando…" para sempre e o produto
// abria num esqueleto cinza sem saída. Como nas ações do pedido, o prazo só
// encerra a ESPERA DA TELA: o servidor pode ter gravado.
//
// - 20 s: a gravação principal (um INSERT/UPDATE ou a RPC da grade). Sem
//   resposta, a frase NÃO diz que falhou nem que deu certo: manda conferir a
//   lista antes de repetir (produto novo repetido = produto duplicado na loja).
// - 15 s: abrir um produto (duas consultas em sequência, sob UM prazo só).
// - 10 s: conferir SKU de variação antes de gravar. Sem veredito o cadastro
//   segue (já era assim: a colisão real vira o 23505 traduzido).
// - 5 s: o que sobra DEPOIS de a gravação ter dado certo (reler o catálogo,
//   copiar a foto removida para o backup). Não pode segurar o botão: passou
//   disso, a tela diz "Salvo" e o resto termina em segundo plano.
export const PRAZO_DE_GRAVAR_O_PRODUTO_MS = 20_000;
export const PRAZO_DE_LER_O_PRODUTO_MS = 15_000;
export const PRAZO_DE_CONFERIR_O_SKU_MS = 10_000;
export const PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS = 5_000;
export const MENSAGEM_PRODUTO_NOVO_SEM_RESPOSTA =
  "Sem resposta da rede. Não dá para saber se o produto foi salvo. Confira a lista de Produtos antes de publicar de novo, para não criar o produto duas vezes.";
// A grade sem resposta DEPOIS de o produto já ter voltado criado: o produto
// existe (isso se sabe), o que não se sabe é se as variações entraram.
export const MENSAGEM_PRODUTO_NOVO_GRADE_SEM_RESPOSTA =
  "O produto foi criado, mas a rede não respondeu ao salvar as variações e não dá para saber se elas entraram. Abra a lista de Produtos e confira o produto antes de publicar de novo, para não criar outro.";
export const MENSAGEM_PRODUTO_EDICAO_SEM_RESPOSTA =
  "Sem resposta da rede. Não dá para saber se as alterações foram salvas. Confira o produto na lista de Produtos antes de salvar de novo.";
export const MENSAGEM_PRODUTO_LEITURA_SEM_RESPOSTA =
  "A conexão está lenta e o produto não carregou. Confira a conexão e tente de novo.";

// PRAZO DAS CONSULTAS DO PAINEL (Início e CRM): rede que conecta e não responde
// deixava o "carregando" ligado para sempre, o botão Sincronizar preso e a volta
// ao app sem reler. 20 s, o mesmo do Início (`usePainelInicio`). Estourou = falha
// com "Tentar de novo"; só encerra a ESPERA da tela, a consulta não grava nada.
export const PRAZO_DA_CONSULTA_DO_PAINEL_MS = 20_000;

/** Frase para quem está na tela: o que aconteceu e o que fazer. */
export const MENSAGEM_CONEXAO_LENTA =
  "A conexão está lenta. Toque em Tentar de novo.";

/** Mesmo molde do `PEDIDO_SEM_RESPOSTA`: erro com `code`, texto em português. */
export const CODIGO_CONSULTA_SEM_RESPOSTA = "CONSULTA_SEM_RESPOSTA";

export function erroDeConsultaSemResposta(
  mensagem: string = MENSAGEM_CONEXAO_LENTA,
): Error {
  return Object.assign(new Error(mensagem), {
    code: CODIGO_CONSULTA_SEM_RESPOSTA,
  });
}

export function ehConsultaSemResposta(erro: unknown): boolean {
  return (
    typeof erro === "object" &&
    erro !== null &&
    (erro as { code?: unknown }).code === CODIGO_CONSULTA_SEM_RESPOSTA
  );
}
