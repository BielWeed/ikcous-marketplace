import { EstadoComPonto } from "@/components/admin/primitivos/EstadoComPonto";
import { formatarInteiro, formatarMoeda, variacaoPercentual } from "@/lib/crm";
import type { PainelInicio } from "@/types/painel";
import { ChevronRight, Package, Smartphone, Store } from "lucide-react";
import {
  ACAO_PRINCIPAL_INICIO,
  ROTULO_INICIO,
  VALOR_INICIO,
  VariacaoDoInicio,
} from "./visualDoInicio";

function DivisaoAppBalcao({
  online,
  presencial,
}: Readonly<{ online: number | null; presencial: number | null }>) {
  if (online == null && presencial == null) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 border-t border-admin-border pt-4 text-sm">
      <div className="min-w-0">
        <dt className="flex items-center gap-1.5 text-zinc-400">
          <Smartphone className="size-4" aria-hidden="true" />
          App
        </dt>
        <dd className={`mt-1 text-base ${VALOR_INICIO}`}>
          {formatarMoeda(online)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="flex items-center gap-1.5 text-zinc-400">
          <Store className="size-4" aria-hidden="true" />
          Balcão
        </dt>
        <dd className={`mt-1 text-base ${VALOR_INICIO}`}>
          {formatarMoeda(presencial)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * O destaque do dia: quanto entrou hoje, de onde veio, contra a semana
 * passada e — havendo pedidos esperando — o único botão cheio do Início. A
 * data do dia mora no cabeçalho (acompanha o relógio lá).
 */
export function HojeNaLoja({
  hoje,
  carregando,
  paraPreparar = null,
  onPreparar,
}: Readonly<{
  hoje: PainelInicio["hoje"] | null;
  carregando: boolean;
  /** Pedidos esperando para preparar; só aparece a ação quando for > 0. */
  paraPreparar?: number | null;
  onPreparar?: () => void;
}>) {
  const pedidos = hoje?.pedidos ?? null;
  const temPedidosParaPreparar = (paraPreparar ?? 0) > 0 && !!onPreparar;
  return (
    <section
      aria-labelledby="inicio-hoje-titulo"
      aria-busy={carregando && !hoje}
      className="min-w-0 rounded-[26px] border border-admin-border bg-gradient-to-br from-admin-raised to-admin-surface p-5"
    >
      <h2 id="inicio-hoje-titulo" className={ROTULO_INICIO}>
        Vendas pagas hoje
      </h2>

      {carregando && !hoje ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          <p className="text-4xl font-bold text-white">—</p>
          <div className="premium-shimmer h-10 w-2/3 rounded-xl" />
          <div className="premium-shimmer h-4 w-1/2 rounded-md" />
          <div className="premium-shimmer h-2.5 w-full rounded-full" />
        </div>
      ) : (
        <div className="mt-2 space-y-4">
          <div className="space-y-3">
            <p
              className={`text-[clamp(1.875rem,9.5vw,3rem)] leading-none ${VALOR_INICIO}`}
            >
              {formatarMoeda(hoje?.receita)}
            </p>
            <VariacaoDoInicio
              pct={variacaoPercentual(
                hoje?.receita,
                hoje?.receitaSemanaPassada,
              )}
              referencia="que no mesmo dia da semana passada, até esta hora"
            >
              <span className="text-sm text-zinc-400">
                <strong className="font-bold tabular-nums text-white">
                  {formatarInteiro(pedidos)}
                </strong>{" "}
                {pedidos === 1 ? "venda" : "vendas"}
              </span>
            </VariacaoDoInicio>
          </div>
          <DivisaoAppBalcao
            online={hoje?.online ?? null}
            presencial={hoje?.presencial ?? null}
          />
          {temPedidosParaPreparar ? (
            <div className="space-y-3">
              <p className="text-sm">
                <EstadoComPonto
                  tom="atencao"
                  texto={`${formatarInteiro(paraPreparar)} ${paraPreparar === 1 ? "pedido esperando" : "pedidos esperando"} para preparar`}
                />
              </p>
              <button
                type="button"
                onClick={onPreparar}
                className={ACAO_PRINCIPAL_INICIO}
              >
                <Package className="size-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-center">
                  Preparar pedidos
                </span>
                <ChevronRight className="size-5 shrink-0" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
