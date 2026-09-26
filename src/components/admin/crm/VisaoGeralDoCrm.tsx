import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import { TileDeKpi } from "@/components/admin/crm/TileDeKpi";
import { KpiSummaryCards } from "@/components/admin/dashboard/KpiSummaryCards";
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { StrategicIntelligenceBlocks } from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import { Button } from "@/components/ui/button";
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import type { useDashboardClassico } from "@/hooks/useCrm";
import {
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  variacaoPercentual,
} from "@/lib/crm";
import type { View } from "@/types";
import type { SegmentoCrm, VisaoDoCrm } from "@/types/crm";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Crown,
  Receipt,
  Repeat,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

type EstadoClassico = ReturnType<typeof useDashboardClassico>;

/**
 * Aba "Visão geral" do CRM: os 8 números do período escolhido (com
 * variação contra o período anterior onde a RPC traz a base) e, logo
 * abaixo, o dashboard que era o Início até 26/09/2026 — INTACTO: KPIs
 * históricos, inteligência por categoria, desempenho operacional e produtos
 * mais lucrativos.
 */
export function VisaoGeralDoCrm({
  visao,
  carregando,
  comparacao,
  classico,
  active,
  onNavigate,
  aoVerSegmento,
}: Readonly<{
  visao: VisaoDoCrm | null;
  carregando: boolean;
  /** "vs. mês anterior" etc. — o nome do período anterior. */
  comparacao: string;
  classico: EstadoClassico;
  active: boolean;
  onNavigate: (view: View, id?: string) => void;
  aoVerSegmento: (segmento: SegmentoCrm) => void;
}>) {
  const k = visao?.kpis;
  const esqueleto = carregando && !visao;
  const { stats, categorias, erro, erroDeCategoria, carregar } = classico;
  const carregandoClassico = classico.carregando && !stats;

  return (
    <div className="space-y-6 sm:space-y-10">
      <section aria-labelledby="crm-kpis-titulo" aria-busy={esqueleto}>
        <h2 id="crm-kpis-titulo" className="sr-only">
          Números do período
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <TileDeKpi
            rotulo="Receita"
            icone={TrendingUp}
            corDoIcone="text-emerald-400"
            carregando={esqueleto}
            valor={formatarMoeda(k?.receita)}
            valorCompacto={formatarMoedaCompacta(k?.receita)}
            rodape={
              <ChipDeVariacao
                pct={variacaoPercentual(k?.receita, k?.receitaAnterior)}
                comparacao={comparacao}
              />
            }
          />
          <TileDeKpi
            rotulo="Pedidos"
            icone={ShoppingBag}
            carregando={esqueleto}
            valor={formatarInteiro(k?.pedidos)}
            rodape={
              <ChipDeVariacao
                pct={variacaoPercentual(k?.pedidos, k?.pedidosAnterior)}
                comparacao={comparacao}
              />
            }
          />
          <TileDeKpi
            rotulo="Ticket médio"
            icone={Receipt}
            corDoIcone="text-sky-400"
            carregando={esqueleto}
            valor={formatarMoeda(k?.ticketMedio)}
            valorCompacto={formatarMoedaCompacta(k?.ticketMedio)}
            rodape={
              <ChipDeVariacao
                pct={variacaoPercentual(k?.ticketMedio, k?.ticketMedioAnterior)}
                comparacao={comparacao}
              />
            }
          />
          <TileDeKpi
            rotulo="Clientes compradores"
            icone={Users}
            corDoIcone="text-violet-400"
            carregando={esqueleto}
            valor={formatarInteiro(k?.clientesCompradores)}
            rodape={
              k?.clientesNovos == null ? null : (
                <span>
                  <strong className="font-bold tabular-nums text-sky-300">
                    {formatarInteiro(k.clientesNovos)}
                  </strong>{" "}
                  {k.clientesNovos === 1 ? "cliente novo" : "clientes novos"}
                </span>
              )
            }
          />
          <TileDeKpi
            rotulo="Taxa de recompra"
            icone={Repeat}
            corDoIcone="text-emerald-400"
            carregando={esqueleto}
            valor={formatarPercentual(k?.taxaRecompra)}
            rodape={
              k?.receitaRecorrentePct == null ? null : (
                <span>
                  <strong className="font-bold tabular-nums text-zinc-200">
                    {formatarPercentual(k.receitaRecorrentePct)}
                  </strong>{" "}
                  da receita vem de quem volta
                </span>
              )
            }
          />
          <TileDeKpi
            rotulo="LTV médio"
            icone={Crown}
            carregando={esqueleto}
            valor={formatarMoeda(k?.ltvMedio)}
            valorCompacto={formatarMoedaCompacta(k?.ltvMedio)}
            rodape="Quanto um cliente já gastou, em média"
          />
          <TileDeKpi
            rotulo="Receita em risco"
            icone={AlertTriangle}
            corDoIcone="text-amber-400"
            carregando={esqueleto}
            valor={formatarMoeda(k?.receitaEmRisco)}
            valorCompacto={formatarMoedaCompacta(k?.receitaEmRisco)}
            rodape={
              <button
                type="button"
                onClick={() => aoVerSegmento("em_risco")}
                className="-my-2 inline-flex min-h-8 items-center gap-1 font-bold text-amber-300 underline-offset-2 hover:underline"
              >
                Ver clientes em risco
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            }
          />
          <TileDeKpi
            rotulo="Taxa de devolução"
            icone={RotateCcw}
            corDoIcone="text-rose-400"
            carregando={esqueleto}
            valor={formatarPercentual(k?.taxaDevolucao)}
            rodape="Dos pedidos do período"
          />
        </div>
      </section>

      <section
        aria-labelledby="crm-historico-titulo"
        className="space-y-6 sm:space-y-10"
      >
        <div className="space-y-1 border-t border-white/5 pt-6">
          <h2
            id="crm-historico-titulo"
            className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
          >
            Histórico completo da loja
          </h2>
          <p className="text-xs text-zinc-500">
            Números de todo o período, desempenho diário, categorias e os
            produtos mais lucrativos.
          </p>
        </div>

        {erro && !classico.carregando ? (
          <div className="flex items-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="text-xs">Falha ao carregar dados: {erro}</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 border-red-500/20 text-[10px] text-red-400 hover:bg-red-500/10"
              onClick={() => carregar(true)}
            >
              Tentar
            </Button>
          </div>
        ) : null}

        {/* KpiSummaryCards traz o próprio `sm:px-6`; a margem negativa
            devolve o alinhamento com os blocos vizinhos. */}
        <div className="duration-300 animate-in fade-in slide-in-from-bottom-2 sm:-mx-6">
          <LocalErrorBoundary>
            <KpiSummaryCards
              stats={stats}
              loading={carregandoClassico}
              active={active}
            />
          </LocalErrorBoundary>
        </div>

        <div className="delay-75 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <LocalErrorBoundary>
            <StrategicIntelligenceBlocks
              categoryData={categorias}
              loading={carregandoClassico}
              active={active}
              error={erroDeCategoria}
              onRetry={() => carregar(true)}
            />
          </LocalErrorBoundary>
        </div>

        <div className="grid grid-cols-1 gap-6 delay-100 duration-300 animate-in fade-in slide-in-from-bottom-2 sm:gap-10 lg:grid-cols-3">
          <LocalErrorBoundary>
            <OperationalPerformanceChart
              stats={stats}
              loading={carregandoClassico}
              active={active}
              className="lg:col-span-3"
            />
          </LocalErrorBoundary>
        </div>

        <div className="grid grid-cols-1 gap-6 delay-150 duration-300 animate-in fade-in slide-in-from-bottom-2 sm:gap-10">
          <LocalErrorBoundary>
            <TopProductsList
              stats={stats}
              loading={carregandoClassico}
              onNavigate={onNavigate}
            />
          </LocalErrorBoundary>
        </div>
      </section>
    </div>
  );
}
