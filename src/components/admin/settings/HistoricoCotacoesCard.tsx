import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/contexts/StoreContext";
import { supabase } from "@/lib/supabase";
import { Boxes, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

/**
 * Card "Histórico de cotações de frete" da tela de Ajustes.
 *
 * MODOU DE TELA (frente glm-visual-admin-0209, pedido do Gabriel em
 * 02/09/2026): a tabela de cotações vivia no pé da tela de Frete. Registro
 * técnico de diagnóstico — aqui virou seção colapsável, nascida fechada.
 *
 * O motivo do estado vazio lê o provedor SALVO (`config.shippingProvider`),
 * nunca uma escolha não salva de outra seção: com a Taxa Única Fixa o
 * histórico é vazio POR DESENHO (a edge function responde direto, sem
 * consultar transportadora), e essa diferença tem de aparecer — consulta que
 * falhou não pode se parecer com histórico vazio de verdade.
 *
 * Busca no mount: a seção só monta quando o lojista a expande, então cada
 * abertura traz a leitura fresca — o mesmo efeito do "expandia e buscava" da
 * tela antiga, sem controle extra.
 */
export const HistoricoCotacoesSection = memo(
  function HistoricoCotacoesSection() {
    const { config } = useStore();
    const [logs, setLogs] = useState<any[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [logsError, setLogsError] = useState(false);

    const fetchLogs = useCallback(async () => {
      setLoadingLogs(true);
      // Limpa o erro da rodada anterior no início de CADA busca — um
      // "Atualizar" que deu certo precisa tirar o aviso vermelho da tela.
      setLogsError(false);
      try {
        const { data, error } = await supabase
          .from("shipping_calculation_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(15);
        if (error) throw error;
        setLogs(data || []);
      } catch (err) {
        console.error("[HistoricoCotacoes] Error fetching logs:", err);
        setLogsError(true);
      } finally {
        setLoadingLogs(false);
      }
    }, []);

    useEffect(() => {
      fetchLogs();
    }, [fetchLogs]);

    // O provedor SALVO decide a frase do vazio — não o que está digitado em
    // outra seção sem salvar (a edge function segue na transportadora salva
    // até alguém gravar a mudança).
    const provedorSalvo = config?.shippingProvider || "flat_fee";

    return (
      <div className="space-y-3">
        <div
          id="historico-cotacoes-section"
          className="admin-glass border-y border-white/5 p-3.5 shadow-2xl sm:rounded-2xl sm:border-x sm:p-4"
        >
          <div className="flex flex-col gap-3">
            <p className="flex items-start gap-2 text-left text-[9.5px] leading-snug text-zinc-400">
              <Boxes className="mt-0.5 size-3.5 shrink-0 text-admin-gold" />
              <span>
                As últimas consultas de frete que o app fez para os seus
                clientes, das mais recentes para as mais antigas. Serve para
                conferir se a cotação com a transportadora está respondendo.
              </span>
            </p>

            {loadingLogs ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
                <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
              </div>
            ) : logsError ? (
              <div className="py-4 text-center text-xs font-semibold text-red-400">
                Não foi possível carregar o histórico de cotações. Tente
                novamente em "Atualizar".
              </div>
            ) : logs.length === 0 && provedorSalvo === "flat_fee" ? (
              <p className="py-4 text-center text-xs text-zinc-400">
                Nenhuma cotação para mostrar: com a Taxa Única Fixa o app já
                responde o frete direto, sem consultar transportadora, então
                não existe cotação para registrar aqui. Este histórico passa a
                receber linhas se a loja trocar para Melhor Envio ou Frenet.
              </p>
            ) : logs.length === 0 ? (
              <p className="py-4 text-center text-xs italic text-zinc-500">
                Nenhuma cotação registrada recentemente.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/50">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      <th className="p-2.5">Quando</th>
                      <th className="p-2.5">Destino</th>
                      <th className="p-2.5">Transportadora</th>
                      <th className="p-2.5">Tempo</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-zinc-300">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/5">
                        <td className="p-2.5 font-mono text-[11px] text-zinc-400">
                          {new Date(log.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-2.5 font-semibold text-white">
                          {/* Linha com campo nulo não pode derrubar a seção
                              inteira (achado A2 da revisão adversária: o
                              original carregou este mesmo risco — guardado
                              aqui onde ele agora mora). */}
                          {(log.destination_cep ?? "").replace(
                            /(\d{5})(\d{3})/,
                            "$1-$2",
                          )}
                        </td>
                        <td className="p-2.5 capitalize text-zinc-300">
                          {(log.provider ?? "").replace("_", " ")}
                        </td>
                        <td className="p-2.5 font-mono text-zinc-400">
                          {log.response_time_ms
                            ? `${log.response_time_ms}ms`
                            : "—"}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              log.status === "success"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : log.status === "contingency"
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-red-500/20 text-red-300"
                            }`}
                          >
                            {log.status === "success"
                              ? "Sucesso"
                              : log.status === "contingency"
                                ? "Contingência"
                                : "Erro"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              {logs.length > 0 && (
                <span>
                  Exibindo {logs.length === 1 ? "a" : "as"} {logs.length}{" "}
                  {logs.length === 1 ? "consulta" : "consultas"} mais
                  recente{logs.length === 1 ? "" : "s"}
                </span>
              )}
              <button
                type="button"
                onClick={fetchLogs}
                disabled={loadingLogs}
                className="ml-auto flex items-center gap-1 font-bold text-admin-gold hover:underline"
              >
                <RefreshCw
                  className={`size-3 ${loadingLogs ? "animate-spin" : ""}`}
                />
                <span>Atualizar</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
