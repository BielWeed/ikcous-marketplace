/**
 * Texto do histórico de cotações de frete para quem não é programadora.
 *
 * A edge `calculate-shipping` grava em `shipping_calculation_logs` o motivo de
 * cada falha. Quase sempre é frase da loja ("Sem credencial cadastrada…"),
 * mas no ramo de falha de API o motivo é o corpo BRUTO que a transportadora
 * devolveu: "Melhor Envio API retornou 422: {…}", JSON ou até uma página HTML
 * de gateway. Isso a lojista não lê. Aqui o corpo bruto vira uma frase; a
 * tela guarda o texto inteiro no `title`, então nada se perde.
 *
 * Por que não `mensagemDeErroDoPainel`: ela trocaria por frase genérica
 * também o motivo acionável que a edge escreve em português ("Conecte a
 * transportadora…"). Aqui só o que é corpo de API é traduzido; frase em
 * português passa igual.
 *
 * Funções puras: sem hook, sem Supabase e sem importar componente.
 */

const NAO_RESPONDEU_DIREITO = "A transportadora não respondeu direito";
const TENTE_DE_NOVO = "Tente de novo mais tarde.";

/** Nome legível de um id de transportadora, ou `null` se não for conhecido. */
export type NomeDoProvedor = (id: string) => string | null | undefined;

// "<id>: " no começo de uma parte — a edge usa `${provedor}: ${texto}` quando
// há mais de uma transportadora ligada.
const PREFIXO_DE_PROVEDOR = /^([a-z][a-z_]*): ([\s\S]*)$/;
// "<Nome> API retornou <status>: <corpo>" (provedores.ts).
const API_RETORNOU = /\bAPI retornou (\d{3})\b/;
// Corpo que é JSON ou HTML, não frase.
const CORPO_CRU = /^\s*(?:[{[<])|<\s*\/?\s*(?:html|body|!doctype)\b/i;

// Mesmas três classes que a edge separa em `provedores.ts` (linhas 277-279):
// 401/403 = chave recusada; 422 com `cep_destino` = CEP inválido; o resto =
// transportadora indisponível. Cada uma pede uma ação diferente da lojista,
// então não pode virar a mesma frase.
const FRASE_CHAVE_RECUSADA =
  "A transportadora recusou a chave de acesso. Confira a chave em Transportadoras e toque em Testar.";
const FRASE_CEP_RECUSADO = "A transportadora não aceitou o CEP do cliente.";

function frase(status: string | null): string {
  return status === null
    ? `${NAO_RESPONDEU_DIREITO}. ${TENTE_DE_NOVO}`
    : `${NAO_RESPONDEU_DIREITO} (erro ${status}). ${TENTE_DE_NOVO}`;
}

function traduzirCorpo(texto: string): string {
  const retornou = API_RETORNOU.exec(texto);
  if (retornou) {
    const status = retornou[1] ?? null;
    if (status === "401" || status === "403") return FRASE_CHAVE_RECUSADA;
    if (status === "422" && texto.includes("cep_destino")) {
      return FRASE_CEP_RECUSADO;
    }
    return frase(status);
  }
  if (CORPO_CRU.test(texto)) return frase(null);
  return texto;
}

/**
 * Separa a mensagem das várias transportadoras (a edge junta com " | ").
 * Um pedaço que não começa com "<id>: " continua o anterior: um corpo de API
 * pode conter " | " sem ser outra transportadora.
 */
function partesDaMensagem(texto: string): string[] {
  const partes: string[] = [];
  for (const pedaco of texto.split(" | ")) {
    if (partes.length === 0 || PREFIXO_DE_PROVEDOR.test(pedaco)) {
      partes.push(pedaco);
    } else {
      partes[partes.length - 1] = `${partes[partes.length - 1]} | ${pedaco}`;
    }
  }
  return partes;
}

/**
 * O motivo como a lojista lê. Frase em português passa igual; corpo bruto de
 * API (ou JSON/HTML) vira "A transportadora não respondeu direito (erro N).
 * Tente de novo mais tarde.". `nomeDe` troca o id do provedor que a edge põe
 * na frente quando há mais de um ligado ("melhor_envio: …" → "Melhor Envio: …").
 */
export function motivoDaCotacao(
  texto: string | null | undefined,
  nomeDe?: NomeDoProvedor,
): string {
  if (!texto) return "";
  return partesDaMensagem(texto)
    .map((parte) => {
      const comPrefixo = PREFIXO_DE_PROVEDOR.exec(parte);
      const nome = comPrefixo?.[1] ? nomeDe?.(comPrefixo[1]) : null;
      if (comPrefixo && nome) {
        const corpo = traduzirCorpo(comPrefixo[2] ?? "");
        // A edge às vezes já escreve o nome no corpo ("Melhor Envio: resposta
        // inesperada."): repetir o prefixo daria "Melhor Envio: Melhor Envio: …".
        return corpo.startsWith(nome) ? corpo : `${nome}: ${corpo}`;
      }
      return traduzirCorpo(parte);
    })
    .join(" | ");
}

/**
 * Coluna "Transportadora" do histórico. A edge grava o id (`melhor_envio`),
 * uma lista dos ligados ("melhor_envio, frenet") ou o id com " (Cache)" quando
 * a resposta veio da memória. Id que não é de transportadora (`local`, …) não
 * ganha nome inventado: só troca "_" por espaço.
 */
export function nomeDoProvedorNoHistorico(
  provider: string | null | undefined,
  nomeDe: NomeDoProvedor,
): string {
  if (!provider) return "";
  return provider
    .split(/,\s*/)
    .map((item) => {
      const guardada = item.endsWith(" (Cache)");
      const id = guardada ? item.slice(0, -" (Cache)".length) : item;
      const nome = nomeDe(id) ?? id.replace(/_/g, " ");
      return guardada ? `${nome} (resposta guardada)` : nome;
    })
    .join(", ");
}
