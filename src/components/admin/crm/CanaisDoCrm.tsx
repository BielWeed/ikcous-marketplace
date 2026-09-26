import {
  formatarInteiro,
  formatarMoeda,
  formatarPercentual,
  rotuloDaFormaDePagamento,
  rotuloDoCanal,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { CanalDoCrm, VisaoDoCrm } from "@/types/crm";
import { CreditCard, type LucideIcon, Smartphone, Store } from "lucide-react";

/** Identidade fixa dos canais — a MESMA do "Hoje" do Início. */
function estiloDoCanal(canal: string): { cor: string; icone: LucideIcon } {
  if (canal === "online") return { cor: "bg-sky-400", icone: Smartphone };
  if (canal === "presencial") return { cor: "bg-violet-400", icone: Store };
  return { cor: "bg-zinc-400", icone: CreditCard };
}

/** App primeiro, balcão depois — a ordem não muda com o valor. */
function ordenarCanais(canais: readonly CanalDoCrm[]): CanalDoCrm[] {
  const peso = (canal: string) =>
    canal === "online" ? 0 : canal === "presencial" ? 1 : 2;
  return [...canais].sort((a, b) => peso(a.canal) - peso(b.canal));
}

function Vazio({ onNavigate }: Readonly<{ onNavigate: (view: View) => void }>) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 p-8 text-center">
      <p className="text-sm font-bold text-white">
        Nenhuma venda paga neste período
      </p>
      <p className="text-xs text-zinc-500">
        Troque o período no topo ou registre uma venda do balcão.
      </p>
      <button
        type="button"
        onClick={() => onNavigate("admin-pdv")}
        className="min-h-11 rounded-xl bg-admin-gold px-4 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-admin-gold/90"
      >
        Vender no balcão
      </button>
    </div>
  );
}

/**
 * Aba "Canais": app × loja física (receita, pedidos, ticket e fatia) e o
 * mix de formas de pagamento em barras horizontais com percentual escrito.
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy="true">
        <div className="premium-shimmer h-56 rounded-2xl" />
        <div className="premium-shimmer h-56 rounded-2xl" />
      </div>
    );
  }
  if (!visao) return null;

  const canais = ordenarCanais(visao.canais);
  const totalCanais = canais.reduce((soma, c) => soma + c.receita, 0);
  const formas = visao.formas;
  const totalFormas = formas.reduce((soma, f) => soma + f.receita, 0);

  if (totalCanais <= 0 && totalFormas <= 0) {
    return <Vazio onNavigate={onNavigate} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <section
        aria-labelledby="crm-canais-titulo"
        className="admin-glass space-y-4 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
      >
        <h2
          id="crm-canais-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          App × loja física
        </h2>

        {totalCanais > 0 ? (
          <div
            className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-800/80"
            aria-hidden="true"
          >
            {canais
              .filter((c) => c.receita > 0)
              .map((c) => (
                <div
                  key={c.canal}
                  className={cn(
                    "h-full rounded-full",
                    estiloDoCanal(c.canal).cor,
                  )}
                  style={{ width: `${(c.receita / totalCanais) * 100}%` }}
                />
              ))}
          </div>
        ) : null}

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {canais.map((c) => {
            const estilo = estiloDoCanal(c.canal);
            const fatia = totalCanais > 0 ? (c.receita / totalCanais) * 100 : 0;
            return (
              <li
                key={c.canal}
                className="space-y-3 rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-bold text-zinc-200">
                    <span
                      className={cn("size-2 rounded-full", estilo.cor)}
                      aria-hidden="true"
                    />
                    <estilo.icone
                      className="size-4 text-zinc-400"
                      aria-hidden="true"
                    />
                    {rotuloDoCanal(c.canal)}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums text-zinc-400">
                    {formatarPercentual(fatia, 0)}
                  </span>
                </div>
                <p className="text-2xl font-black tracking-tight text-white">
                  {formatarMoeda(c.receita)}
                </p>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
                      Pedidos
                    </dt>
                    <dd className="font-bold tabular-nums text-white">
                      {formatarInteiro(c.pedidos)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
                      Ticket médio
                    </dt>
                    <dd className="font-bold tabular-nums text-white">
                      {formatarMoeda(c.ticketMedio)}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="crm-formas-titulo"
        className="admin-glass space-y-4 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
      >
        <h2
          id="crm-formas-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Formas de pagamento
        </h2>
        {formas.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Sem pagamentos registrados no período.
          </p>
        ) : (
          <ul className="space-y-3">
            {formas.map((f) => {
              const fatia =
                totalFormas > 0 ? (f.receita / totalFormas) * 100 : 0;
              return (
                <li key={f.forma} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                    <span className="font-bold text-zinc-200">
                      {rotuloDaFormaDePagamento(f.forma)}
                    </span>
                    <span className="tabular-nums text-zinc-400">
                      <strong className="font-bold text-white">
                        {formatarPercentual(fatia)}
                      </strong>{" "}
                      · {formatarMoeda(f.receita)} ·{" "}
                      {formatarInteiro(f.pedidos)}{" "}
                      {f.pedidos === 1 ? "pedido" : "pedidos"}
                    </span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/80"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-admin-gold/80"
                      style={{
                        width: `${Math.max(fatia, f.receita > 0 ? 1 : 0)}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
