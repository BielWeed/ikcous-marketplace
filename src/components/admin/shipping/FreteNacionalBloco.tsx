import type { ProvedorFrete } from "@/components/admin/settings/TransportadorasCard";
import {
  CabecaDeSecao,
  Linha,
  PontoEstado,
} from "@/components/admin/shipping/primitivas-direcao-d";
import { AlertCircle, ChevronRight, RefreshCw } from "lucide-react";
import { memo } from "react";

/**
 * Seção "Fora da cidade" da tela de Frete — RELEASE 1.5.7 v2 (frete com
 * vários provedores ao mesmo tempo). Até a 1.5.6 esta seção mostrava UM
 * estado ("conectado"/"desconectado") porque só existia UM provedor de
 * cotação por loja. Agora podem estar ligados Melhor Envio, SuperFrete e
 * Frenet ao mesmo tempo — o estado passa a ser POR PROVEDOR (F10, tarefa
 * P: "nunca 'conectado' só por ter chave").
 *
 * Este bloco continua só de LEITURA: quem grava chave, testa e liga/desliga
 * é a seção "Transportadoras" — desde o painel simples (H5) um painel da
 * MESMA tela de Frete, logo abaixo. Aqui o estado chega PRONTO da view, lido
 * pela MESMA edge (`ler_configuracao_frete`).
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
  cepDaLoja,
  onAbrirMinhaLoja,
  provedores,
  erroNaLeitura,
  onAbrirTransportadoras,
  onTentarDeNovo,
  desabilitado,
  resumoDaEstrategiaNacional,
  onAbrirEstrategiasNacionais,
  mostrarCabecalho = true,
}: {
  /** CEP de Minha loja — SÓ LEITURA. É de onde saem as entregas (P2: um CEP
   * só); esta tela nunca o edita nem o grava. Ausente/vazio = a loja ainda
   * não cadastrou. */
  readonly cepDaLoja?: string | null;
  /** Abre Minha loja (`admin-about-store`), onde o CEP se define. Ausente
   * quando a view não recebeu `onNavigate` — sem botão morto. */
  readonly onAbrirMinhaLoja?: () => void;
  /** Estado de CADA um dos três provedores — sempre os três, na ordem de
   * exibição (Melhor Envio, SuperFrete, Frenet). */
  readonly provedores: readonly ProvedorNacional[];
  /** A leitura da configuração de frete falhou — a tela não sabe e não
   * finge saber (estados honestos são a lei deste repo). */
  readonly erroNaLeitura?: boolean;
  /** Abre o painel "Transportadoras" da tela de Frete (e rola até ele). */
  readonly onAbrirTransportadoras?: () => void;
  readonly onTentarDeNovo?: () => void;
  readonly desabilitado?: boolean;
  /** Texto curto do estado SALVO da estratégia nacional (T4, 23/09/2026) —
   * `resumoDaEstrategiaNacional` de `src/lib/estrategias-de-frete.ts`, ao
   * lado do botão que abre a tela nova. */
  readonly resumoDaEstrategiaNacional?: string;
  /** Abre `admin-shipping-national` — ausente quando a view não recebeu
   * `onNavigate` (mesmo padrão de `onAbrirTransportadoras`). */
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

  const temCep = (cepDaLoja ?? "").trim() !== "";
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
        {!erroNaLeitura && !algumLigado && onAbrirTransportadoras && (
          <button
            type="button"
            onClick={onAbrirTransportadoras}
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
                  {p.nome} incompleta — falta o e-mail de contato em
                  Transportadoras.
                </span>
                {onAbrirTransportadoras && (
                  <button
                    type="button"
                    onClick={onAbrirTransportadoras}
                    className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-95"
                  >
                    Preencher em Transportadoras
                  </button>
                )}
              </p>
            ))}
        </div>
      )}

      {!algumLigado && !erroNaLeitura && (
        <p className="-mt-2 pb-4 text-[12.5px] leading-snug text-zinc-500">
          Para vender para todo o Brasil, conecte e ligue ao menos uma
          transportadora no painel Transportadoras, logo abaixo. Quem compra de
          fora não consegue fechar o pedido até lá.
        </p>
      )}

      {/* CEP da loja — LIDO de Minha loja, nunca editado aqui (P2: um CEP
          só). Sem CEP, nada de CEP inventado parecendo configuração pronta
          (trava herdada da auditoria 26/08): o aviso diz a consequência e o
          botão leva a quem resolve. */}
      <Linha
        nome="CEP da loja"
        dica={
          temCep ? (
            <>
              Entregas saem de:{" "}
              <b className="font-semibold text-zinc-300">
                CEP {formatCEP(cepDaLoja ?? "")}
              </b>
            </>
          ) : (
            "A loja ainda não tem CEP cadastrado."
          )
        }
      >
        {temCep && onAbrirMinhaLoja && (
          <button
            type="button"
            onClick={onAbrirMinhaLoja}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
          >
            Alterar em Minha loja
          </button>
        )}
      </Linha>

      {!temCep && (
        <p className="-mt-2 flex flex-wrap items-start gap-2 pb-4 text-[12px] font-bold leading-snug text-amber-300 duration-200 animate-in fade-in">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            SEM ISSO A LOJA NÃO VENDE: sem o CEP da loja nenhum frete é
            calculado e o botão "Finalizar Pedido" fica bloqueado para todo
            cliente. Cadastre o CEP em Minha loja para abrir as vendas.
          </span>
          {onAbrirMinhaLoja && (
            <button
              type="button"
              onClick={onAbrirMinhaLoja}
              className="flex min-h-11 shrink-0 items-center rounded-lg border border-amber-500/30 px-3 py-1 text-[12px] font-bold text-amber-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-95"
            >
              Cadastrar CEP em Minha loja
            </button>
          )}
        </p>
      )}

      <Linha
        nome="Transportadoras e serviços"
        dica="A chave de acesso, o teste de conexão, os serviços habilitados e quem está ligado ficam no painel Transportadoras, nesta mesma tela."
      >
        {onAbrirTransportadoras && (
          <button
            type="button"
            onClick={onAbrirTransportadoras}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
          >
            Abrir Transportadoras
            <ChevronRight className="size-3.5 text-admin-accent" />
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
