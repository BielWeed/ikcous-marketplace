import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { ExplicacaoDoRelatorio } from "@/components/admin/crm/ExplicacaoDoRelatorio";
import {
  CLICAVEL_DO_CRM,
  CartaoDoCrm,
  EstadoVazioDoCrm,
} from "@/components/admin/crm/PecasDoCrm";
import {
  conversaoEmVenda,
  formatarInteiro,
  formatarPercentual,
  idadePorExtenso,
  pedidosSemVendaPaga,
  pipelineEmAberto,
  rotuloDoStatusDoPedido,
  tomDaTaxaDePagamento,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { EtapaDoPipeline, FunilDoCrm, VisaoDoCrm } from "@/types/crm";
import {
  ChevronRight,
  Clock,
  type LucideIcon,
  Package,
  PackageCheck,
  PackageSearch,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

interface DefinicaoDeEtapa {
  readonly chave: keyof FunilDoCrm;
  readonly rotulo: string;
  /** Unidade por extenso — usada na barra proporcional ("13 pedidos criados"). */
  readonly unidade: string;
  /** Unidade curta — usada no cartão de etapas ("13 pedidos"), sem repetir
   * o nome da etapa duas vezes. */
  readonly unidadeCurta: string;
}

interface EtapaMedida extends DefinicaoDeEtapa {
  readonly valor: number;
}

/** Só as etapas que o app realmente mede — cada uma com a unidade escrita. */
const ETAPAS_MEDIDAS: readonly DefinicaoDeEtapa[] = [
  {
    chave: "carrinhos",
    rotulo: "Carrinhos",
    unidade: "pessoas com carrinho",
    unidadeCurta: "pessoas",
  },
  {
    chave: "pedidosCriados",
    rotulo: "Pedidos criados",
    unidade: "pedidos criados",
    unidadeCurta: "pedidos",
  },
  {
    chave: "pedidosPagos",
    rotulo: "Pedidos pagos",
    unidade: "pedidos pagos",
    unidadeCurta: "pagos",
  },
];

/** Ordem de trabalho do lojista; status desconhecido vai para o fim. */
const ORDEM_DO_PIPELINE = [
  "new",
  "pending",
  "processing",
  "shipping",
  "delivered",
  "cancelled",
];

function ordenarPipeline(
  etapas: readonly EtapaDoPipeline[],
): EtapaDoPipeline[] {
  const posicao = (status: string) => {
    const indice = ORDEM_DO_PIPELINE.indexOf(status);
    return indice === -1 ? ORDEM_DO_PIPELINE.length : indice;
  };
  return [...etapas].sort((a, b) => posicao(a.status) - posicao(b.status));
}

/** Status que ainda esperam o lojista agir — onde a idade importa. */
const ESPERAM_O_LOJISTA = new Set(["new", "pending", "processing"]);
const DOIS_DIAS_MS = 2 * 86_400_000;

function estiloDoStatus(status: string): {
  icone: LucideIcon;
  cor: string;
  chip: string;
} {
  switch (status) {
    case "new":
    case "pending":
      return {
        icone: ShoppingBag,
        cor: "text-sky-300",
        chip: "border-sky-500/20 bg-sky-500/10",
      };
    case "processing":
      return {
        icone: PackageSearch,
        cor: "text-violet-300",
        chip: "border-violet-500/20 bg-violet-500/10",
      };
    case "shipping":
      return {
        icone: Truck,
        cor: "text-indigo-300",
        chip: "border-indigo-500/20 bg-indigo-500/10",
      };
    case "delivered":
      return {
        icone: PackageCheck,
        cor: "text-emerald-300",
        chip: "border-emerald-500/20 bg-emerald-500/10",
      };
    case "cancelled":
      return {
        icone: XCircle,
        cor: "text-rose-300",
        chip: "border-rose-500/20 bg-rose-500/10",
      };
    default:
      return {
        icone: Package,
        cor: "text-zinc-300",
        chip: "border-admin-border bg-white/5",
      };
  }
}

/**
 * Superfície do destaque "Conversão em venda" por tom — a cor reage ao
 * valor medido (`tomDaTaxaDePagamento`), nunca é sempre verde: o dono via
 * 0% pintado da mesma cor de sucesso do resto do painel.
 */
const CLASSES_DO_DESTAQUE_DE_PAGAMENTO: Record<
  ReturnType<typeof tomDaTaxaDePagamento>,
  { readonly caixa: string; readonly rotulo: string }
> = {
  boa: {
    caixa: "border-emerald-500/20 bg-emerald-500/[0.06]",
    rotulo: "text-emerald-300",
  },
  mediana: {
    caixa: "border-amber-500/20 bg-amber-500/[0.06]",
    rotulo: "text-amber-300",
  },
  baixa: {
    caixa: "border-rose-500/20 bg-rose-500/[0.06]",
    rotulo: "text-rose-300",
  },
  neutra: {
    caixa: "border-admin-border bg-admin-raised",
    rotulo: "text-zinc-400",
  },
};

function FunilEmEtapas({ medidas }: Readonly<{ medidas: EtapaMedida[] }>) {
  return (
    <div className="flex items-stretch gap-1">
      {medidas.map((etapa, i) => (
        <div
          key={etapa.chave}
          role="group"
          aria-label={etapa.rotulo}
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {i > 0 && (
            <ChevronRight
              aria-hidden="true"
              className="text-admin-text-soft size-3 shrink-0"
            />
          )}
          <div className="min-h-14 min-w-0 flex-1 rounded-xl border border-admin-border bg-admin-raised py-1 text-center">
            <p className="text-admin-text text-2xl font-extrabold tabular-nums">
              {formatarInteiro(etapa.valor)}
            </p>
            <p className="text-admin-text-soft text-[11px]">
              {etapa.unidadeCurta}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Pipeline({
  etapas,
  onNavigate,
}: Readonly<{
  etapas: readonly EtapaDoPipeline[];
  onNavigate: (view: View) => void;
}>) {
  // Entregue e cancelado já saíram da fila — não são "pedidos em aberto".
  const ordenadas = ordenarPipeline(pipelineEmAberto(etapas));
  // "Agora" é fotografado junto com os dados: cada leitura nova do pipeline
  // recalcula as idades (render continua puro).
  const [agora, setAgora] = useState(() => Date.now());
  const [expandido, setExpandido] = useState(false);
  useEffect(() => {
    setAgora(Date.now());
  }, [etapas]);

  return (
    <CartaoDoCrm
      id="crm-pipeline"
      titulo="Pedidos em aberto agora"
      descricao="A fila neste instante · não segue o período"
    >
      <div className="space-y-3">
        {ordenadas.length === 0 ? (
          <EstadoVazioDoCrm
            titulo="Nenhum pedido em aberto"
            texto="A fila está em dia: nenhum pedido esperando separação, pagamento ou envio."
          />
        ) : (
          <ul className="space-y-1.5">
            {(expandido ? ordenadas : ordenadas.slice(0, 3)).map((etapa) => {
              const estilo = estiloDoStatus(etapa.status);
              // Por extenso nos dois casos ("mais antigo há 1 dia", "parado
              // há 81 dias") — nunca a abreviação "1 d" ao lado do selo por
              // extenso, que ficava inconsistente.
              const idade = idadePorExtenso(etapa.maisAntigoEm, agora);
              const instante = etapa.maisAntigoEm
                ? Date.parse(etapa.maisAntigoEm)
                : Number.NaN;
              const podeEstarParado = ESPERAM_O_LOJISTA.has(etapa.status);
              const parado =
                podeEstarParado &&
                etapa.quantidade > 0 &&
                !Number.isNaN(instante) &&
                agora - instante > DOIS_DIAS_MS;
              return (
                <li key={etapa.status}>
                  <button
                    type="button"
                    onClick={() => onNavigate("admin-orders")}
                    className={cn(
                      CLICAVEL_DO_CRM,
                      "flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                        estilo.chip,
                      )}
                      aria-hidden="true"
                    >
                      <estilo.icone className={cn("size-4", estilo.cor)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-admin-text block text-xs font-bold">
                        {rotuloDoStatusDoPedido(etapa.status)}
                      </span>
                      {parado ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                          <Clock className="size-3" aria-hidden="true" />
                          parado há {idade}
                        </span>
                      ) : idade && podeEstarParado ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
                          <Clock className="size-3" aria-hidden="true" />
                          mais antigo há {idade}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-8 rounded-full border border-admin-border bg-white/5 px-2 py-0.5 text-center text-[11px] font-black tabular-nums text-zinc-200">
                      {formatarInteiro(etapa.quantidade)}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-zinc-600"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {ordenadas.length > 3 && (
          <button
            type="button"
            aria-expanded={expandido}
            onClick={() => setExpandido(!expandido)}
            className="text-admin-text min-h-11 w-full rounded-xl bg-admin-raised text-xs font-bold"
          >
            {expandido ? "Recolher" : "Ver tudo"}
          </button>
        )}
        {ordenadas.length > 0 ? (
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Entregues e cancelados não aparecem aqui.
          </p>
        ) : null}
      </div>
    </CartaoDoCrm>
  );
}

/** Mesmas etapas e mesma fila de antes, com o destaque no resumo fixo. */
export function FunilEPedidosDoCrm({
  visao,
  carregando,
  onNavigate,
  erro,
  offline = false,
  aoTentar,
}: Readonly<{
  visao: VisaoDoCrm | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
  erro?: string | null;
  offline?: boolean;
  aoTentar?: () => void;
}>) {
  const funil = visao?.funil;
  const criados = funil?.pedidosCriados ?? null;
  const pagos = funil?.pedidosPagos ?? null;
  const conversao =
    criados == null || pagos == null ? null : conversaoEmVenda(criados, pagos);
  const semVenda =
    criados == null || pagos == null
      ? null
      : pedidosSemVendaPaga(criados, pagos);
  const estilo =
    CLASSES_DO_DESTAQUE_DE_PAGAMENTO[tomDaTaxaDePagamento(conversao)];
  const esqueleto = carregando && !visao;
  const falha = !esqueleto && !visao && (!!erro || offline);
  const medidas = ETAPAS_MEDIDAS.flatMap((etapa) => {
    const valor = funil?.[etapa.chave];
    return valor == null ? [] : [{ ...etapa, valor }];
  });
  return (
    <div className="space-y-4">
      {!carregando && erro && visao && !offline && (
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
        titulo="Funil do app"
        legendasDoResumo={["Conversão em venda", "Pedidos pagos"]}
        loading={esqueleto}
        cards={[
          {
            label: "Conversão em venda",
            value: formatarPercentual(conversao),
            icon: ShoppingBag,
            accent: estilo.rotulo,
          },
          {
            label: "Pedidos pagos",
            value:
              pagos == null || criados == null
                ? "—"
                : `${formatarInteiro(pagos)} de ${formatarInteiro(criados)}`,
            icon: ShoppingBag,
          },
        ]}
        nota={
          falha ? (
            "Os números não carregaram"
          ) : offline ? (
            "Sem internet · números da última busca"
          ) : semVenda != null && semVenda > 0 ? (
            <>
              <span>
                {formatarInteiro(semVenda)}{" "}
                {semVenda === 1
                  ? "pedido não virou venda paga"
                  : "pedidos não viraram venda paga"}
              </span>
              <button
                type="button"
                onClick={() => onNavigate("admin-orders")}
                className="min-h-11 shrink-0 font-bold"
              >
                Ver pedidos ›
              </button>
            </>
          ) : semVenda === 0 ? (
            "Todo pedido criado virou venda paga"
          ) : (
            "Só o app · neste período"
          )
        }
        relatorio={{
          erro: falha,
          aoTentar,
          tom: falha
            ? "erro"
            : offline || (semVenda != null && semVenda > 0)
              ? "atencao"
              : undefined,
          rodape: (
            <>
              Pessoas com carrinho{" "}
              <strong className="text-admin-text">
                {formatarInteiro(funil?.carrinhos)}
              </strong>
            </>
          ),
          ajuda: (
            <ExplicacaoDoRelatorio titulo="Funil do app">
              Visitas e produtos vistos ainda não são medidos. Só conta quem
              entrou com conta. A conversão é vendas pagas ÷ pedidos criados.
            </ExplicacaoDoRelatorio>
          ),
        }}
      />
      {!falha && (
        <>
          <CartaoDoCrm
            id="crm-funil"
            titulo="Do carrinho ao pagamento"
            descricao="Só o app · neste período"
            className="min-h-[132px]"
          >
            {esqueleto ? (
              <div
                className="premium-shimmer h-14 rounded-xl"
                aria-hidden="true"
              />
            ) : medidas.length === 0 ? (
              <EstadoVazioDoCrm titulo="Ainda não há dados do funil do app" />
            ) : (
              <FunilEmEtapas medidas={medidas} />
            )}
          </CartaoDoCrm>
          {esqueleto ? (
            <div
              className="premium-shimmer min-h-[282px] rounded-2xl"
              aria-hidden="true"
            />
          ) : (
            <Pipeline etapas={visao?.pipeline ?? []} onNavigate={onNavigate} />
          )}
        </>
      )}
    </div>
  );
}
