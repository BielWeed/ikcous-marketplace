import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NOME_DO_PEDIDO, TEXTOS_DA_LOJA } from "@/config/textos-de-privacidade";
import {
  type FalhaDaDecisao,
  usePedidosDePrivacidadeAdmin,
} from "@/hooks/usePedidosDePrivacidadeAdmin";
import {
  type PedidoDePrivacidade,
  formatarDataDoPedido,
  prazoFinalDoPedido,
  prazoVencido,
} from "@/lib/pedidos-de-privacidade";
import type { View } from "@/types";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Mail,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import {
  CARTAO_AJUSTES,
  CARTAO_DESTAQUE_AJUSTES,
  IconeDeAjustes,
} from "./visual-ajustes";

// ⚠️ Os TEXTOS desta seção moram em src/config/textos-de-privacidade.ts e PRECISAM
// de revisão do dono. O roteiro de quem atende está em
// docs/runbooks/atender-pedido-de-privacidade.md.
//
// SEM BOTÃO DE APAGAR, de propósito: o app só REGISTRA e a loja marca "atendido"
// DEPOIS de anonimizar à mão. Apagar conta ou dado daqui nunca foi o desenho.

const CLASSE_DO_BOTAO_DOURADO =
  "ajustes-primario flex min-h-11 items-center justify-center gap-2";
const CLASSE_DO_BOTAO_NEUTRO = "ajustes-secundario min-h-11";
const CLASSE_DO_CAMPO =
  "min-h-20 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-violet-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40";

const TEXTO_DA_FALHA: Record<FalhaDaDecisao, string> = {
  ja_decidido: TEXTOS_DA_LOJA.falhaJaDecidido,
  sem_rede: TEXTOS_DA_LOJA.falhaAoDecidir,
  outra: TEXTOS_DA_LOJA.falhaAoDecidir,
};

interface Decisao {
  readonly id: string;
  readonly situacao: "atendido" | "recusado";
}

export const PrivacidadeDosClientesSection = memo(
  function PrivacidadeDosClientesSection({
    onNavigate,
    onDirtyMudou,
  }: {
    /** Abre a ficha da cliente (o e-mail de entrada e os pedidos moram lá). */
    readonly onNavigate?: (view: View, id?: string) => void;
    /** Avisa o pai para BLOQUEAR o fecho da seção enquanto houver nota digitada e não salva. */
    readonly onDirtyMudou?: (dirty: boolean) => void;
  }) {
    const {
      carga,
      pedidos,
      nomes,
      cortou,
      abertosCortou,
      decidindo,
      recarregar,
      decidir,
    } = usePedidosDePrivacidadeAdmin();
    // Nota (resposta à cliente) de cada pedido ainda aberto, por id.
    const [notas, setNotas] = useState<ReadonlyMap<string, string>>(new Map());
    const [pergunta, setPergunta] = useState<Decisao | null>(null);
    const [falha, setFalha] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<"abertos" | "respondidos">("abertos");

    const abertos = pedidos.filter((p) => p.situacao === "aberto");
    const decididos = pedidos
      .filter((p) => p.situacao !== "aberto")
      .sort((a, b) => (b.atendido_em ?? "").localeCompare(a.atendido_em ?? ""));

    const sujo = abertos.some((p) => (notas.get(p.id) ?? "").trim() !== "");
    useEffect(() => {
      onDirtyMudou?.(sujo);
    }, [sujo, onDirtyMudou]);

    function mudarNota(id: string, texto: string) {
      setNotas((antes) => new Map(antes).set(id, texto));
    }

    async function confirmar() {
      if (!pergunta) return;
      setFalha(null);
      const resultado = await decidir(
        pergunta.id,
        pergunta.situacao,
        notas.get(pergunta.id) ?? "",
      );
      if (resultado.ok) {
        setNotas((antes) => {
          const depois = new Map(antes);
          depois.delete(pergunta.id);
          return depois;
        });
        setPergunta(null);
        return;
      }
      setFalha(TEXTO_DA_FALHA[resultado.falha]);
      // Já estava decidido: a lista foi relida, a pergunta não faz mais sentido.
      if (resultado.falha === "ja_decidido") setPergunta(null);
    }

    function fecharPergunta() {
      if (decidindo !== null) return;
      setPergunta(null);
      setFalha(null);
    }

    const agora = new Date();

    return (
      <div className="space-y-7">
        <p className="text-xs leading-relaxed text-zinc-400">
          {TEXTOS_DA_LOJA.explicacao}
        </p>

        {carga === "carregando" && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-zinc-400"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {TEXTOS_DA_LOJA.carregando}
          </p>
        )}

        {carga === "erro" && (
          <div
            role="alert"
            className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"
          >
            <p className="font-bold">{TEXTOS_DA_LOJA.falhaAoCarregar}</p>
            <button
              type="button"
              onClick={() => void recarregar()}
              className={CLASSE_DO_BOTAO_NEUTRO}
            >
              {TEXTOS_DA_LOJA.recarregar}
            </button>
          </div>
        )}

        {falha && pergunta === null && (
          <p
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-bold text-red-300"
          >
            {falha}
          </p>
        )}

        {carga === "pronta" && pedidos.length === 0 && (
          <p className="text-xs text-zinc-400">{TEXTOS_DA_LOJA.vazio}</p>
        )}

        {abertosCortou && (
          <div
            role="alert"
            className={`${CARTAO_AJUSTES} space-y-3 text-xs text-orange-300`}
          >
            <p className="flex items-center gap-2 text-sm font-bold">
              <AlertCircle aria-hidden="true" className="size-5" />
              Lista incompleta
            </p>
            <p>{TEXTOS_DA_LOJA.abertosCortados}</p>
            <button
              type="button"
              onClick={() => void recarregar()}
              className={CLASSE_DO_BOTAO_NEUTRO}
            >
              Tentar de novo
            </button>
          </div>
        )}

        {cortou && (
          <div
            role="status"
            className={`${CARTAO_AJUSTES} space-y-3 text-xs text-orange-300`}
          >
            <p className="text-sm font-bold">Lista incompleta</p>
            <p>{TEXTOS_DA_LOJA.listaCortada}</p>
            {!abertosCortou && (
              <button
                type="button"
                onClick={() => void recarregar()}
                className={CLASSE_DO_BOTAO_NEUTRO}
              >
                Tentar de novo
              </button>
            )}
          </div>
        )}

        {carga === "pronta" && (
          <div
            role="group"
            aria-label="Filtrar pedidos de privacidade"
            className="grid gap-2"
          >
            {(["abertos", "respondidos"] as const).map((opcao) => {
              const parcial = opcao === "abertos" ? abertosCortou : cortou;
              const total =
                opcao === "abertos" ? abertos.length : decididos.length;
              const rotulo =
                opcao === "abertos"
                  ? TEXTOS_DA_LOJA.abertos
                  : TEXTOS_DA_LOJA.decididos;
              return (
                <button
                  key={opcao}
                  type="button"
                  aria-pressed={filtro === opcao}
                  onClick={() => setFiltro(opcao)}
                  className={`flex min-h-11 items-center justify-between gap-3 rounded-2xl border p-3 text-left text-sm ${filtro === opcao ? "border-admin-gold bg-admin-gold/10 text-admin-gold" : "border-white/10 bg-[#17171c] text-zinc-200"}`}
                >
                  <span>
                    {parcial
                      ? `${rotulo} · ${total} carregados · lista incompleta`
                      : `${rotulo} (${total})`}
                  </span>
                  {filtro === opcao && (
                    <Check aria-hidden="true" className="size-5 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {carga === "pronta" &&
          pedidos.length > 0 &&
          (filtro === "abertos"
            ? abertos.length === 0
            : decididos.length === 0) && (
            <p
              role="status"
              className={`${CARTAO_AJUSTES} text-sm text-zinc-400`}
            >
              {filtro === "abertos"
                ? "Nenhum pedido de privacidade esperando resposta."
                : "Nenhum pedido respondido por enquanto."}
            </p>
          )}

        {abertos.length > 0 && (
          <div hidden={filtro !== "abertos"} className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
              {TEXTOS_DA_LOJA.abertos}
              {abertosCortou
                ? ` · ${abertos.length} carregados · lista incompleta`
                : ` (${abertos.length})`}
            </h4>
            <ul className="space-y-3">
              {abertos.map((pedido, indice) => (
                <li
                  key={pedido.id}
                  data-pedido-de-privacidade={pedido.id}
                  className={`${indice === 0 ? CARTAO_DESTAQUE_AJUSTES : CARTAO_AJUSTES} space-y-4`}
                >
                  <CabecalhoDoPedido
                    pedido={pedido}
                    nome={nomes.get(pedido.user_id)}
                    onVerCliente={
                      onNavigate
                        ? () => onNavigate("admin-user-detail", pedido.user_id)
                        : undefined
                    }
                  />
                  <PrazoDoPedido pedido={pedido} agora={agora} />
                  <details open={indice === 0} className="group">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-sky-300">
                      Responder pedido{" "}
                      <ChevronDown
                        aria-hidden="true"
                        className="size-5 shrink-0"
                      />
                    </summary>
                    <div className="space-y-4 pt-3">
                      <div className="space-y-1">
                        <label
                          htmlFor={`nota-privacidade-${pedido.id}`}
                          className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
                        >
                          {TEXTOS_DA_LOJA.notaRotulo}
                        </label>
                        <textarea
                          id={`nota-privacidade-${pedido.id}`}
                          value={notas.get(pedido.id) ?? ""}
                          maxLength={1000}
                          disabled={decidindo !== null}
                          onChange={(evento) =>
                            mudarNota(pedido.id, evento.target.value)
                          }
                          aria-describedby={`nota-privacidade-dica-${pedido.id}`}
                          className={CLASSE_DO_CAMPO}
                        />
                        <p
                          id={`nota-privacidade-dica-${pedido.id}`}
                          className="text-[11px] text-zinc-500"
                        >
                          {TEXTOS_DA_LOJA.notaDica}
                          <span className="mt-1 block tabular-nums">
                            {(notas.get(pedido.id) ?? "").length} / 1.000
                            caracteres
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-col gap-3">
                        <button
                          type="button"
                          disabled={decidindo !== null}
                          onClick={() => {
                            setFalha(null);
                            setPergunta({
                              id: pedido.id,
                              situacao: "atendido",
                            });
                          }}
                          className={CLASSE_DO_BOTAO_DOURADO}
                        >
                          {TEXTOS_DA_LOJA.marcarAtendido}
                        </button>
                        <button
                          type="button"
                          disabled={decidindo !== null}
                          onClick={() => {
                            setFalha(null);
                            setPergunta({
                              id: pedido.id,
                              situacao: "recusado",
                            });
                          }}
                          className={`${CLASSE_DO_BOTAO_NEUTRO} !text-red-300`}
                        >
                          {TEXTOS_DA_LOJA.marcarRecusado}
                        </button>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}

        {decididos.length > 0 && (
          <div hidden={filtro !== "respondidos"} className="space-y-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
              {TEXTOS_DA_LOJA.decididos}
              {cortou
                ? ` · ${decididos.length} carregados · lista incompleta`
                : ` (${decididos.length})`}
            </h4>
            <ul className="space-y-2">
              {decididos.map((pedido) => (
                <li
                  key={pedido.id}
                  data-pedido-de-privacidade={pedido.id}
                  className={`${CARTAO_AJUSTES} space-y-3 text-xs text-zinc-300`}
                >
                  <CabecalhoDoPedido
                    pedido={pedido}
                    nome={nomes.get(pedido.user_id)}
                  />
                  <p className="text-zinc-400">
                    {pedido.situacao === "atendido"
                      ? "Atendido"
                      : "Não atendido"}{" "}
                    · {TEXTOS_DA_LOJA.atendidoEm}{" "}
                    {formatarDataDoPedido(pedido.atendido_em)}
                  </p>
                  {pedido.observacao && (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-200">
                      {pedido.observacao}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-zinc-500">
          {TEXTOS_DA_LOJA.semBotaoDeApagar}
        </p>

        <AlertDialog
          open={pergunta !== null}
          onOpenChange={(aberto) => {
            if (!aberto) fecharPergunta();
          }}
        >
          <AlertDialogContent className="ajustes-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pergunta?.situacao === "recusado"
                  ? TEXTOS_DA_LOJA.confirmaRecusadoTitulo
                  : TEXTOS_DA_LOJA.confirmaAtendidoTitulo}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pergunta?.situacao === "recusado"
                  ? TEXTOS_DA_LOJA.confirmaRecusadoTexto
                  : TEXTOS_DA_LOJA.confirmaAtendidoTexto}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {falha && (
              <p role="alert" className="text-sm font-semibold text-red-300">
                {falha}
              </p>
            )}
            <AlertDialogFooter className="!flex-col">
              <AlertDialogCancel
                disabled={decidindo !== null}
                className="ajustes-secundario min-h-11"
              >
                {TEXTOS_DA_LOJA.voltar}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={decidindo !== null}
                className="ajustes-primario min-h-11"
                onClick={(evento) => {
                  evento.preventDefault();
                  void confirmar();
                }}
              >
                {decidindo !== null
                  ? TEXTOS_DA_LOJA.salvando
                  : pergunta?.situacao === "recusado"
                    ? TEXTOS_DA_LOJA.confirmaAcaoRecusado
                    : TEXTOS_DA_LOJA.confirmaAcaoAtendido}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
);

function CabecalhoDoPedido({
  pedido,
  nome,
  onVerCliente,
}: {
  readonly pedido: PedidoDePrivacidade;
  readonly nome: string | undefined;
  readonly onVerCliente?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <IconeDeAjustes
        icone={pedido.tipo === "corrigir_email" ? Mail : Trash2}
        matiz={pedido.tipo === "corrigir_email" ? "verde" : "roxo"}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-base font-bold text-white">
          {nome ?? TEXTOS_DA_LOJA.clienteSemNome}
        </p>
        <p className="text-xs text-zinc-400">{NOME_DO_PEDIDO[pedido.tipo]}</p>
        <p className="text-xs text-zinc-400">
          {TEXTOS_DA_LOJA.pedidoEm} {formatarDataDoPedido(pedido.criado_em)}
        </p>
        {pedido.email_novo && (
          <p className="break-all text-xs text-zinc-300">
            {TEXTOS_DA_LOJA.emailPedido}: {pedido.email_novo}
          </p>
        )}
      </div>
      {onVerCliente && (
        <button
          type="button"
          onClick={onVerCliente}
          className={CLASSE_DO_BOTAO_NEUTRO}
        >
          {TEXTOS_DA_LOJA.verCliente}
        </button>
      )}
    </div>
  );
}

function PrazoDoPedido({
  pedido,
  agora,
}: {
  readonly pedido: PedidoDePrivacidade;
  readonly agora: Date;
}) {
  const fim = prazoFinalDoPedido(pedido.criado_em);
  if (!fim) return null;
  const vencido = prazoVencido(pedido.criado_em, agora);
  return (
    <p
      className={`text-xs font-bold ${vencido ? "text-red-400" : "text-zinc-300"}`}
    >
      {vencido
        ? TEXTOS_DA_LOJA.prazoVencido
        : `${TEXTOS_DA_LOJA.prazoAte} ${formatarDataDoPedido(fim.toISOString())}`}
    </p>
  );
}
