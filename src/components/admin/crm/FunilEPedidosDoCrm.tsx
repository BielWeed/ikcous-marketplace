import {
  CLICAVEL_DO_CRM,
  CartaoDoCrm,
  EstadoVazioDoCrm,
} from "@/components/admin/crm/PecasDoCrm";
import {
  conversaoEmVenda,
  formatarInteiro,
  formatarPercentual,
  funilEhMonotonico,
  idadePorExtenso,
  notaDeEtapasNaoMedidas,
  pedidosSemVendaPaga,
  pipelineEmAberto,
  rotuloDoStatusDoPedido,
  tomDaTaxaDePagamento,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { EtapaDoPipeline, FunilDoCrm, VisaoDoCrm } from "@/types/crm";
import {
  ArrowRight,
  ChevronDown,
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
        chip: "border-white/10 bg-white/5",
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
    rotulo: "text-emerald-300/80",
  },
  mediana: {
    caixa: "border-amber-500/20 bg-amber-500/[0.06]",
    rotulo: "text-amber-300/80",
  },
  baixa: {
    caixa: "border-rose-500/20 bg-rose-500/[0.06]",
    rotulo: "text-rose-300/80",
  },
  neutra: {
    caixa: "border-white/10 bg-white/[0.04]",
    rotulo: "text-zinc-400",
  },
};

/**
 * Destaque principal do funil: vendas pagas ÷ pedidos criados — "conversão
 * em venda", não mais "taxa de pagamento". O nome antigo dava a entender
 * que um pedido pago fica pago para sempre; um estorno/cancelamento tira o
 * pedido de `vendasPagas` (`crm__vendas`), mas ele continua contado em
 * `pedidosCriados` — o texto agora vale para as duas coortes.
 */
function DestaqueDeConversaoEmVenda({
  criados,
  pagos,
  onNavigate,
}: Readonly<{
  criados: number | null;
  pagos: number | null;
  onNavigate: (view: View) => void;
}>) {
  if (criados == null || pagos == null) return null;
  const conversao = conversaoEmVenda(criados, pagos);
  const semVendaPaga = pedidosSemVendaPaga(criados, pagos);
  const classes =
    CLASSES_DO_DESTAQUE_DE_PAGAMENTO[tomDaTaxaDePagamento(conversao)];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 sm:p-4",
        classes.caixa,
      )}
    >
      <div>
        <p
          className={cn(
            "text-[11px] font-black uppercase tracking-widest",
            classes.rotulo,
          )}
        >
          Conversão em venda
        </p>
        <p className="text-2xl font-black tabular-nums text-white">
          {formatarPercentual(conversao)}
        </p>
        <p className="text-[11px] text-zinc-400">
          vendas pagas ÷ pedidos criados
        </p>
      </div>
      {semVendaPaga != null && semVendaPaga > 0 ? (
        <button
          type="button"
          onClick={() => onNavigate("admin-orders")}
          className={cn(
            CLICAVEL_DO_CRM,
            "flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-amber-200",
          )}
        >
          {formatarInteiro(semVendaPaga)}{" "}
          {semVendaPaga === 1
            ? "pedido criado não virou venda paga"
            : "pedidos criados não viraram venda paga"}
          <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
          Ver pedidos
        </button>
      ) : null}
    </div>
  );
}

/**
 * Barras proporcionais centradas, afunilando — só faz sentido quando a
 * sequência é não-crescente (`funilEhMonotonico`). Valor 0 nunca é barra
 * preenchida: vira um trilho vazio (tracejado) com o "0" escrito, para não
 * parecer uma etapa com volume.
 */
function FunilProporcional({ medidas }: Readonly<{ medidas: EtapaMedida[] }>) {
  const topo = medidas.reduce(
    (maior, etapa) => Math.max(maior, etapa.valor),
    0,
  );
  return (
    <ol className="space-y-1">
      {medidas.map((etapa, indice) => {
        const vazio = etapa.valor === 0;
        const largura =
          topo > 0 ? Math.max((etapa.valor / topo) * 100, 14) : 14;
        return (
          <li key={etapa.chave}>
            {indice > 0 ? (
              <div className="flex justify-center py-1" aria-hidden="true">
                <ChevronDown className="size-3.5 text-zinc-600" />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-bold text-zinc-200">{etapa.rotulo}</span>
                <span className="tabular-nums text-zinc-400">
                  <strong className="font-bold text-white">
                    {formatarInteiro(etapa.valor)}
                  </strong>{" "}
                  {etapa.unidade}
                </span>
              </div>
              <div
                className={cn(
                  "mx-auto flex h-8 items-center justify-center rounded-lg text-[11px] font-black tabular-nums",
                  vazio
                    ? "border border-dashed border-white/15 bg-transparent text-zinc-500"
                    : "bg-gradient-to-b from-emerald-400/80 to-emerald-500/60 text-emerald-950",
                )}
                style={{ width: `${largura}%` }}
              >
                {formatarInteiro(etapa.valor)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Fileira de cartões ligados por chevron, SEM largura proporcional —
 * usada quando `funilEhMonotonico` é falso (etapas de unidades diferentes,
 * ex.: pessoas com carrinho → pedidos criados, que pode crescer). Barra
 * proporcional aqui alargaria em vez de afunilar e pareceria quebrada.
 * SEMPRE lado a lado (3 colunas compactas), no celular e no desktop — nome
 * da etapa uma vez só, dentro do número ("13 pedidos", não "PEDIDOS
 * CRIADOS" em cima de "13" em cima de "pedidos criados" de novo embaixo).
 */
function FunilEmEtapas({ medidas }: Readonly<{ medidas: EtapaMedida[] }>) {
  return (
    <div className="flex items-stretch gap-1">
      {medidas.map((etapa, indice) => (
        <div key={etapa.chave} className="flex flex-1 items-stretch gap-1">
          {indice > 0 ? (
            <ChevronRight
              className="my-auto size-3.5 shrink-0 text-zinc-600"
              aria-hidden="true"
            />
          ) : null}
          <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-zinc-950/60 px-1.5 py-2 text-center">
            <p className="truncate text-2xl font-black tabular-nums text-white">
              {formatarInteiro(etapa.valor)}
            </p>
            <p className="truncate text-[11px] text-zinc-400">
              {etapa.unidadeCurta}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Funil({
  funil,
  onNavigate,
}: Readonly<{
  funil: FunilDoCrm;
  onNavigate: (view: View) => void;
}>) {
  const medidas: EtapaMedida[] = ETAPAS_MEDIDAS.flatMap((etapa) => {
    const valor = funil[etapa.chave];
    return valor == null ? [] : [{ ...etapa, valor }];
  });
  const nota = notaDeEtapasNaoMedidas(funil);
  const monotonico = funilEhMonotonico(medidas.map((etapa) => etapa.valor));

  return (
    <CartaoDoCrm
      id="crm-funil"
      titulo="Funil do app"
      descricao="Do carrinho ao pagamento — só o que já é medido hoje."
    >
      <div className="space-y-4">
        <DestaqueDeConversaoEmVenda
          criados={funil.pedidosCriados}
          pagos={funil.pedidosPagos}
          onNavigate={onNavigate}
        />

        {medidas.length === 0 ? (
          <EstadoVazioDoCrm titulo="Ainda não há dados do funil do app" />
        ) : monotonico ? (
          <FunilProporcional medidas={medidas} />
        ) : (
          <FunilEmEtapas medidas={medidas} />
        )}

        {nota ? (
          <p className="text-[11px] leading-relaxed text-zinc-400">{nota}</p>
        ) : null}
      </div>
    </CartaoDoCrm>
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
  useEffect(() => {
    setAgora(Date.now());
  }, [etapas]);

  return (
    <CartaoDoCrm
      id="crm-pipeline"
      titulo="Pedidos em aberto agora"
      descricao="Não depende do período escolhido no topo — é a fila neste instante."
    >
      <div className="space-y-3">
        {ordenadas.length === 0 ? (
          <EstadoVazioDoCrm
            titulo="Nenhum pedido em aberto"
            texto="A fila está em dia: nenhum pedido esperando separação, pagamento ou envio."
          />
        ) : (
          <ul className="space-y-1.5">
            {ordenadas.map((etapa) => {
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
                      "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
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
                      <span className="block truncate text-xs font-bold text-white">
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
                    <span className="min-w-8 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-center text-[11px] font-black tabular-nums text-zinc-200">
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
        {ordenadas.length > 0 ? (
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Pedidos entregues ou cancelados não aparecem aqui — já saíram da
            fila.
          </p>
        ) : null}
      </div>
    </CartaoDoCrm>
  );
}

/** Aba "Funil e pedidos": do olhar à compra paga, e onde os pedidos param. */
export function FunilEPedidosDoCrm({
  visao,
  carregando,
  onNavigate,
}: Readonly<{
  visao: VisaoDoCrm | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
}>) {
  if (carregando && !visao) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
        <div className="premium-shimmer h-72 rounded-2xl" />
        <div className="premium-shimmer h-72 rounded-2xl" />
      </div>
    );
  }
  if (!visao) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <Funil funil={visao.funil} onNavigate={onNavigate} />
      <Pipeline etapas={visao.pipeline} onNavigate={onNavigate} />
    </div>
  );
}
