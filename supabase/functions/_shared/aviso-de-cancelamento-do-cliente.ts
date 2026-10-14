// @ts-nocheck
/**
 * AVISO AO LOJISTA: "o cliente cancelou o pedido" (14/10/2026).
 *
 * O DEFEITO. O cliente cancela pelo botão "Cancelar Pedido" e a loja não sabia:
 * nem push, nem item no sino. O pedido pago e não enviado tem a devolução do
 * dinheiro aberta na hora e feita pela rotina de 10 minutos sem ninguém
 * clicar; o lojista, sem saber, podia comprar etiqueta e despachar produto
 * cujo dinheiro já voltou.
 *
 * ONDE ISTO RODA, E POR QUÊ AQUI. Dentro da `reconciliar-pagamentos` (a rotina
 * de 10 minutos, canal com segredo próprio), num passo separado:
 *   - o banco não sabe mandar push (a chave VAPID só existe na edge) e o
 *     `pg_net` saiu da casa de propósito (20260820000100), então gatilho no
 *     banco não é opção;
 *   - o aviso de pedido novo vem do NAVEGADOR (`notify-new-order`); aqui o
 *     navegador é o do cliente, que pode fechar a aba — não serve de gatilho;
 *   - a rotina já tem o mecanismo do aviso ao lojista (`avisarAdminUmaVez`,
 *     reserva em `avisos_ao_lojista`, push a todo `role = 'admin'`).
 * O PREÇO, dito na cara: o aviso chega em até 10 minutos depois do clique.
 *
 * COMO DETECTA. Pelo HISTÓRICO do pedido (`marketplace_order_history`), que a
 * `pedido__mudar_status` — o ponto único do cancelamento, pelo painel, pelo
 * app do cliente e pela edge que anula a cobrança — grava com `created_by` =
 * quem cancelou. É "cliente" quando: a linha é de status `cancelled` (e não
 * um re-cancelamento), `created_by` é o próprio DONO do pedido, esse usuário
 * não é admin (admin que compra na própria loja não é "cliente cancelando"), o
 * pedido segue cancelado, e o pagamento entrou (pago, pago depois de
 * expirar, ou já estornado). Expiração do PIX e recusa cancelam pedido NÃO
 * pago e não avisam.
 *
 * `estornado` conta como pago de propósito: o passo do estorno (mais abaixo,
 * na mesma rotina) pode devolver o dinheiro ANTES de uma nova rodada deste
 * passo ter chance de avisar (se uma rodada falhou); sem isso o aviso morreria
 * em silêncio justo no caso em que o dinheiro já voltou.
 *
 * IDEMPOTÊNCIA. A chave é por EVENTO, não por pedido: `cancelado_pelo_cliente:
 * <id da linha do histórico>`. A mesma linha vista de novo (rotina rodando duas
 * vezes, reentrada) pede a mesma chave e a reserva segura o duplicado; o
 * cliente que reativou e cancelou de novo gerou OUTRA linha e avisa de novo. A
 * janela de 24 h existe porque, se nenhum admin tem push, a reserva é solta e
 * a rotina tentaria a cada 10 minutos para sempre.
 *
 * O QUE O AVISO CARREGA: só número, valor e nome do cliente (como o pedido
 * novo). Nada de CPF, endereço, telefone ou e-mail.
 *
 * Quem chama trata a falha deste módulo em try próprio: o aviso é um efeito, e
 * uma falha aqui nunca pode atrapalhar pagamento nem estorno.
 */
import { formatarBRL, numeroDoPedido } from "./pedido.ts";

export type Aviso = { title: string; body: string; url: string };

/** Quanto tempo depois do cancelamento a rotina ainda tenta avisar. */
export const JANELA_HORAS = 24;
/**
 * Quanto a rotina ESPERA o passo inteiro (leituras + todos os pushes), em ms.
 * O push service pode aceitar a conexao e nao responder, e o `fetch` do
 * web-push nao tem teto: sem este limite o passo prenderia a fila de estornos
 * que vem logo depois. Limite no passo todo, e nao por aviso, para o tempo
 * total nao crescer com o numero de eventos. Passado o teto o passo segue em
 * segundo plano (`comTempoLimite`) e a reserva do aviso expira sozinha.
 */
export const TETO_DO_PASSO_MS = 10000;
/** Teto de linhas de histórico lidas por rodada (as mais recentes primeiro). */
export const LIMITE_POR_RODADA = 100;

/** `pago_apos_expirar` e `estornado` entram: ver o cabeçalho. */
const PAGAMENTO_QUE_ENTROU = ["pago", "pago_apos_expirar", "estornado"];

export type ResumoDosCancelamentos = {
  candidatos: number;
  avisados: number;
  ignorados: number;
  falhas: number;
};

const SEM_RESUMO: ResumoDosCancelamentos = { candidatos: 0, avisados: 0, ignorados: 0, falhas: 0 };

/**
 * O texto do aviso. Três frases, uma por situação do dinheiro, e nenhuma delas
 * promete o que o banco não faz:
 *   - já enviado: a devolução do dinheiro é manual e só depois do produto voltar;
 *   - pago depois do cancelamento: não há devolução aberta por este caminho;
 *   - pago e não enviado: o banco abre a devolução e a rotina a faz sozinha.
 */
export function montarAvisoDeCancelamento(
  pedido: { id: string; customer_name?: unknown; total?: unknown; total_amount?: unknown; payment_status?: unknown; cancelled_after_shipping?: unknown },
  historico: { old_status?: unknown },
): Aviso {
  const valor = pedido.total ?? pedido.total_amount;
  const cliente = String(pedido.customer_name ?? "").trim() || "cliente sem nome";
  const jaSaiu = historico.old_status === "shipping" || pedido.cancelled_after_shipping === true;
  const frase = jaSaiu
    ? "pago, o produto já saiu: avise o transporte"
    : pedido.payment_status === "pago_apos_expirar"
    ? "pago depois do cancelamento: confira o pedido"
    : "pago, o reembolso é automático";
  return {
    title: "Cliente cancelou o pedido",
    body: `${numeroDoPedido(pedido.id)} · ${formatarBRL(valor)} · ${cliente} — ${frase}`,
    url: "/admin-orders",
  };
}

export async function avisarCancelamentosDoCliente(args: {
  supabase: any;
  /** `avisarAdminUmaVez` já amarrado ao push: nunca lança. */
  avisar: (chave: string, aviso: Aviso) => Promise<void>;
  agora?: () => number;
  rotulo?: string;
}): Promise<ResumoDosCancelamentos> {
  const { supabase, avisar } = args;
  const rotulo = args.rotulo ?? "reconciliar-pagamentos";
  const agora = args.agora ? args.agora() : Date.now();
  const desde = new Date(agora - JANELA_HORAS * 3600 * 1000).toISOString();

  const { data: linhas, error: erroHistorico } = await supabase
    .from("marketplace_order_history")
    .select("id, order_id, old_status, created_by, created_at")
    .eq("new_status", "cancelled")
    .not("created_by", "is", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(LIMITE_POR_RODADA);
  if (erroHistorico) throw erroHistorico;

  const candidatos = linhas ?? [];
  if (candidatos.length === 0) return { ...SEM_RESUMO };

  const idsDosPedidos = [...new Set(candidatos.map((l) => l.order_id))];
  const idsDosAutores = [...new Set(candidatos.map((l) => l.created_by))];

  const { data: pedidos, error: erroPedidos } = await supabase
    .from("marketplace_orders")
    .select("id, user_id, customer_name, total, total_amount, payment_status, status, cancelled_after_shipping")
    .in("id", idsDosPedidos);
  if (erroPedidos) throw erroPedidos;

  // Sem esta leitura não há como excluir o admin: falha lança, ninguém é
  // avisado "no escuro" (e a próxima rodada tenta de novo).
  const { data: perfis, error: erroPerfis } = await supabase
    .from("profiles")
    .select("id, role")
    .in("id", idsDosAutores);
  if (erroPerfis) throw erroPerfis;

  const pedidoPorId = new Map((pedidos ?? []).map((p) => [p.id, p]));
  // Autor sem perfil não é admin por nenhuma das fontes que a `is_admin_atual`
  // exige juntas (auth.users E profiles): só pode cancelar o que é seu.
  const admins = new Set((perfis ?? []).filter((p) => p.role === "admin").map((p) => p.id));

  const resumo: ResumoDosCancelamentos = { candidatos: candidatos.length, avisados: 0, ignorados: 0, falhas: 0 };

  for (const linha of candidatos) {
    try {
      const pedido = pedidoPorId.get(linha.order_id);
      const ehCancelamentoDoCliente = pedido &&
        linha.old_status !== "cancelled" &&
        linha.created_by === pedido.user_id &&
        !admins.has(linha.created_by) &&
        pedido.status === "cancelled" &&
        PAGAMENTO_QUE_ENTROU.includes(pedido.payment_status);
      if (!ehCancelamentoDoCliente) {
        resumo.ignorados++;
        continue;
      }
      await avisar(`cancelado_pelo_cliente:${linha.id}`, montarAvisoDeCancelamento(pedido, linha));
      resumo.avisados++;
    } catch (erro) {
      console.error(`${rotulo}: aviso de cancelamento do cliente falhou`, { historico: linha.id, erro });
      resumo.falhas++;
    }
  }
  return resumo;
}
