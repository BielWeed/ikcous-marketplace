import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import {
  formatarInteiro,
  formatarMoeda,
  formatarPercentual,
  variacaoPercentual,
} from "@/lib/crm";
import type { PainelInicio } from "@/types/painel";
import { Smartphone, Store } from "lucide-react";

const DIA_DE_HOJE = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** Cores de canal — as MESMAS da aba Canais do CRM (identidade fixa). */
const COR_DO_APP = "bg-sky-400";
const COR_DO_BALCAO = "bg-violet-400";

function DivisaoAppBalcao({
  online,
  presencial,
}: Readonly<{ online: number | null; presencial: number | null }>) {
  if (online == null && presencial == null) return null;
  const app = online ?? 0;
  const balcao = presencial ?? 0;
  const total = app + balcao;
  const pctApp = total > 0 ? (app / total) * 100 : 0;
  const pctBalcao = total > 0 ? 100 - pctApp : 0;

  return (
    <div className="space-y-2">
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-800/80"
        aria-hidden="true"
      >
        {total > 0 ? (
          <>
            {app > 0 ? (
              <div
                className={`h-full rounded-full ${COR_DO_APP}`}
                style={{ width: `${pctApp}%` }}
              />
            ) : null}
            {balcao > 0 ? (
              <div
                className={`h-full rounded-full ${COR_DO_BALCAO}`}
                style={{ width: `${pctBalcao}%` }}
              />
            ) : null}
          </>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-zinc-400">
            <span className={`size-2 shrink-0 rounded-full ${COR_DO_APP}`} />
            <Smartphone className="size-3.5" aria-hidden="true" />
            App
          </dt>
          <dd className="mt-0.5 truncate font-bold tabular-nums text-white">
            {formatarMoeda(online)}
            {total > 0 ? (
              <span className="ml-1 font-semibold text-zinc-500">
                {formatarPercentual(pctApp, 0)}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-zinc-400">
            <span className={`size-2 shrink-0 rounded-full ${COR_DO_BALCAO}`} />
            <Store className="size-3.5" aria-hidden="true" />
            Balcão
          </dt>
          <dd className="mt-0.5 truncate font-bold tabular-nums text-white">
            {formatarMoeda(presencial)}
            {total > 0 ? (
              <span className="ml-1 font-semibold text-zinc-500">
                {formatarPercentual(pctBalcao, 0)}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** O "Hoje" do Início: quanto entrou, de onde veio, e contra a semana passada. */
export function HojeNaLoja({
  hoje,
  carregando,
}: Readonly<{ hoje: PainelInicio["hoje"] | null; carregando: boolean }>) {
  const pedidos = hoje?.pedidos ?? null;
  return (
    <section
      aria-labelledby="inicio-hoje-titulo"
      aria-busy={carregando && !hoje}
      className="admin-glass relative h-full overflow-hidden rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <div className="pointer-events-none absolute -left-20 -top-20 size-56 rounded-full bg-emerald-500/[0.05] blur-3xl" />
      <div className="relative flex items-baseline justify-between gap-3">
        <h2
          id="inicio-hoje-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Hoje
        </h2>
        <p className="truncate text-[11px] capitalize text-zinc-500">
          {DIA_DE_HOJE.format(new Date())}
        </p>
      </div>

      {carregando && !hoje ? (
        <div className="relative mt-4 space-y-3" aria-hidden="true">
          <div className="premium-shimmer h-10 w-2/3 rounded-xl" />
          <div className="premium-shimmer h-4 w-1/2 rounded-md" />
          <div className="premium-shimmer h-2.5 w-full rounded-full" />
        </div>
      ) : (
        <div className="relative mt-3 space-y-4">
          <div className="space-y-2">
            <p className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              {formatarMoeda(hoje?.receita)}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ChipDeVariacao
                pct={variacaoPercentual(
                  hoje?.receita,
                  hoje?.receitaSemanaPassada,
                )}
                comparacao="vs. mesmo dia da semana passada"
              />
              <span className="text-xs text-zinc-400">
                <strong className="font-bold tabular-nums text-white">
                  {formatarInteiro(pedidos)}
                </strong>{" "}
                {pedidos === 1 ? "pedido" : "pedidos"}
              </span>
            </div>
          </div>
          <DivisaoAppBalcao
            online={hoje?.online ?? null}
            presencial={hoje?.presencial ?? null}
          />
        </div>
      )}
    </section>
  );
}
