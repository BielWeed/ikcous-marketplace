import type { ProvedorFrete } from "@/components/admin/settings/TransportadorasCard";
import {
  CabecaDeSecao,
  Linha,
  PontoEstado,
} from "@/components/admin/shipping/primitivas-direcao-d";
import {
  AlertCircle,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { memo } from "react";

/**
 * Seção "Fora da cidade" da tela de Frete — RELEASE 1.5.7 v2 (frete com
 * vários provedores ao mesmo tempo). Até a 1.5.6 esta seção mostrava UM
 * estado ("conectado"/"desconectado") porque só existia UM provedor de
 * cotação por loja. Agora podem estar ligados Melhor Envio, SuperFrete e
 * Frenet ao mesmo tempo — o estado passa a ser POR PROVEDOR (F10, tarefa
 * P: "nunca 'conectado' só por ter chave").
 *
 * Esta tela continua só de LEITURA: quem grava chave, testa e liga/desliga
 * é a seção "Transportadoras" em Ajustes. Aqui o estado chega PRONTO da
 * view, lido pela MESMA edge (`ler_configuracao_frete`).
 */
// "incompleta" (revisão Opus, achado 2 — regressão 1.5.5): tem chave, mas
// falta o que a transportadora exige para cotar de verdade (hoje só a
// SuperFrete, que precisa de e-mail de contato válido na PRÓPRIA
// credencial). NUNCA conta como "ligado" — cotação real é a promessa que
// "ligado" faz, e uma chave incompleta não cota nada.
export type EstadoConexaoProvedor =
  | "ligado"
  | "incompleta"
  | "chave_salva"
  | "sem_chave";

export interface ProvedorNacional {
  readonly provider: ProvedorFrete;
  readonly nome: string;
  readonly estado: EstadoConexaoProvedor;
}

const ROTULO_DO_ESTADO: Readonly<Record<EstadoConexaoProvedor, string>> = {
  ligado: "ligado",
  incompleta: "incompleta",
  chave_salva: "chave salva",
  sem_chave: "sem chave",
};

export const FreteNacionalBloco = memo(function FreteNacionalBloco({
  originCep,
  onOriginCep,
  provedores,
  erroNaLeitura,
  onAbrirAjustes,
  onTentarDeNovo,
  desabilitado,
  resumoDaEstrategiaNacional,
  onAbrirEstrategiasNacionais,
  mostrarCabecalho = true,
}: {
  readonly originCep: string;
  readonly onOriginCep: (cep: string) => void;
  /** Estado de CADA um dos três provedores — sempre os três, na ordem de
   * exibição (Melhor Envio, SuperFrete, Frenet). */
  readonly provedores: readonly ProvedorNacional[];
  /** A leitura da configuração de frete falhou — a tela não sabe e não
   * finge saber (estados honestos são a lei deste repo). */
  readonly erroNaLeitura?: boolean;
  readonly onAbrirAjustes?: () => void;
  readonly onTentarDeNovo?: () => void;
  readonly desabilitado?: boolean;
  /** Texto curto do estado SALVO da estratégia nacional (T4, 23/09/2026) —
   * `resumoDaEstrategiaNacional` de `src/lib/estrategias-de-frete.ts`, ao
   * lado do botão que abre a tela nova. */
  readonly resumoDaEstrategiaNacional?: string;
  /** Abre `admin-shipping-national` — ausente quando a view não recebeu
   * `onNavigate` (mesmo padrão de `onAbrirAjustes`). */
  readonly onAbrirEstrategiasNacionais?: () => void;
  /** `false` quando um `PainelRecolhivel` externo já mostra o título e o
   * estado (tela de Frete unificada, 23/09/2026) — evita cabeçalho em
   * dobro. Default `true` preserva o uso isolado (e os testes). */
  readonly mostrarCabecalho?: boolean;
}) {
  const formatCEP = (val: string) => {
    const clean = val.replace(/\D/g, "");
    if (clean.length <= 5) return clean;
    return `${clean.slice(0, 5)}-${clean.slice(5, 8)}`;
  };

  const algumLigado = provedores.some((p) => p.estado === "ligado");
  const ligados = provedores.filter((p) => p.estado === "ligado");

  return (
    <section
      id="bloco-frete-nacional"
      aria-label="Fora da cidade"
      className="scroll-mt-24"
    >
      {mostrarCabecalho && (
        <CabecaDeSecao
          titulo="Fora da cidade"
          estado={
            erroNaLeitura ? (
              <>
                <PontoEstado tom="neutro" />
                <span>conexão a confirmar</span>
              </>
            ) : algumLigado ? (
              <>
                <PontoEstado tom="positivo" />
                <span>
                  {ligados.length === 1 ? (
                    <>
                      <b className="font-semibold text-zinc-200">ligado</b> ·{" "}
                      {ligados[0].nome}
                    </>
                  ) : (
                    <>
                      <b className="font-semibold text-zinc-200">
                        {ligados.length} provedores
                      </b>{" "}
                      ligados
                    </>
                  )}
                </span>
              </>
            ) : (
              <>
                <PontoEstado tom="atencao" />
                <span className="text-amber-300">desconectado</span>
              </>
            )
          }
        />
      )}

      <Linha
        nome="Cotação na hora"
        dica={
          erroNaLeitura ? (
            <>
              Não foi possível confirmar a conexão com as transportadoras. Sem
              confirmar, não dá para garantir entrega fora da cidade.
            </>
          ) : algumLigado ? (
            <>Cotação real, na hora, pelos provedores ligados abaixo.</>
          ) : (
            <>
              Nenhuma transportadora ligada — sua loja só entrega na sua cidade.
            </>
          )
        }
      >
        {!erroNaLeitura && !algumLigado && onAbrirAjustes && (
          <button
            type="button"
            onClick={onAbrirAjustes}
            className="flex shrink-0 items-center rounded-lg bg-admin-accent px-4 py-2 text-[12px] font-extrabold text-zinc-950 transition-all hover:opacity-90 active:scale-95"
          >
            Conectar transportadora
          </button>
        )}
        {erroNaLeitura && onTentarDeNovo && (
          <button
            type="button"
            onClick={onTentarDeNovo}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-4 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
          >
            <RefreshCw className="size-3.5" />
            Tentar de novo
          </button>
        )}
      </Linha>

      {/* Estado POR PROVEDOR (F10) — nunca "conectado" só por ter chave. */}
      {!erroNaLeitura && (
        <div className="-mt-2 flex flex-wrap gap-2 pb-4">
          {provedores.map((p) => (
            <span
              key={p.provider}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                p.estado === "ligado"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : p.estado === "incompleta"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : p.estado === "chave_salva"
                      ? "border-white/10 bg-white/5 text-zinc-300"
                      : "border-white/5 bg-transparent text-zinc-600"
              }`}
            >
              {p.nome}: {ROTULO_DO_ESTADO[p.estado]}
            </span>
          ))}
        </div>
      )}

      {/* Regressão 1.5.5 (revisão Opus, achado 2): chave sem e-mail de
          contato válido não cota — "incompleta" ganha o MESMO texto e CTA
          que a release 1.5.5 já usava para isso, agora por provedor. */}
      {!erroNaLeitura && provedores.some((p) => p.estado === "incompleta") && (
        <div className="-mt-2 flex flex-col gap-2 pb-4">
          {provedores
            .filter((p) => p.estado === "incompleta")
            .map((p) => (
              <p
                key={p.provider}
                className="flex flex-wrap items-center gap-2 text-[12.5px] leading-snug text-amber-300"
              >
                <AlertCircle className="size-3.5 shrink-0" />
                <span>
                  {p.nome} incompleta — falta o e-mail de contato em Ajustes.
                </span>
                {onAbrirAjustes && (
                  <button
                    type="button"
                    onClick={onAbrirAjustes}
                    className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-95"
                  >
                    Preencher em Ajustes
                  </button>
                )}
              </p>
            ))}
        </div>
      )}

      {!algumLigado && !erroNaLeitura && (
        <p className="-mt-2 pb-4 text-[12.5px] leading-snug text-zinc-500">
          Para vender para todo o Brasil, conecte e ligue ao menos uma
          transportadora em Ajustes. Quem compra de fora não consegue fechar o
          pedido até lá.
        </p>
      )}

      {/* CEP da loja — a única tela onde ele se define. Campo abre VAZIO
          quando a loja não configurou (nada de CEP inventado parecendo
          configuração pronta — trava herdada da auditoria 26/08). */}
      <Linha nome="CEP de origem" dica="De onde as entregas saem">
        <input
          id="origin-cep"
          type="text"
          maxLength={9}
          value={originCep}
          onChange={(e) => onOriginCep(formatCEP(e.target.value))}
          placeholder="00000-000"
          disabled={desabilitado}
          className="h-10 w-full rounded-xl border border-white/10 bg-zinc-900/60 px-3.5 text-center font-mono text-[13px] font-semibold text-zinc-100 placeholder-zinc-600 transition-colors focus:border-admin-accent focus:outline-none disabled:opacity-50 md:w-40"
        />
      </Linha>

      {!originCep && (
        <p className="-mt-2 flex items-start gap-2 pb-4 text-[12px] font-bold leading-snug text-amber-300 duration-200 animate-in fade-in">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          SEM ISSO A LOJA NÃO VENDE: sem o CEP da loja nenhum frete é calculado
          e o botão "Finalizar Pedido" fica bloqueado para todo cliente.
          Preencha e salve para abrir as vendas.
        </p>
      )}

      <Linha
        nome="Transportadoras e serviços"
        dica="A chave de acesso, o teste de conexão, os serviços habilitados e quem está ligado ficam em Ajustes."
      >
        {onAbrirAjustes && (
          <button
            type="button"
            onClick={onAbrirAjustes}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
          >
            <ExternalLink className="size-3.5 text-admin-accent" />
            Abrir Ajustes
          </button>
        )}
      </Linha>

      {/* T4 (23/09/2026): a estratégia de frete grátis/desconto para
          transportadora tem tela PRÓPRIA — o estado salvo mostra o que já
          vale sem precisar abrir a tela. */}
      {onAbrirEstrategiasNacionais && (
        <Linha
          nome="Estratégias do frete nacional"
          dica={
            <>
              Estado salvo:{" "}
              <b className="font-semibold text-zinc-300">
                {resumoDaEstrategiaNacional ?? "desligado"}
              </b>
            </>
          }
        >
          <button
            type="button"
            onClick={onAbrirEstrategiasNacionais}
            disabled={desabilitado}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            Estratégias do frete nacional
            <ChevronRight className="size-3.5 text-admin-accent" />
          </button>
        </Linha>
      )}
    </section>
  );
});
