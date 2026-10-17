import type { DashboardStats } from "@/hooks/useAnalytics";
import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import {
  type ChaveDosSeisPassos,
  type ConfigDosSeisPassos,
  avisoDaFaixaDeCep,
  contagemDosPassos,
  entradaDosSeisPassos,
  estadoDaEntrega,
  proximoPasso,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import type { View } from "@/types";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  MapPin,
  MessageCircle,
  Package,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  ACAO_PRINCIPAL_INICIO,
  BOTAO_INICIO,
  CARTAO_INICIO,
  FalhaDoInicio,
  LINHA_INICIO,
  SeloDoInicio,
  TituloDoInicio,
  type TomDoInicio,
} from "../inicio/visualDoInicio";

/** Checklist e estoque do Início, sem novas leituras de dados.
 * A prontidão continua nas funções de loja-pronta; a apresentação completa
 * deixa reabrir os seis passos e recolhe a lista ao concluir o cadastro.
 * O modo de boas-vindas reaproveita o mesmo próximo passo e seu destino.
 */

interface ProdutoMinimo {
  readonly isActive: boolean;
}

interface LojaProntaEEstoqueBaixoProps {
  readonly somenteBoasVindas?: boolean;
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
const TOM_DO_PASSO: Record<ChaveDosSeisPassos, TomDoInicio> = {
  marca: "teal",
  endereco: "ceu",
  whatsapp: "verde",
  recebe: "roxo",
  entrega: "laranja",
  produto: "azul",
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
  somenteBoasVindas = false,
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
  useEffect(() => {
    if (lojaPronta) setListaAberta(false);
  }, [lojaPronta]);
  // O texto do aviso amarelo. Desde 15/10/2026 o MESMO aviso também deixa o
  // passo "entrega" pendente (`estadoDaEntrega`), então ele nunca convive com
  // "Loja pronta"; aqui ele só detalha o que o passo pede e leva ao Frete.
  const avisoDaFaixa = configCarregando ? null : avisoDaFaixaDeCep(config);

  if (somenteBoasVindas) {
    if (conferindo || lojaPronta || !proximo) return null;
    const Icone = ICONE_DO_PASSO[proximo.chave];
    return (
      <section
        aria-label="Boas-vindas"
        className={`${CARTAO_INICIO} space-y-4`}
      >
        <h2 className="text-[22px] font-bold text-white">
          Sua loja começa por aqui
        </h2>
        <p className="text-base leading-relaxed text-zinc-400">
          Complete sua loja. Próximo passo: {proximo.rotuloPendente}.
        </p>
        <button
          type="button"
          onClick={() => onNavigate(proximo.destino)}
          className={ACAO_PRINCIPAL_INICIO}
        >
          <Icone className="size-5 shrink-0" aria-hidden="true" />
          {proximo.rotuloPendente}
        </button>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <section aria-labelledby="inicio-checklist-titulo">
        <TituloDoInicio id="inicio-checklist-titulo" icone={Store} tom="teal">
          Sua loja está pronta para vender?
        </TituloDoInicio>
        <div className={`${CARTAO_INICIO} space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">
              {conferindo
                ? "Conferindo sua loja…"
                : `${feitos} de ${total} passos concluídos`}
            </p>
            {lojaPronta ? (
              <CheckCircle2
                className="size-5 shrink-0 text-teal-300"
                aria-label="Seis passos concluídos"
              />
            ) : null}
          </div>
          {lojaPronta ? (
            <p className="text-sm text-zinc-400">Cadastro completo</p>
          ) : null}
          {proximo && !conferindo ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate(proximo.destino)}
                className={BOTAO_INICIO}
              >
                <span className="min-w-0">
                  Próximo passo: {proximo.rotuloPendente}
                </span>
                <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
              </button>
              {proximo.explicacaoPendente ? (
                <p className="text-sm text-zinc-400">
                  {proximo.explicacaoPendente}
                </p>
              ) : null}
            </>
          ) : null}
          {avisoDaFaixa ? (
            <button
              type="button"
              onClick={() => onNavigate("admin-shipping")}
              className={`${LINHA_INICIO} border-t border-white/10`}
            >
              <SeloDoInicio icone={Truck} tom="laranja" />
              <span className="min-w-0 flex-1 text-sm leading-relaxed text-orange-300">
                {avisoDaFaixa}
                <span className="mt-1 block text-zinc-400">
                  Entrega e frete
                </span>
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-zinc-400"
                aria-hidden="true"
              />
            </button>
          ) : null}
          {listaAberta ? (
            <ul
              id={idDaLista}
              className="divide-y divide-white/10 border-t border-white/10"
            >
              {passos.map((passo) => {
                const Icone = ICONE_DO_PASSO[passo.chave];
                return (
                  <li key={passo.chave} className="min-h-11">
                    {passo.estado === "carregando" ? (
                      <span className="flex min-h-11 items-center gap-3 py-3">
                        <CircleDashed
                          className="size-5 shrink-0 animate-spin text-sky-300"
                          aria-hidden="true"
                        />
                        <span className="text-sm text-zinc-400">
                          Conferindo {passo.rotulo}…
                        </span>
                      </span>
                    ) : passo.estado === "feito" ? (
                      <span className="flex min-h-11 items-center gap-3 py-3">
                        <SeloDoInicio
                          icone={Icone}
                          tom={TOM_DO_PASSO[passo.chave]}
                        />
                        <span className="min-w-0 text-sm text-zinc-300">
                          Concluído · {passo.rotuloFeito}
                        </span>
                        <CheckCircle2
                          className="ml-auto size-4 shrink-0 text-teal-300"
                          aria-hidden="true"
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNavigate(passo.destino)}
                        className={LINHA_INICIO}
                      >
                        <SeloDoInicio
                          icone={Icone}
                          tom={TOM_DO_PASSO[passo.chave]}
                        />
                        <span className="min-w-0 flex-1 text-sm font-semibold text-white">
                          {passo.rotuloPendente}
                        </span>
                        <ChevronRight
                          className="size-5 shrink-0 text-zinc-400"
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button
            type="button"
            aria-expanded={listaAberta}
            aria-controls={listaAberta ? idDaLista : undefined}
            onClick={() => setListaAberta((aberta) => !aberta)}
            className={BOTAO_INICIO}
          >
            <ChevronDown
              className={`size-5 shrink-0 ${listaAberta ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
            {listaAberta ? "Esconder os seis passos" : "Ver os seis passos"}
          </button>
        </div>
      </section>
      {numeroDeAlertasValido ? (
        <button
          type="button"
          onClick={() => onNavigate("admin-notifications")}
          className={`${CARTAO_INICIO} ${LINHA_INICIO} !p-3`}
        >
          <SeloDoInicio icone={Package} tom="azul" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-white">
              Estoque baixo: {stats!.inventoryAlerts}{" "}
              {stats!.inventoryAlerts === 1 ? "produto" : "produtos"}
            </span>
            <span className="mt-1 block text-sm text-zinc-400">
              Abrir Notificações
            </span>
          </span>
          <ChevronRight
            className="size-5 shrink-0 text-zinc-400"
            aria-hidden="true"
          />
        </button>
      ) : estoqueEstaCarregando ? (
        <div className={`${CARTAO_INICIO} flex items-center gap-3`}>
          <CircleDashed
            className="size-5 shrink-0 animate-spin text-sky-300"
            aria-hidden="true"
          />
          <span className="text-sm text-zinc-400">
            Estoque baixo · Conferindo estoque…
          </span>
        </div>
      ) : (
        <section aria-label="Estoque baixo">
          <FalhaDoInicio onTentarDeNovo={onTentarDeNovo}>
            Não foi possível conferir o estoque agora. A quantidade está
            indisponível.
          </FalhaDoInicio>
        </section>
      )}
    </div>
  );
}
