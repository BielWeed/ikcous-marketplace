import type { DashboardStats } from "@/hooks/useAnalytics";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import {
  type ChaveDosSeisPassos,
  type ConfigDosSeisPassos,
  contagemDosPassos,
  entradaDosSeisPassos,
  estadoDaEntrega,
  proximoPasso,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import type { View } from "@/types";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  MapPin,
  MessageCircle,
  Package,
  RefreshCw,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { useId, useState } from "react";

/**
 * Bloco do Início: "quantos produtos estão acabando" + "sua loja está pronta
 * para vender?" — o cartão GUIADO dos seis passos (E3 do painel simples):
 * "4 de 6 prontos", UM botão grande "Próximo passo: …" que leva ao destino do
 * primeiro passo pendente e a lista dos seis recolhida atrás de um botão
 * (`aria-expanded`). Com 6/6 o cartão vira só a linha "Loja pronta para
 * vender". O horário de atendimento NÃO conta.
 *
 * Componente PURO (mesma escolha de StatusPagamentoPix.tsx): recebe tudo por
 * props, não lê `import.meta.env`, não chama hook de dados. É assim que os
 * estados de carregamento e "não sei" dão para exercitar por teste sem stub
 * de Supabase nem de ambiente. Quem lê os dados (painel_inicio, useStore) e
 * calcula essas props é o AdminDashboardView.
 *
 * "Não sei" nunca é zero: o card de estoque só mostra um número quando
 * `stats.inventoryAlerts` é, de fato, um `number` finito — senão ele diz em
 * texto que não conseguiu conferir e oferece tentar de novo. O mesmo vale para
 * a loja pronta: enquanto algum passo ainda carrega, o cartão diz "Conferindo
 * sua loja…" — nem contagem, nem "Próximo passo" (um passo anterior que ainda
 * carrega poderia virar pendente e mudar a ordem), nem "pronta".
 */

interface ProdutoMinimo {
  readonly isActive: boolean;
}

interface LojaProntaEEstoqueBaixoProps {
  /** `stats` do painel (estoque baixo). `null`/ausente = "não sei" (nunca 0). */
  readonly stats: Pick<DashboardStats, "inventoryAlerts"> | null;
  /** Só o que os seis passos leem da config da loja (StoreContext). */
  readonly config: ConfigDosSeisPassos;
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
   * Início sem cache, `stats` nasce `null` e a busca só começa depois de
   * um atraso proposital, então o lojista lia o alarme de falha antes de a
   * busca sequer ter começado. Número em mãos sempre ganha do carregando.
   */
  readonly estoqueCarregando?: boolean;
  readonly onNavigate: (view: View) => void;
  /** Tenta buscar `stats` de novo (Início em estado "não sei"). */
  readonly onTentarDeNovo: () => void;
}

/** Ícone de cada passo — a função pura não conhece React. */
const ICONE_DO_PASSO: Record<ChaveDosSeisPassos, typeof Wallet> = {
  marca: Store,
  endereco: MapPin,
  whatsapp: MessageCircle,
  recebe: Wallet,
  entrega: Truck,
  produto: Package,
};

export function LojaProntaEEstoqueBaixo({
  stats,
  config,
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
  const idDaLista = useId();
  const [listaAberta, setListaAberta] = useState(false);

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

  const passos = seisPassosDaLojaPronta(
    entradaDosSeisPassos(config, {
      pixOk: ligado && chaveOk,
      formasNaEntrega,
      produtos,
      configCarregando,
      produtosCarregando,
      entrega: estadoDaEntrega(config, configCarregando),
    }),
  );
  const { feitos, total } = contagemDosPassos(passos);
  const proximo = proximoPasso(passos);
  const conferindo = passos.some((passo) => passo.estado === "carregando");
  const lojaPronta = feitos === total;

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {/* Card: produtos com estoque acabando */}
      {numeroDeAlertasValido ? (
        <button
          type="button"
          onClick={() => onNavigate("admin-notifications")}
          className="flex min-h-11 items-center gap-4 rounded-2xl border border-white/5 bg-zinc-900/40 p-5 text-left transition-colors hover:bg-white/[0.03]"
        >
          <AlertTriangle className="size-6 shrink-0 text-amber-400" />
          <span className="min-w-0">
            <span className="block text-[11px] font-black uppercase tracking-widest text-zinc-400">
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
            <span className="block text-[11px] font-black uppercase tracking-widest text-zinc-400">
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
            <span className="block text-[11px] font-black uppercase tracking-widest text-zinc-400">
              Estoque baixo
            </span>
            <span className="block text-xs text-zinc-400">
              Não foi possível conferir o estoque agora.
            </span>
          </span>
          <button
            type="button"
            onClick={onTentarDeNovo}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-[11px] font-black uppercase tracking-wider text-zinc-300 transition-colors hover:bg-white/5"
          >
            <RefreshCw className="size-3.5" />
            Tentar de novo
          </button>
        </div>
      )}

      {/* Cartão guiado: a loja está pronta para vender? */}
      <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-5">
        {lojaPronta ? (
          <p className="flex min-h-11 items-center gap-3 text-sm font-bold text-emerald-400">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            Loja pronta para vender
          </p>
        ) : (
          <>
            <p className="mb-1 text-[11px] font-black uppercase tracking-widest text-zinc-400">
              Sua loja está pronta para vender?
            </p>
            <p className="text-lg font-bold text-white">
              {conferindo
                ? "Conferindo sua loja…"
                : `${feitos} de ${total} prontos`}
            </p>

            {proximo && !conferindo && (
              <button
                type="button"
                onClick={() => onNavigate(proximo.destino)}
                className="mt-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-admin-gold px-4 py-2 text-left text-sm font-black text-black transition-colors hover:bg-admin-gold/90"
              >
                <span className="min-w-0">
                  Próximo passo: {proximo.rotuloPendente}
                </span>
                <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              aria-expanded={listaAberta}
              aria-controls={listaAberta ? idDaLista : undefined}
              onClick={() => setListaAberta((aberta) => !aberta)}
              className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 text-left text-xs font-bold text-zinc-300 transition-colors hover:text-white"
            >
              {listaAberta ? "Esconder os seis passos" : "Ver os seis passos"}
              <ChevronDown
                className={`size-4 shrink-0 transition-transform ${
                  listaAberta ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {listaAberta && (
              <ul id={idDaLista} className="mt-1 space-y-1">
                {passos.map((passo) => {
                  const Icone = ICONE_DO_PASSO[passo.chave];
                  return (
                    <li
                      key={passo.chave}
                      className="flex min-h-11 items-center"
                    >
                      {passo.estado === "carregando" && (
                        <span className="flex items-center gap-3">
                          <CircleDashed className="size-4 shrink-0 animate-spin text-zinc-500" />
                          <span className="text-xs text-zinc-500">
                            Conferindo {passo.rotulo}…
                          </span>
                        </span>
                      )}
                      {passo.estado === "feito" && (
                        <span className="flex items-center gap-3">
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                          <span className="text-xs text-zinc-300">
                            {passo.rotuloFeito}
                          </span>
                        </span>
                      )}
                      {passo.estado === "pendente" && (
                        <button
                          type="button"
                          onClick={() => onNavigate(passo.destino)}
                          className="flex min-h-11 items-center gap-3 text-left transition-colors hover:text-white"
                        >
                          <Icone className="size-4 shrink-0 text-amber-400" />
                          <span className="text-xs font-bold text-amber-300 underline underline-offset-2">
                            {passo.rotuloPendente}
                          </span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
