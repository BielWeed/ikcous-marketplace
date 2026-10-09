import type { DashboardStats } from "@/hooks/useAnalytics";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import { type ChaveDoPasso, passosDaLojaPronta } from "@/lib/loja-pronta";
import type { View } from "@/types";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  MapPin,
  Package,
  RefreshCw,
  Wallet,
} from "lucide-react";

/**
 * Bloco novo do Dashboard: "quantos produtos estão acabando" +
 * "sua loja está pronta para vender?" (checklist de 3 itens).
 *
 * Componente PURO (mesma escolha de StatusPagamentoPix.tsx): recebe tudo por
 * props, não lê `import.meta.env`, não chama hook de dados. É assim que os
 * estados de carregamento e "não sei" dão para exercitar por teste sem stub
 * de Supabase nem de ambiente. Quem lê os dados (useAnalytics, useStore) e
 * calcula essas props é o AdminDashboardView.
 *
 * "Não sei" nunca é zero: o card de estoque só mostra um número quando
 * `stats.inventoryAlerts` é, de fato, um `number` finito — senão ele diz em
 * texto que não conseguiu conferir e oferece tentar de novo.
 */

interface ProdutoMinimo {
  readonly isActive: boolean;
}

interface LojaProntaEEstoqueBaixoProps {
  /** `stats` de `useAnalytics()`. `null`/ausente = "não sei" (nunca 0). */
  readonly stats: Pick<DashboardStats, "inventoryAlerts"> | null;
  /** `config.originCep` da loja (StoreContext). */
  readonly originCep: string | undefined;
  /** Flag de pagamento online do build (mesma fonte de AdminSettingsView). */
  readonly ligado: boolean;
  /** Chave pública do Mercado Pago presente no deploy. */
  readonly chaveOk: boolean;
  /** `config.formasPagamentoEntrega`: o que a loja aceita receber na entrega. */
  readonly formasNaEntrega: readonly FormaDePagamentoNaEntrega[];
  /** Catálogo da loja — só o campo que este bloco precisa. */
  readonly produtos: readonly ProdutoMinimo[];
  /** A config da loja (CEP, flags) ainda não terminou de carregar. */
  readonly configCarregando: boolean;
  /** A lista de produtos ainda não terminou de carregar. */
  readonly produtosCarregando: boolean;
  /**
   * A busca de `stats` (RPC de analytics) ainda está em andamento — ainda
   * não é falha, é "não sei ainda". Sem isso, o card de estoque confundia
   * "ainda estou buscando" com "busquei e não consegui": em toda abertura do
   * Dashboard sem cache, `stats` nasce `null` e a busca só começa depois de
   * um atraso proposital, então o lojista lia o alarme de falha antes de a
   * busca sequer ter começado. Número em mãos sempre ganha do carregando.
   */
  readonly estoqueCarregando?: boolean;
  readonly onNavigate: (view: View) => void;
  /** Tenta buscar `stats` de novo (dashboard em estado "não sei"). */
  readonly onTentarDeNovo: () => void;
}

/** Ícone de cada passo — a função pura não conhece React. */
const ICONE_DO_PASSO: Record<ChaveDoPasso, typeof Wallet> = {
  recebe: Wallet,
  cep: MapPin,
  produto: Package,
};

export function LojaProntaEEstoqueBaixo({
  stats,
  originCep,
  ligado,
  chaveOk,
  formasNaEntrega,
  produtos,
  configCarregando,
  produtosCarregando,
  estoqueCarregando = false,
  onNavigate,
  onTentarDeNovo,
}: LojaProntaEEstoqueBaixoProps) {
  // `typeof … === "number"` + `Number.isFinite`, nunca `??`/`||`: "não sei"
  // (stats nulo, ou inventoryAlerts que não veio como número) tem de virar
  // texto explícito, nunca o número 0.
  const numeroDeAlertasValido =
    typeof stats?.inventoryAlerts === "number" &&
    Number.isFinite(stats.inventoryAlerts);

  // Número em mãos ganha do carregando: se a busca terminou com um número
  // válido, mostra o número mesmo que `estoqueCarregando` ainda esteja true
  // (ex.: um refresh em segundo plano com o número anterior em cache).
  const estoqueEstaCarregando = estoqueCarregando && !numeroDeAlertasValido;

  const itens = passosDaLojaPronta({
    originCep,
    pixOk: ligado && chaveOk,
    formasNaEntrega,
    produtos,
    configCarregando,
    produtosCarregando,
  });

  const lojaPronta = itens.every((item) => item.estado === "feito");

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {/* Card: produtos com estoque acabando */}
      {numeroDeAlertasValido ? (
        <button
          type="button"
          onClick={() => onNavigate("admin-notifications")}
          className="flex items-center gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-5 text-left transition-colors hover:bg-white/[0.03]"
        >
          <AlertTriangle className="size-6 shrink-0 text-amber-400" />
          <span className="min-w-0">
            <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">
              Estoque baixo
            </span>
            <span className="block text-lg font-bold text-white">
              Estoque baixo: {stats!.inventoryAlerts}{" "}
              {stats!.inventoryAlerts === 1 ? "produto" : "produtos"}
            </span>
          </span>
        </button>
      ) : estoqueEstaCarregando ? (
        <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-5">
          <CircleDashed className="size-6 shrink-0 animate-spin text-zinc-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">
              Estoque baixo
            </span>
            <span className="block text-xs text-zinc-500">
              Conferindo estoque…
            </span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-5">
          <AlertTriangle className="size-6 shrink-0 text-zinc-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">
              Estoque baixo
            </span>
            <span className="block text-xs text-zinc-400">
              Não foi possível conferir o estoque agora.
            </span>
          </span>
          <button
            type="button"
            onClick={onTentarDeNovo}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-300 transition-colors hover:bg-white/5"
          >
            <RefreshCw className="size-3.5" />
            Tentar de novo
          </button>
        </div>
      )}

      {/* Checklist: a loja está pronta para vender? */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-5">
        <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-zinc-400">
          Sua loja está pronta para vender?
        </p>
        <ul className="space-y-2.5">
          {itens.map((item) => {
            const Icone = ICONE_DO_PASSO[item.chave];
            return (
              <li key={item.chave} className="flex items-center gap-3">
                {item.estado === "carregando" && (
                  <>
                    <CircleDashed className="size-4 shrink-0 animate-spin text-zinc-500" />
                    <span className="text-xs text-zinc-500">
                      Conferindo {item.rotulo}…
                    </span>
                  </>
                )}
                {item.estado === "feito" && (
                  <>
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                    <span className="text-xs text-zinc-300">
                      {item.rotuloFeito}
                    </span>
                  </>
                )}
                {item.estado === "pendente" && (
                  <button
                    type="button"
                    onClick={() => onNavigate(item.destino)}
                    className="flex items-center gap-3 text-left transition-colors hover:text-white"
                  >
                    <Icone className="size-4 shrink-0 text-amber-400" />
                    <span className="text-xs font-bold text-amber-300 underline underline-offset-2">
                      {item.rotuloPendente}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {lojaPronta && (
          <p className="mt-3 border-t border-white/5 pt-3 text-xs font-bold text-emerald-400">
            Sua loja está pronta para vender.
          </p>
        )}
      </div>
    </div>
  );
}
