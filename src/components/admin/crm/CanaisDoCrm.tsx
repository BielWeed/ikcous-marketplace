import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import {
  CartaoDoCrm,
  EstadoVazioDoCrm,
  SUPERFICIE_DO_CRM,
} from "@/components/admin/crm/PecasDoCrm";
import {
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  fraseLeituraDasFormas,
  fraseLeituraDosCanais,
  garantirAppELoja,
  percentualDoTotal,
  rotuloDaFormaDePagamento,
  rotuloDoCanal,
  ticketPorForma,
  variacaoPercentual,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type {
  CanalDoCrm,
  FormaDePagamentoDoCrm,
  VisaoDoCrm,
} from "@/types/crm";
import {
  Banknote,
  CreditCard,
  Globe,
  type LucideIcon,
  QrCode,
  Smartphone,
  Store,
} from "lucide-react";

/** Identidade fixa dos canais — a MESMA do "Hoje" do Início. */
function estiloDoCanal(canal: "online" | "presencial"): {
  cor: string;
  barra: string;
  icone: LucideIcon;
} {
  if (canal === "online") {
    return { cor: "text-sky-300", barra: "bg-sky-400", icone: Smartphone };
  }
  return { cor: "text-violet-300", barra: "bg-violet-400", icone: Store };
}

/**
 * Ícone e cor da BARRA por forma de pagamento. O ícone em si é sempre
 * renderizado em tom neutro (`text-zinc-400`, ver CartaoDeFormas abaixo) —
 * só a barra usa esta cor. Paleta própria, sem repetir sky/violet: essas
 * são a identidade FIXA dos canais (App/Loja física, `estiloDoCanal`
 * acima), e "Cartão de crédito"/"Online" (forma de pagamento, Mercado
 * Pago) usavam sky-400/violet-400 por engano — na mesma tela "Canais", ao
 * lado dos cartões de canal, a cor repetida sugeria (errado) que a forma
 * de pagamento era o canal.
 */
function estiloDaForma(forma: string): { cor: string; icone: LucideIcon } {
  switch (forma) {
    case "pix":
      return { cor: "bg-emerald-400", icone: QrCode };
    case "cash":
      return { cor: "bg-amber-400", icone: Banknote };
    case "online":
      return { cor: "bg-fuchsia-400", icone: Globe };
    case "debito":
      return { cor: "bg-cyan-400", icone: CreditCard };
    case "credito":
    case "card":
      return { cor: "bg-indigo-400", icone: CreditCard };
    default:
      return { cor: "bg-indigo-400", icone: CreditCard };
  }
}

/**
 * Um número do resumo do período: rótulo pequeno, valor grande e — só
 * quando há base — a variação. Compacto de propósito: no celular, o antigo
 * `TileDeKpi` empilhado 3× virava três cartões altos e vazios só para 3
 * números; aqui os 3 dividem uma única superfície, lado a lado, também no
 * desktop (não usa `TileDeKpi`, que é peça de outro agente).
 */
function ItemDoResumo({
  rotulo,
  valor,
  valorCompacto,
  variacao,
}: Readonly<{
  rotulo: string;
  valor: string;
  valorCompacto?: string;
  variacao: number | null;
}>) {
  return (
    <div className="min-w-0 px-2 first:pl-0 last:pr-0 sm:px-4">
      <p className="truncate text-[10px] font-black uppercase tracking-widest text-zinc-400">
        {rotulo}
      </p>
      <p className="truncate text-lg font-black tabular-nums text-white sm:text-xl">
        {valorCompacto && valorCompacto !== valor ? (
          <>
            <span className="sm:hidden">{valorCompacto}</span>
            <span className="hidden sm:inline">{valor}</span>
          </>
        ) : (
          valor
        )}
      </p>
      {variacao != null ? (
        <div className="mt-1">
          <ChipDeVariacao pct={variacao} comparacao="vs. anterior" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Um dos dois canais dentro do cartão "App × loja física": receita, fatia
 * da receita, pedidos, fatia dos pedidos e como o ticket dele se compara ao
 * ticket geral do período. Canal sem venda fica em tom secundário.
 */
function BlocoDeCanal({
  canal,
  totalReceita,
  totalPedidos,
  ticketGeral,
}: Readonly<{
  canal: CanalDoCrm;
  totalReceita: number;
  totalPedidos: number;
  ticketGeral: number | null;
}>) {
  const estilo = estiloDoCanal(canal.canal as "online" | "presencial");
  const zerado = canal.receita <= 0;
  const fatiaReceita = percentualDoTotal(canal.receita, totalReceita);
  const fatiaPedidos = percentualDoTotal(canal.pedidos, totalPedidos, 0);
  const diffTicket =
    !zerado && ticketGeral != null && ticketGeral > 0
      ? Math.round(((canal.ticketMedio - ticketGeral) / ticketGeral) * 100)
      : null;

  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-4",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex items-center gap-2 text-xs font-bold",
            zerado ? "text-zinc-400" : "text-zinc-200",
          )}
        >
          <estilo.icone
            className={cn("size-4", estilo.cor, zerado && "opacity-60")}
            aria-hidden="true"
          />
          {rotuloDoCanal(canal.canal)}
        </span>
        {!zerado && fatiaReceita != null ? (
          <span className="text-[11px] font-bold tabular-nums text-zinc-400">
            {formatarPercentual(fatiaReceita, 0)} da receita
          </span>
        ) : null}
      </div>

      {zerado ? (
        // Contraste AA: a opacidade de "canal secundário" fica só no ícone
        // (gráfico) acima — texto informativo nunca perde opacidade, e usa
        // text-zinc-400 (não mais text-zinc-500, que dentro do opacity-60
        // do cartão inteiro media ~2,2:1, abaixo do mínimo AA).
        <p className="text-xs leading-relaxed text-zinc-400">
          Nenhuma venda{" "}
          {canal.canal === "online" ? "pelo app" : "pela loja física"} neste
          período.
        </p>
      ) : (
        <>
          <p className="text-2xl font-black tracking-tight text-white">
            {formatarMoeda(canal.receita)}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">
                Pedidos
              </dt>
              <dd className="font-bold tabular-nums text-white">
                {formatarInteiro(canal.pedidos)}
                {fatiaPedidos != null ? (
                  <span className="ml-1 font-semibold text-zinc-500">
                    ({formatarPercentual(fatiaPedidos, 0)})
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-zinc-400">
                Ticket médio
              </dt>
              <dd className="font-bold tabular-nums text-white">
                {formatarMoeda(canal.ticketMedio)}
              </dd>
            </div>
          </dl>
          {diffTicket != null && diffTicket !== 0 ? (
            <p className="text-[11px] text-zinc-400">
              Ticket{" "}
              <strong
                className={cn(
                  "font-bold",
                  diffTicket > 0 ? "text-emerald-300" : "text-amber-300",
                )}
              >
                {diffTicket > 0
                  ? `${diffTicket}% acima`
                  : `${Math.abs(diffTicket)}% abaixo`}
              </strong>{" "}
              do ticket geral do período.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Cartão "App × loja física": barra empilhada + os dois canais lado a lado. */
function CartaoDeCanais({
  canais,
}: Readonly<{ canais: readonly CanalDoCrm[] }>) {
  const { online, presencial } = garantirAppELoja(canais);
  const totalReceita = online.receita + presencial.receita;
  const totalPedidos = online.pedidos + presencial.pedidos;
  const ticketGeral = totalPedidos > 0 ? totalReceita / totalPedidos : null;

  return (
    <CartaoDoCrm
      id="crm-canais"
      titulo="App × loja física"
      descricao={fraseLeituraDosCanais(online, presencial)}
    >
      <div className="space-y-4">
        <div
          className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-800/80"
          aria-hidden="true"
        >
          {[online, presencial]
            .filter((c) => c.receita > 0)
            .map((c) => (
              <div
                key={c.canal}
                className={cn(
                  "h-full",
                  estiloDoCanal(c.canal as "online" | "presencial").barra,
                )}
                style={{
                  width: `${percentualDoTotal(c.receita, totalReceita) ?? 0}%`,
                }}
              />
            ))}
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <li>
            <BlocoDeCanal
              canal={online}
              totalReceita={totalReceita}
              totalPedidos={totalPedidos}
              ticketGeral={ticketGeral}
            />
          </li>
          <li>
            <BlocoDeCanal
              canal={presencial}
              totalReceita={totalReceita}
              totalPedidos={totalPedidos}
              ticketGeral={ticketGeral}
            />
          </li>
        </ul>
      </div>
    </CartaoDoCrm>
  );
}

/** Cartão "Formas de pagamento": ícone, receita, fatia, pedidos e ticket. */
function CartaoDeFormas({
  formas,
}: Readonly<{ formas: readonly FormaDePagamentoDoCrm[] }>) {
  const total = formas.reduce((soma, f) => soma + f.receita, 0);

  return (
    <CartaoDoCrm
      id="crm-formas"
      titulo="Formas de pagamento"
      descricao={fraseLeituraDasFormas(formas)}
    >
      {formas.length === 0 ? (
        <EstadoVazioDoCrm
          titulo="Sem pagamentos registrados"
          texto="Nenhuma venda paga neste período usou uma forma de pagamento."
        />
      ) : (
        <ul className="space-y-3">
          {formas.map((f) => {
            const estilo = estiloDaForma(f.forma);
            const fatia = percentualDoTotal(f.receita, total);
            const ticket = ticketPorForma(f.receita, f.pedidos);
            return (
              <li key={f.forma} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <span className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                    <estilo.icone
                      className="size-4 shrink-0 text-zinc-400"
                      aria-hidden="true"
                    />
                    {rotuloDaFormaDePagamento(f.forma)}
                  </span>
                  <span className="text-right text-[11px] tabular-nums text-zinc-400">
                    <strong className="font-bold text-white">
                      {formatarPercentual(fatia, 0)}
                    </strong>{" "}
                    · {formatarMoeda(f.receita)} · {formatarInteiro(f.pedidos)}{" "}
                    {f.pedidos === 1 ? "pedido" : "pedidos"}
                    {ticket != null ? (
                      <span className="text-zinc-500">
                        {" "}
                        · ticket {formatarMoeda(ticket)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/80"
                  aria-hidden="true"
                >
                  <div
                    className={cn("h-full rounded-full", estilo.cor)}
                    style={{
                      width: `${Math.max(fatia ?? 0, f.receita > 0 ? 1 : 0)}%`,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CartaoDoCrm>
  );
}

/**
 * Aba "Canais": um resumo do período, o corte app × loja física (os dois
 * canais sempre presentes, com fatia de receita/pedidos e ticket comparado
 * ao geral) e o mix de formas de pagamento.
 */
export function CanaisDoCrm({
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
      <div className="space-y-4 sm:space-y-6" aria-busy="true">
        <div className="premium-shimmer h-20 rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="premium-shimmer h-72 rounded-2xl" />
          <div className="premium-shimmer h-72 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (!visao) return null;

  const k = visao.kpis;
  const totalCanais = visao.canais.reduce((soma, c) => soma + c.receita, 0);
  const totalFormas = visao.formas.reduce((soma, f) => soma + f.receita, 0);
  // Sem base de comparação (loja nova, período anterior sem dado), o chip
  // "sem base de comparação" repetido nos 3 cards virava ruído — some
  // quando não há variação, em vez de repetir a mesma frase três vezes.
  const variacaoReceita = variacaoPercentual(k.receita, k.receitaAnterior);
  const variacaoPedidos = variacaoPercentual(k.pedidos, k.pedidosAnterior);
  const variacaoTicket = variacaoPercentual(
    k.ticketMedio,
    k.ticketMedioAnterior,
  );

  if (totalCanais <= 0 && totalFormas <= 0) {
    return (
      <EstadoVazioDoCrm
        titulo="Nenhuma venda paga neste período"
        texto="Troque o período no topo ou registre uma venda do balcão."
        acao={
          <button
            type="button"
            onClick={() => onNavigate("admin-pdv")}
            className="min-h-11 rounded-xl bg-admin-gold px-4 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-admin-gold/90"
          >
            Vender no balcão
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <section aria-labelledby="crm-canais-resumo-titulo">
        <h2 id="crm-canais-resumo-titulo" className="sr-only">
          Resumo do período
        </h2>
        <div
          className={cn(
            SUPERFICIE_DO_CRM,
            "grid grid-cols-3 divide-x divide-white/[0.06] p-3 sm:p-4",
          )}
        >
          <ItemDoResumo
            rotulo="Total vendido"
            valor={formatarMoeda(k.receita)}
            valorCompacto={formatarMoedaCompacta(k.receita)}
            variacao={variacaoReceita}
          />
          <ItemDoResumo
            rotulo="Pedidos"
            valor={formatarInteiro(k.pedidos)}
            variacao={variacaoPedidos}
          />
          <ItemDoResumo
            rotulo="Ticket médio"
            valor={formatarMoeda(k.ticketMedio)}
            valorCompacto={formatarMoedaCompacta(k.ticketMedio)}
            variacao={variacaoTicket}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <CartaoDeCanais canais={visao.canais} />
        <CartaoDeFormas formas={visao.formas} />
      </div>
    </div>
  );
}
