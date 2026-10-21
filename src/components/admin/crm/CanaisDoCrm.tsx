import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { ExplicacaoDoRelatorio } from "@/components/admin/crm/ExplicacaoDoRelatorio";
import {
  CartaoDoCrm,
  EstadoVazioDoCrm,
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
  Wallet,
} from "lucide-react";
import { useState } from "react";

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
 *
 * Valores REAIS de `forma` (ver `rotuloDaFormaDePagamento` em
 * `src/lib/crm.ts`): `pix`, `credito`, `debito`, `dinheiro`, `cartao` ou
 * `outro` — nunca `cash`/`card`/`online` (mantidos abaixo só como
 * sinônimos defensivos). `cartao` é o cartão presencial genérico da
 * maquininha, sem saber se foi crédito ou débito — cor PRÓPRIA (teal),
 * distinta de `credito` (índigo) e `debito` (ciano): são 3 "tipos de
 * cartão" diferentes na mesma lista.
 */
function estiloDaForma(forma: string): { cor: string; icone: LucideIcon } {
  switch (forma) {
    case "pix":
      return { cor: "bg-emerald-400", icone: QrCode };
    case "dinheiro":
    case "cash": // sinônimo defensivo — nunca sai de fin__forma_do_pedido
      return { cor: "bg-amber-400", icone: Banknote };
    case "credito":
      return { cor: "bg-indigo-400", icone: CreditCard };
    case "debito":
      return { cor: "bg-cyan-400", icone: CreditCard };
    case "cartao":
    case "card": // sinônimo defensivo — idem
      return { cor: "bg-teal-400", icone: CreditCard };
    case "online": // sinônimo defensivo — idem (vira pix/credito/debito)
      return { cor: "bg-fuchsia-400", icone: Globe };
    // "outro" (valor real) e qualquer forma não reconhecida caem no mesmo
    // neutro — ícone e cor de "não sei classificar", nunca inventados.
    default:
      return { cor: "bg-zinc-400", icone: Wallet };
  }
}

function BlocoDeCanal({
  canal,
  totalPedidos,
  ticketGeral,
}: Readonly<{
  canal: CanalDoCrm;
  totalPedidos: number;
  ticketGeral: number | null;
}>) {
  const estilo = estiloDoCanal(canal.canal as "online" | "presencial");
  const zerado = canal.receita <= 0;
  const fatiaPedidos = percentualDoTotal(canal.pedidos, totalPedidos, 0);
  const diffTicket =
    !zerado && ticketGeral != null && ticketGeral > 0
      ? Math.round(((canal.ticketMedio - ticketGeral) / ticketGeral) * 100)
      : null;
  return (
    <li
      aria-label={`Detalhes ${rotuloDoCanal(canal.canal)}`}
      className="min-h-[132px] min-w-0 space-y-2 rounded-2xl border border-admin-border bg-admin-surface p-3"
    >
      <h3 className="flex items-center gap-1 text-xs font-bold text-admin-text-2">
        <estilo.icone
          className={cn("size-4 shrink-0", estilo.cor)}
          aria-hidden="true"
        />
        {rotuloDoCanal(canal.canal)}
      </h3>
      {zerado ? (
        <p className="text-xs text-zinc-400">
          Nenhuma venda{" "}
          {canal.canal === "online" ? "pelo app" : "pela loja física"} neste
          período.
        </p>
      ) : (
        <>
          <dl className="space-y-1 text-[11px]">
            <div className="flex flex-wrap justify-between gap-x-1">
              <dt className="text-admin-text-soft">Pedidos</dt>
              <dd className="font-bold tabular-nums text-admin-text">
                {formatarInteiro(canal.pedidos)}{" "}
                {fatiaPedidos != null && (
                  <span className="text-zinc-400">
                    ({formatarPercentual(fatiaPedidos, 0)})
                  </span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-1">
              <dt className="text-admin-text-soft">Valor médio</dt>
              <dd className="font-bold tabular-nums text-admin-text">
                {formatarMoeda(canal.ticketMedio)}
              </dd>
            </div>
          </dl>
          {diffTicket != null && diffTicket !== 0 && (
            <p className="border-t border-admin-border pt-2 text-[11px] text-admin-text-soft">
              <strong
                className={
                  diffTicket > 0 ? "text-emerald-300" : "text-amber-300"
                }
              >
                {diffTicket > 0
                  ? `${diffTicket}% acima`
                  : `${Math.abs(diffTicket)}% abaixo`}
              </strong>
              <br />
              do valor médio geral
            </p>
          )}
        </>
      )}
    </li>
  );
}

function CartaoDeFormas({
  formas,
  carregando,
}: Readonly<{
  formas: readonly FormaDePagamentoDoCrm[];
  carregando: boolean;
}>) {
  const [expandido, setExpandido] = useState(false);
  const total = formas.reduce((soma, f) => soma + f.receita, 0);
  return (
    <CartaoDoCrm
      id="crm-formas"
      titulo="Formas de pagamento"
      descricao={fraseLeituraDasFormas(formas)}
      className="min-h-[282px]"
    >
      {carregando ? (
        <div
          aria-hidden="true"
          className="premium-shimmer h-[156px] rounded-xl"
        />
      ) : formas.length === 0 ? (
        <EstadoVazioDoCrm
          className="min-h-[156px]"
          titulo="Sem pagamentos registrados"
          texto="Nenhuma venda paga neste período usou uma forma de pagamento."
        />
      ) : (
        <ul className="space-y-2">
          {(expandido ? formas : formas.slice(0, 3)).map((f) => {
            const estilo = estiloDaForma(f.forma);
            const fatia = percentualDoTotal(f.receita, total);
            const ticket = ticketPorForma(f.receita, f.pedidos);
            return (
              <li key={f.forma} className="min-h-[52px] space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 text-[13px] font-bold text-admin-text-2">
                    <estilo.icone
                      className="size-4 shrink-0 text-zinc-400"
                      aria-hidden="true"
                    />
                    {rotuloDaFormaDePagamento(f.forma)}
                  </span>
                  <span className="text-right text-[13px] font-extrabold tabular-nums text-admin-text">
                    {formatarMoeda(f.receita)}
                  </span>
                </div>
                <p className="text-[11px] text-admin-text-soft">
                  <span className="sr-only">
                    {formatarPercentual(fatia, 0)} ·{" "}
                  </span>
                  {formatarInteiro(f.pedidos)}{" "}
                  {f.pedidos === 1 ? "pedido" : "pedidos"}{" "}
                  {ticket != null && (
                    <span className="text-zinc-400">
                      · {formatarMoeda(ticket)} por venda
                    </span>
                  )}
                </p>
                <div
                  className="h-[5px] overflow-hidden rounded-full bg-admin-raised"
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
      {formas.length > 3 && (
        <button
          type="button"
          aria-expanded={expandido}
          onClick={() => setExpandido(!expandido)}
          className="mt-2 min-h-11 w-full rounded-xl bg-admin-raised text-xs font-bold text-admin-text"
        >
          {expandido ? "Recolher" : "Ver todas as formas"}
        </button>
      )}
    </CartaoDoCrm>
  );
}

export function CanaisDoCrm({
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
  const { online, presencial } = garantirAppELoja(visao?.canais ?? []);
  const totalReceita = online.receita + presencial.receita;
  const totalPedidos = online.pedidos + presencial.pedidos;
  const ticketGeral = totalPedidos > 0 ? totalReceita / totalPedidos : null;
  const esqueleto = carregando && !visao;
  const falha = !esqueleto && !visao && (!!erro || offline);
  const totalFormas =
    visao?.formas.reduce((soma, f) => soma + f.receita, 0) ?? 0;
  return (
    <div className="space-y-4">
      <MetricasDoPainel
        titulo="App × loja física"
        legendasDoResumo={["App (online)", "Loja física"]}
        loading={esqueleto}
        cards={[online, presencial].map((c) => ({
          label: rotuloDoCanal(c.canal),
          value: visao ? formatarMoeda(c.receita) : "—",
          compactValue: visao ? formatarMoedaCompacta(c.receita) : "—",
          icon: estiloDoCanal(c.canal as "online" | "presencial").icone,
          content:
            visao && totalReceita > 0 ? (
              <span className="text-xs font-bold text-admin-text-soft">
                {formatarPercentual(
                  percentualDoTotal(c.receita, totalReceita),
                  0,
                )}
              </span>
            ) : null,
        }))}
        nota={
          falha
            ? "Os números não carregaram"
            : offline
              ? "Sem internet · números da última busca"
              : fraseLeituraDosCanais(online, presencial)
        }
        relatorio={{
          rodape: (
            <span className="flex flex-wrap gap-x-3">
              <span>
                Total{" "}
                <strong className="text-admin-text">
                  {formatarMoeda(visao?.kpis.receita)}
                </strong>
              </span>
              <span>
                Pedidos{" "}
                <strong className="text-admin-text">
                  {formatarInteiro(visao?.kpis.pedidos)}
                </strong>
              </span>
            </span>
          ),
          erro: falha,
          aoTentar,
          tom: falha ? "erro" : offline ? "atencao" : undefined,
          ajuda: (
            <ExplicacaoDoRelatorio titulo="App × loja física">
              De onde veio o dinheiro das vendas pagas neste período. Total e
              pedidos são os mesmos da Visão.
            </ExplicacaoDoRelatorio>
          ),
          barra: (
            <div
              className="absolute bottom-1 left-3 right-3 flex h-[5px] gap-px overflow-hidden rounded-full bg-admin-raised"
              aria-hidden="true"
            >
              {[online, presencial]
                .filter((c) => c.receita > 0)
                .map((c) => (
                  <div
                    key={c.canal}
                    className={
                      estiloDoCanal(c.canal as "online" | "presencial").barra
                    }
                    style={{
                      width: `${percentualDoTotal(c.receita, totalReceita) ?? 0}%`,
                    }}
                  />
                ))}
            </div>
          ),
        }}
      />
      <section aria-label="Cada canal">
        <h2 className="mb-2 flex h-7 items-center gap-2 text-[11px] font-extrabold tracking-[0.12em] text-admin-text-soft">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-admin-gold"
          />
          CADA CANAL
        </h2>
        {esqueleto ? (
          <div
            aria-hidden="true"
            className="premium-shimmer h-[132px] rounded-2xl"
          />
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {[online, presencial].map((c) => (
              <BlocoDeCanal
                key={c.canal}
                canal={c}
                totalPedidos={totalPedidos}
                ticketGeral={ticketGeral}
              />
            ))}
          </ul>
        )}
      </section>
      {visao && totalReceita <= 0 && totalFormas <= 0 && (
        <EstadoVazioDoCrm
          titulo="Nenhuma venda paga neste período"
          texto="Troque o período no topo ou registre uma venda do balcão."
          acao={
            <button
              type="button"
              onClick={() => onNavigate("admin-pdv")}
              className="min-h-11 rounded-xl bg-admin-gold-fill px-4 text-xs font-bold text-admin-gold-ink"
            >
              Vender no balcão
            </button>
          }
        />
      )}
      <CartaoDeFormas formas={visao?.formas ?? []} carregando={esqueleto} />
    </div>
  );
}
