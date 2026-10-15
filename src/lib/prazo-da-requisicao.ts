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
