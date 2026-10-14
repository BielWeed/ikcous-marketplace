// L10 (auditoria de segurança de 12/10/2026) — as filas de escrita offline do
// painel e os rascunhos do admin viviam no `localStorage` do APARELHO numa
// chave só, e sobreviviam à saída da conta: num tablet de balcão, o admin A
// gravava uma mudança sem rede e saía, o admin B entrava, e a mudança de A
// seguia ao servidor com o login de B (e o rascunho de A, com nome e WhatsApp
// de cliente, era sobrescrito ou lido por B).
//
// Desenho (decisão da hub, depois de crítica de desenho — um carimbo `userId`
// dentro de uma chave compartilhada NÃO segura o uso normal: as alterações do
// mesmo produto se juntam, a fila final só guarda o que falhou, os avisos
// contam a fila inteira): a CHAVE é por usuário, `<chave antiga>:<uid>` — o
// mesmo padrão de `ikcous_favorites_pendentes:${userId}` e
// `notificacoes-campanha-estado:${userId}`. Cada processador só enxerga a
// lista do próprio dono; a lógica de juntar e reescrever a fila não sabe que
// existe outro usuário.
//
// A whitelist de purga (`localStoragePurgeWhitelist.ts`) compara por PREFIXO,
// então `orders_offline_updates_queue:<uid>` sobrevive à purga sem editar a
// lista (há teste).

/** Chave ANTIGA (sem dono) da fila offline de pedidos. */
export const CHAVE_BASE_DA_FILA_DE_PEDIDOS = "orders_offline_updates_queue";
/** Chave ANTIGA (sem dono) da fila offline de produtos. */
export const CHAVE_BASE_DA_FILA_DE_PRODUTOS = "products_offline_updates_queue";

/**
 * Validade de um item da fila offline: 72 h. Um item mais velho NÃO é
 * enviado — é descartado com aviso. Produto grava valor ABSOLUTO (`estoque`,
 * `preco_venda`): enviar o estoque de 30 dias atrás por cima do estoque de
 * hoje corrompe o estoque. Ajustável: é a única constante do prazo.
 */
export const PRAZO_DA_FILA_OFFLINE_MS = 72 * 60 * 60 * 1000;

/** `<base>:<uid>` — a chave do dono. `userId` vazio nunca chega aqui. */
export function chaveDoUsuario(base: string, userId: string): string {
  return `${base}:${userId}`;
}

export interface ItemDatado {
  timestamp?: unknown;
}

/**
 * Separa o que ainda vale do que passou do prazo. `semTimestamp` decide o
 * item sem data numérica: "valido" para pedidos (itens antigos nunca a
 * tiveram, e o envio de status é relido contra o servidor), "vencido" para
 * produtos (valor absoluto cuja idade não se prova não se envia).
 */
export function separarItensVencidos<T>(
  fila: readonly T[],
  agora: number,
  semTimestamp: "valido" | "vencido",
): { validos: T[]; vencidos: T[] } {
  const validos: T[] = [];
  const vencidos: T[] = [];
  for (const item of fila) {
    const timestamp =
      typeof item === "object" && item !== null
        ? (item as ItemDatado).timestamp
        : undefined;
    const vencido =
      typeof timestamp === "number" && Number.isFinite(timestamp)
        ? agora - timestamp > PRAZO_DA_FILA_OFFLINE_MS
        : semTimestamp === "vencido";
    (vencido ? vencidos : validos).push(item);
  }
  return { validos, vencidos };
}

function lerLista(chave: string): unknown[] | null {
  const bruto = localStorage.getItem(chave);
  if (bruto === null) return [];
  try {
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista : null;
  } catch {
    return null;
  }
}

function timestampDe(item: unknown): number {
  const t =
    typeof item === "object" && item !== null
      ? (item as ItemDatado).timestamp
      : undefined;
  return typeof t === "number" ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Leva a fila ANTIGA (chave sem `:<uid>`, gravada antes deste desenho) para a
 * chave do usuário. O legado se reconhece pelo NOME da chave antiga — nunca
 * pela ausência de um campo no item.
 *
 * Quem chama decide QUEM pode adotar: só com `adminStatus === "admin"`
 * CONFIRMADO. Para um cliente (ou sessão ainda não confirmada) a chave antiga
 * fica intocada — a atualização de produto por não-admin dá 0 linhas SEM
 * erro, e o código contaria como sincronizado e apagaria a escrita.
 *
 * Seguro de rodar duas vezes: a chave antiga só é removida DEPOIS da nova
 * gravada; se a gravação lançar, a antiga continua inteira. Se a chave nova
 * ou a antiga estiverem ilegíveis (JSON quebrado), nada é tocado. Itens com o
 * mesmo `idDe` ficam com o de timestamp maior. Devolve quantos itens vieram.
 */
export function migrarFilaLegada(
  chaveAntiga: string,
  userId: string,
  idDe: (item: unknown) => string | undefined,
): number {
  const antiga = lerLista(chaveAntiga);
  if (antiga === null || antiga.length === 0) {
    // Lista vazia legível: a chave antiga não tem o que migrar — só limpa.
    if (antiga !== null && localStorage.getItem(chaveAntiga) !== null) {
      localStorage.removeItem(chaveAntiga);
    }
    return 0;
  }
  const chaveNova = chaveDoUsuario(chaveAntiga, userId);
  const nova = lerLista(chaveNova);
  if (nova === null) return 0;

  const juntada = [...nova];
  for (const item of antiga) {
    const id = idDe(item);
    const indice =
      id === undefined ? -1 : juntada.findIndex((i) => idDe(i) === id);
    if (indice === -1) {
      juntada.push(item);
    } else if (timestampDe(item) > timestampDe(juntada.at(indice))) {
      juntada.splice(indice, 1, item);
    }
  }
  localStorage.setItem(chaveNova, JSON.stringify(juntada));
  localStorage.removeItem(chaveAntiga);
  return antiga.length;
}
