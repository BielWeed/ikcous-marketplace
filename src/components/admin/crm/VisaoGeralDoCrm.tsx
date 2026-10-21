import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import {
  EXPLICACAO_HISTORICA,
  ExplicacaoDoRelatorio,
} from "@/components/admin/crm/ExplicacaoDoRelatorio";
import { EstadoVazioDoCrm } from "@/components/admin/crm/PecasDoCrm";
import { TileDeKpi } from "@/components/admin/crm/TileDeKpi";
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { StrategicIntelligenceBlocks } from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
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

export function VisaoGeralDoCrm({
  visao,
  carregando,
  comparacao,
  intervalo = "",
  classico,
  active,
  onNavigate,
  aoVerSegmento,
  erro: erroDaVisao,
  offline = false,
  aoTentar,
}: Readonly<{
  visao: VisaoDoCrm | null;
  carregando: boolean;
  comparacao: string;
  intervalo?: string;
  classico: EstadoClassico;
  active: boolean;
  onNavigate: (view: View, id?: string) => void;
  aoVerSegmento: (segmento: SegmentoCrm) => void;
  erro?: string | null;
  offline?: boolean;
  aoTentar?: () => void;
}>) {
  const k = visao?.kpis;
  const esqueleto = carregando && !visao;
  const { stats, categorias, erro, erroDeCategoria, carregar } = classico;
  const carregandoClassico = classico.carregando && !stats;
  const falha = !esqueleto && !visao && (!!erroDaVisao || offline);
  const variacaoDaReceita = variacaoPercentual(k?.receita, k?.receitaAnterior);
  const variacaoDosPedidos = variacaoPercentual(k?.pedidos, k?.pedidosAnterior);
  const variacaoDoTicketMedio = variacaoPercentual(
    k?.ticketMedio,
    k?.ticketMedioAnterior,
  );
  const chip = (pct: number | null) =>
    pct == null ? null : (
      <ChipDeVariacao curto pct={pct} comparacao={comparacao} />
    );
  const emRisco = (k?.receitaEmRisco ?? 0) > 0;
  // Só os dados do histórico podem distinguir loja nova de um período sem venda.
  const lojaSemVenda =
    !!visao &&
    k?.pedidos === 0 &&
    !!stats &&
    stats.revenueHistory?.every((d) => !d.orders && !d.revenue);
  const cards: KpiCardConfig[] = [
    {
      label: "Valor médio por venda",
      value: formatarMoeda(k?.ticketMedio),
      compactValue: formatarMoedaCompacta(k?.ticketMedio),
      icon: Receipt,
      accent: "text-sky-400",
      footer: falha
        ? "Sem dado agora"
        : k?.pedidos === 0
          ? "Sem venda neste período"
          : chip(variacaoDoTicketMedio),
    },
    {
      label: "Receita em risco",
      value: formatarMoeda(k?.receitaEmRisco),
      compactValue: formatarMoedaCompacta(k?.receitaEmRisco),
      icon: AlertTriangle,
      accent: "text-amber-400",
      footer: falha ? (
        "Sem dado agora"
      ) : emRisco ? (
        <button
          type="button"
          onClick={() => aoVerSegmento("em_risco")}
          className="-my-2 inline-flex min-h-11 items-center gap-1 text-left font-bold text-amber-300"
        >
          Ver quem pode não voltar{" "}
          <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
        </button>
      ) : k?.receitaEmRisco === 0 ? (
        "Nenhum cliente nesse grupo agora"
      ) : (
        "Sem dado agora"
      ),
    },
    {
      label: "Clientes compradores",
      value: formatarInteiro(k?.clientesCompradores),
      icon: Users,
      accent: "text-violet-400",
      footer:
        k?.clientesNovos == null
          ? "Sem dado agora"
          : `${formatarInteiro(k.clientesNovos)} ${k.clientesNovos === 1 ? "cliente novo" : "clientes novos"}`,
    },
    {
      label: "Taxa de recompra",
      value: formatarPercentual(k?.taxaRecompra),
      icon: Repeat,
      accent: "text-emerald-400",
      footer:
        k?.receitaRecorrentePct == null
          ? "Sem dado agora"
          : `${formatarPercentual(k.receitaRecorrentePct)} da receita vem de quem volta`,
    },
    {
      label: "Total já comprado por cliente (média)",
      value: formatarMoeda(k?.ltvMedio),
      compactValue: formatarMoedaCompacta(k?.ltvMedio),
      icon: Crown,
      footer: falha
        ? "Sem dado agora"
        : "Quanto um cliente já gastou, em média",
    },
    {
      label: "Taxa de devolução",
      value: formatarPercentual(k?.taxaDevolucao),
      icon: RotateCcw,
      accent: "text-rose-400",
      footer: falha ? "Sem dado agora" : "Do valor vendido no período",
    },
  ];
  return (
    <div className="space-y-4">
      {!carregando && erroDaVisao && visao && !offline && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-xs text-amber-300"
        >
          <p>Não deu para atualizar · mostrando a última busca</p>
          <button
            type="button"
            onClick={aoTentar}
            className="min-h-11 shrink-0 px-2 font-bold"
          >
            Tentar de novo
          </button>
        </div>
      )}
      <MetricasDoPainel
        titulo="Números do período"
        legendasDoResumo={["Receita", "Pedidos"]}
        cards={[
          {
            label: "Receita",
            value: formatarMoeda(k?.receita),
            compactValue: formatarMoedaCompacta(k?.receita),
            icon: TrendingUp,
            content: chip(variacaoDaReceita),
          },
          {
            label: "Pedidos",
            value: formatarInteiro(k?.pedidos),
            icon: ShoppingBag,
            content: chip(variacaoDosPedidos),
          },
        ]}
        loading={esqueleto}
        nota={
          falha
            ? "Os números não carregaram"
            : offline
              ? "Sem internet · números da última busca"
              : lojaSemVenda
                ? "Sua loja ainda não tem venda paga"
                : k?.pedidos === 0
                  ? "Nenhuma venda paga neste período"
                  : "Só entra venda paga · app e balcão juntos"
        }
        relatorio={{
          rodape: `${intervalo}${intervalo ? " · " : ""}${comparacao}`,
          erro: falha,
          aoTentar,
          tom: falha ? "erro" : offline ? "atencao" : undefined,
          ajuda: (
            <ExplicacaoDoRelatorio titulo="Números do período">
              Conta só venda que já foi paga, do app e do balcão. A seta compara
              com os mesmos dias logo antes.
            </ExplicacaoDoRelatorio>
          ),
        }}
      />
      {lojaSemVenda ? (
        <EstadoVazioDoCrm
          className="h-[188px] justify-center"
          titulo="Os relatórios começam na primeira venda"
          texto="Venda pelo app ou registre uma venda do balcão. Os números aparecem aqui sozinhos."
          acao={
            <button
              type="button"
              onClick={() => onNavigate("admin-pdv")}
              className="bg-admin-gold-fill text-admin-gold-ink min-h-11 rounded-xl px-4 text-xs font-bold"
            >
              Vender no balcão
            </button>
          }
        />
      ) : (
        <AdminKpiCarousel
          title="MAIS NÚMEROS"
          cards={cards}
          active={active}
          relatorio
          loading={esqueleto}
          renderCard={(card) => (
            <TileDeKpi
              relatorio
              rotulo={card.label}
              valor={String(card.value)}
              valorCompacto={card.compactValue}
              icone={card.icon}
              corDoIcone={card.accent}
              rodape={card.footer}
              carregando={esqueleto}
              atencao={card.label === "Receita em risco" && emRisco}
              ajuda={
                [
                  "Receita em risco",
                  "Taxa de recompra",
                  "Total já comprado por cliente (média)",
                ].includes(card.label) ? (
                  <ExplicacaoDoRelatorio titulo={card.label}>
                    {EXPLICACAO_HISTORICA}
                  </ExplicacaoDoRelatorio>
                ) : undefined
              }
            />
          )}
        />
      )}
      <section
        aria-label="Histórico completo da loja"
        className="space-y-4 pt-2"
      >
        {erro && !classico.carregando ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-300"
          >
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="text-xs">Falha ao carregar dados: {erro}</p>
            <button
              type="button"
              onClick={() => carregar(true)}
              className="ml-auto min-h-11 px-3 text-xs font-bold"
            >
              Tentar
            </button>
          </div>
        ) : null}
        <LocalErrorBoundary>
          <OperationalPerformanceChart
            stats={stats}
            loading={carregandoClassico}
            active={active}
            onNavigate={onNavigate}
          />
        </LocalErrorBoundary>
        <LocalErrorBoundary>
          <StrategicIntelligenceBlocks
            categoryData={categorias}
            loading={carregandoClassico}
            active={active}
            error={erroDeCategoria}
            onRetry={() => carregar(true)}
          />
        </LocalErrorBoundary>
        <LocalErrorBoundary>
          <TopProductsList
            stats={stats}
            loading={carregandoClassico}
            onNavigate={onNavigate}
          />
        </LocalErrorBoundary>
      </section>
    </div>
  );
}
