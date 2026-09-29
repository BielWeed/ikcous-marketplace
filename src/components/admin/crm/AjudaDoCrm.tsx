import { AdminHelpModal } from "@/components/admin/AdminHelpModal";

/**
 * "Central de Inteligência & KPIs" — a ajuda que era do Dashboard, agora do
 * Dashboard CRM. A ajuda antiga já chegou a documentar três KPIs que a tela
 * nunca teve (teste ajuda-do-dashboard-descreve-os-kpis-da-tela) — por isso
 * "Histórico completo (Visão geral)" abaixo descreve EXATAMENTE os blocos
 * que sobraram lá (Performance, Inteligência por categoria, Produtos mais
 * lucrativos). O carrossel "Métricas principais" (Volume total, Total de
 * pedidos, Ticket médio, Clientes únicos, de toda a vida da loja) saiu em
 * 28/09/2026: duplicava os 8 números do período que já aparecem no topo da
 * Visão geral.
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
              <strong className="text-white">Clientes:</strong> a lista mostra
              todo mundo — quem já comprou, agrupado por segmentos RFM
              (recência, frequência e valor) no modelo usado pelo Shopify —
              Campeões, Leais, Em risco, Hibernando e outros —, quem fez pedido
              e não pagou ("Pediu e não pagou") e quem se cadastrou e ainda não
              comprou ("Cadastrado, nunca comprou"). Toque num segmento para
              filtrar a lista; o botão de WhatsApp abre a conversa com um texto
              pronto para aquele grupo.
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
