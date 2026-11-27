import { gerarUuidV4 as gerarChave } from "@/lib/uuid-v4";
import type { SessaoDeCaixa } from "@/types/financeiro";

// Uma intenção por autor, sessão e tipo, sem prazo. Guarda SOMENTE o UUID.
// Editar campos, fechar a folha ou recarregar não prova que o servidor recusou.
// Sem armazenamento, quem chama conserva a chave em memória enquanto a folha vive.
const PREFIXO = "ikcous_fin_caixa_tentativa:";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Tipo = "sangria" | "suprimento";

function endereco(autor: string, sessao: string, tipo: Tipo): string {
  return PREFIXO + JSON.stringify([autor, sessao, tipo]);
}

export function chaveDaTentativaDoCaixa(
  autor: string | null,
  sessao: string,
  tipo: Tipo,
): string {
  if (autor) {
    try {
      const salva = localStorage.getItem(endereco(autor, sessao, tipo));
      if (salva && UUID.test(salva)) return salva;
    } catch {
      // Armazenamento indisponível: identidade fica na ref da folha.
    }
  }
  const chave = gerarChave();
  if (autor) {
    try {
      localStorage.setItem(endereco(autor, sessao, tipo), chave);
    } catch {
      // Não impedir a operação; sem prometer proteção após desmontar.
    }
  }
  return chave;
}

export function esquecerTentativaDoCaixa(
  autor: string | null,
  sessao: string,
  tipo: Tipo,
  chave: string | null,
): void {
  if (!autor || !chave) return;
  try {
    const local = endereco(autor, sessao, tipo);
    // Uma resposta antiga não apaga uma intenção posterior de outra aba.
    if (localStorage.getItem(local) === chave) localStorage.removeItem(local);
  } catch {
    // A folha continua funcionando mesmo se a remoção for bloqueada.
  }
}

/** Só a leitura nova do histórico comprova quais sessões foram fechadas. */
export function esquecerTentativasDeSessoesFechadas(
  autor: string | null,
  sessoes: readonly SessaoDeCaixa[],
): void {
  if (!autor) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const local = localStorage.key(i);
      if (!local?.startsWith(PREFIXO)) continue;
      const alvo: unknown = JSON.parse(local.slice(PREFIXO.length));
      if (
        Array.isArray(alvo) &&
        alvo[0] === autor &&
        sessoes.some(
          (sessao) =>
            sessao.id === alvo[1] &&
            sessao.status === "fechado" &&
            sessao.fechadoEm,
        )
      ) {
        localStorage.removeItem(local);
      }
    }
  } catch {
    // Sem leitura confiável, não concluir que uma intenção deixou de existir.
  }
}

// Pedido de fechamento DESTE aparelho. A resposta do fechamento pode se perder;
// ela fecha a folha, abre de novo e manda o mesmo valor, e o banco responde com
// `replay`. Sem esta memória a folha nova não sabe que o pedido foi dela e diz
// "Nada foi fechado agora" sobre o fechamento que ela fez segundos antes. Fica
// na aba (sessionStorage), é de quem pediu (id da conta) e do MESMO caixa e
// valor, e vence em 10 minutos: replay de um fechamento antigo (tela velha)
// continua sendo "já estava fechado". Sem conta ou sem armazenamento, só a
// memória da própria folha vale.
const PEDIDOS_DE_FECHAMENTO = "ikcous_fin_caixa_pedidos_de_fechamento";
const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

function enderecoDoPedido(
  autor: string,
  sessao: string,
  contado: number,
): string {
  return JSON.stringify([autor, sessao, Math.round(contado * 100)]);
}

function lerPedidos(): Map<string, unknown> {
  try {
    const bruto = sessionStorage.getItem(PEDIDOS_DE_FECHAMENTO);
    const lido: unknown = bruto ? JSON.parse(bruto) : {};
    return lido && typeof lido === "object" && !Array.isArray(lido)
      ? new Map(Object.entries(lido))
      : new Map();
  } catch {
    return new Map();
  }
}

function valendo(em: unknown, agora: number): boolean {
  return (
    typeof em === "number" &&
    agora - em >= 0 &&
    agora - em <= VALIDADE_DO_PEDIDO_MS
  );
}

export function lembrarPedidoDeFechamento(
  autor: string | null,
  sessao: string,
  contado: number,
): void {
  if (!autor) return;
  const agora = Date.now();
  const pedidos = new Map<string, unknown>();
  for (const [endereco, em] of lerPedidos()) {
    if (valendo(em, agora)) pedidos.set(endereco, em);
  }
  pedidos.set(enderecoDoPedido(autor, sessao, contado), agora);
  try {
    sessionStorage.setItem(
      PEDIDOS_DE_FECHAMENTO,
      JSON.stringify(Object.fromEntries(pedidos)),
    );
  } catch {
    // Sem armazenamento: só a memória da própria folha reconhece a repetição.
  }
}

/** Este aparelho, com esta conta, pediu este fechamento há poucos minutos? */
export function pediuEsteFechamentoHaPouco(
  autor: string | null,
  sessao: string,
  contado: number,
): boolean {
  if (!autor) return false;
  return valendo(
    lerPedidos().get(enderecoDoPedido(autor, sessao, contado)),
    Date.now(),
  );
}
