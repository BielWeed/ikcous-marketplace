import { instanteDoDia, useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import { formatarInteiro, formatarMoeda, variacaoPercentual } from "@/lib/crm";
import type { PainelInicio } from "@/types/painel";
import { Smartphone, Store } from "lucide-react";
import type { ReactNode } from "react";
import { VALOR_INICIO, VariacaoDoInicio } from "./visualDoInicio";

const DIA_DE_HOJE = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** Cores de canal — as MESMAS da aba Canais do CRM (identidade fixa). */
const COR_DO_APP = "bg-blue-300";
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
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-zinc-400">
            <Smartphone className="size-4 text-blue-300" aria-hidden="true" />
            App
          </dt>
          <dd className={`mt-1 ${VALOR_INICIO}`}>{formatarMoeda(online)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-zinc-400">
            <Store className="size-4 text-violet-300" aria-hidden="true" />
            Balcão
          </dt>
          <dd className={`mt-1 ${VALOR_INICIO}`}>
            {formatarMoeda(presencial)}
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
  acaoPrincipal,
}: Readonly<{
  hoje: PainelInicio["hoje"] | null;
  carregando: boolean;
  acaoPrincipal?: ReactNode;
}>) {
  const pedidos = hoje?.pedidos ?? null;
  // A data acompanha o relógio: o Início fica aberto (ou congelado em segundo
  // plano) de um dia para o outro, e "Hoje" não pode ficar preso em ontem.
  const dia = useDiaDeSaoPaulo();
  return (
    <section
      aria-labelledby="inicio-hoje-titulo"
      aria-busy={carregando && !hoje}
      className="min-w-0 rounded-[22px] border border-white/10 bg-gradient-to-br from-slate-800/90 to-zinc-900/80 p-4"
    >
      <div className="relative flex items-baseline justify-between gap-3">
        <h2
          id="inicio-hoje-titulo"
          className="text-xs font-bold uppercase tracking-widest text-zinc-400"
        >
          Hoje
        </h2>
        <p className="min-w-0 text-right text-xs capitalize text-zinc-400">
          {DIA_DE_HOJE.format(instanteDoDia(dia))}
        </p>
      </div>

      {carregando && !hoje ? (
        <div className="relative mt-4 space-y-3" aria-hidden="true">
          <p className="text-sm text-zinc-300">Vendas pagas hoje</p>
          <p className="text-4xl font-bold text-white">—</p>
          <div className="premium-shimmer h-10 w-2/3 rounded-xl" />
          <div className="premium-shimmer h-4 w-1/2 rounded-md" />
          <div className="premium-shimmer h-2.5 w-full rounded-full" />
        </div>
      ) : (
        <div className="relative mt-3 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-300">
              Vendas pagas hoje
            </p>
            <p
              className={`text-[clamp(1.75rem,8vw,2.5rem)] leading-tight ${VALOR_INICIO}`}
            >
              {formatarMoeda(hoje?.receita)}
            </p>
            <VariacaoDoInicio
              pct={variacaoPercentual(
                hoje?.receita,
                hoje?.receitaSemanaPassada,
              )}
              comparacao="vs. mesmo dia da semana passada, até esta hora"
            >
              <span className="text-sm text-zinc-400">
                <strong className="font-bold tabular-nums text-white">
                  {formatarInteiro(pedidos)}
                </strong>{" "}
                {pedidos === 1 ? "venda" : "vendas"}
              </span>
            </VariacaoDoInicio>
          </div>
          {acaoPrincipal}
          <DivisaoAppBalcao
            online={hoje?.online ?? null}
            presencial={hoje?.presencial ?? null}
          />
        </div>
      )}
    </section>
  );
}
