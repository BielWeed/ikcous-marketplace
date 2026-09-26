import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { Activity, BarChart3, TrendingUp, Wallet } from "lucide-react";

/**
 * "Central de Inteligência & KPIs" — a ajuda que era do Dashboard, agora do
 * Dashboard CRM. A parte "Histórico completo" descreve EXATAMENTE os cartões
 * de KpiSummaryCards (buildKpiCards) — a ajuda antiga já chegou a documentar
 * três KPIs que a tela nunca teve (teste
 * ajuda-do-dashboard-descreve-os-kpis-da-tela).
 */
export function AjudaDoCrm({
  isOpen,
  onClose,
}: Readonly<{ isOpen: boolean; onClose: () => void }>) {
  return (
    <AdminHelpModal
      isOpen={isOpen}
      onClose={onClose}
      title="Central de Inteligência & KPIs"
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-zinc-400">
          O Dashboard CRM junta o app e a loja física numa visão só: escolha o
          período no topo (Hoje, 7, 30 ou 90 dias, Mês ou Ano) e os números do
          período passam a contar aquele intervalo, comparados com o intervalo
          anterior. A lista de clientes e o histórico completo olham a vida
          inteira da loja. Só entra dinheiro que entrou de verdade.
        </p>

        <div className="space-y-3">
          <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
            As abas
          </h4>
          <ul className="list-inside list-disc space-y-2 text-xs text-zinc-400">
            <li>
              <strong className="text-white">Visão geral:</strong> receita,
              pedidos, ticket médio, clientes, recompra, LTV (quanto um cliente
              já gastou, em média), receita em risco e taxa de devolução — e,
              abaixo, o histórico completo da loja.
            </li>
            <li>
              <strong className="text-white">Clientes:</strong> segmentos RFM
              (recência, frequência e valor) no modelo usado pelo Shopify —
              Campeões, Leais, Em risco, Hibernando e outros. Toque num segmento
              para filtrar a lista; o botão de WhatsApp abre a conversa com um
              texto pronto para aquele segmento.
            </li>
            <li>
              <strong className="text-white">Canais:</strong> app × loja física
              (receita, pedidos e ticket) e o mix de formas de pagamento.
            </li>
            <li>
              <strong className="text-white">Funil e pedidos:</strong> de
              visitas a pedidos pagos, com a conversão de cada passo, e os
              pedidos por status com a idade do mais antigo parado.
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
            Histórico completo (Visão geral)
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <Wallet
                  className="size-4 text-emerald-500"
                  aria-hidden="true"
                />
                Volume Total
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">
                O dinheiro que entrou de verdade no período: a soma dos pedidos
                com pagamento reconhecido (PIX confirmado, gateway ou recebido
                na entrega), já descontados os cupons. Pedido cancelado não
                entra.
              </p>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <Activity
                  className="size-4 text-admin-gold"
                  aria-hidden="true"
                />
                Total de Pedidos
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">
                Quantas compras foram feitas no período — cada pedido confirmado
                conta uma vez, de qualquer valor.
              </p>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <BarChart3 className="size-4 text-sky-500" aria-hidden="true" />
                Ticket Médio
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">
                Quanto vale, em média, cada pedido: o Volume Total dividido pelo
                número de pedidos. Ajuda a entender o tamanho típico de uma
                compra na loja.
              </p>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <TrendingUp
                  className="size-4 text-purple-500"
                  aria-hidden="true"
                />
                Clientes Únicos
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">
                Quantas pessoas diferentes compraram no período — cada cliente
                conta uma vez, mesmo que tenha feito vários pedidos.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
            Outros Componentes
          </h4>
          <ul className="list-inside list-disc space-y-2 text-xs text-zinc-400">
            <li>
              <strong className="text-white">Performance Operacional:</strong>{" "}
              Histórico de pedidos e faturamento ao longo do tempo em gráficos
              interativos.
            </li>
            <li>
              <strong className="text-white">
                Inteligência Estratégica por Categoria:
              </strong>{" "}
              Divisão proporcional de faturamento, volume de vendas e ticket
              médio por categoria de produto.
            </li>
            <li>
              <strong className="text-white">Produtos Mais Lucrativos:</strong>{" "}
              Os cinco produtos com maior lucro (preço de venda menos o custo
              cadastrado) em pedidos válidos de todo o período. Produto sem
              custo cadastrado conta custo zero — cadastre o custo para o
              ranking refletir a margem de verdade.
            </li>
          </ul>
        </div>
      </div>
    </AdminHelpModal>
  );
}
