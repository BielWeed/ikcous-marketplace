import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/contexts/StoreContext";
import { supabase } from "@/lib/supabase";
import { Boxes, RefreshCw } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useState } from "react";

/**
 * Achado HistoricoCotacoesCard-100: a edge function AGUARDA a gravação do
 * log só para garantir que a linha de erro chegue ao banco — o comentário de
 * `calculate-shipping/index.ts` chama isso de "a ÚNICA janela que a lojista
 * tem" para descobrir que precisa conectar/configurar a transportadora. Sem
 * ler `error_message` aqui, aquela disciplina de `await` não entrega nada: o
 * selo vermelho "Erro" não distingue "falta credencial" de "Melhor Envio
 * fora do ar".
 *
 * Agrupa execuções CONSECUTIVAS de erro/contingência com o MESMO motivo PARA
 * O MESMO destino/transportadora: dez tentativas seguidas do MESMO cliente
 * batendo na mesma credencial ausente são UM diagnóstico, não dez linhas
 * idênticas repetindo o mesmo texto (a lojista rolando a lista não aprende
 * nada da nona repetição que não aprendeu na primeira). Sucesso nunca
 * agrupa — cada cotação boa continua com a própria linha, porque o "quando"
 * de cada uma tem valor por si.
 *
 * RODADA DE CORREÇÃO (achado BLOQUEIA): a chave original comparava só
 * `status` + `error_message` e por isso colapsava consultas de CLIENTES
 * DIFERENTES que só coincidem no texto do motivo — caso real: a loja
 * `flat_fee` remanescente (calculate-shipping/index.ts:941-948) grava a
 * MESMA `error_message` para todo cliente de fora da cidade, então dez
 * clientes de dez CEPs diferentes viravam uma única linha exibindo o CEP e
 * a transportadora só do PRIMEIRO log — um destino inventado para os outros
 * nove. `provider` e `destination_cep` entram na chave porque são
 * exatamente as duas colunas que a linha sobrevivente continua exibindo:
 * só pode dizer "×N" quando as N ocorrências são de fato a MESMA consulta
 * repetida, não N consultas diferentes com o mesmo motivo.
 */
function agruparRepeticoesDeErro(
  logs: any[],
): { log: any; repeticoes: number }[] {
  const grupos: { log: any; repeticoes: number }[] = [];
  for (const log of logs) {
    const anterior = grupos[grupos.length - 1];
    const mesmoMotivoSeguido =
      anterior !== undefined &&
      log.status !== "success" &&
      anterior.log.status === log.status &&
      (anterior.log.error_message ?? null) === (log.error_message ?? null) &&
      (anterior.log.provider ?? null) === (log.provider ?? null) &&
      (anterior.log.destination_cep ?? null) === (log.destination_cep ?? null);
    if (mesmoMotivoSeguido) {
      anterior.repeticoes += 1;
    } else {
      grupos.push({ log, repeticoes: 1 });
    }
  }
  return grupos;
}

// RODADA DE CORREÇÃO (achado ANTES DE CRESCER): `error_message` é coluna
// `text` sem limite e nem sempre é o texto amigável da edge — no ramo de
// falha de API o valor é o corpo BRUTO da resposta do provedor
// (`await response.text()` concatenado em "Melhor Envio API retornou
// ${status}: ${errText}"). Sem corte, um corpo de erro de alguns KB vira um
// parágrafo empurrando o resto da tabela para fora da tela no celular. O
// texto INTEIRO continua acessível via `title` no elemento — só o que É
// EXIBIDO leva o corte.
const LIMITE_MOTIVO_EXIBIDO = 200;
function cortarMotivoExibido(motivo: string): string {
  if (motivo.length <= LIMITE_MOTIVO_EXIBIDO) return motivo;
  return `${motivo.slice(0, LIMITE_MOTIVO_EXIBIDO)}…`;
}

/**
 * Card "Histórico de cotações de frete" da tela de Ajustes.
 *
 * MODOU DE TELA (frente glm-visual-admin-0209, pedido do Gabriel em
 * 02/09/2026): a tabela de cotações vivia no pé da tela de Frete. Registro
 * técnico de diagnóstico — aqui virou seção colapsável, nascida fechada.
 *
 * O motivo do estado vazio lê o provedor SALVO (`config.shippingProvider`),
 * nunca uma escolha não salva de outra seção: consulta que falhou não pode
 * se parecer com histórico vazio de verdade.
 *
 * RODADA DE CORREÇÃO (achado ANTES DE CRESCER): o texto do ramo `flat_fee`
 * dizia que o vazio era "por desenho" (a edge responderia direto, sem
 * consultar transportadora) — o FRETE V2 (03/09/2026) tornou isso falso.
 * Hoje `respostaSemCotacaoDeFora` (calculate-shipping/index.ts:941-948)
 * trata `flat_fee` como "sem transportadora conectada" e GRAVA UM ERRO a
 * cada tentativa de fora da cidade; zero logs não é silêncio inofensivo, é
 * silêncio de quem ainda não recebeu tentativa de fora (ou pode ser uma
 * loja recusando toda venda nacional sem que a lojista saiba).
 *
 * Busca no mount: a seção só monta quando o lojista a expande, então cada
 * abertura traz a leitura fresca — o mesmo efeito do "expandia e buscava" da
 * tela antiga, sem controle extra.
 *
 * LOTE E (13/09/2026, peça C — salão e porão): o card `rounded-3xl
 * border-white/5` é da casca (SecaoColapsavel) — aqui sobra conteúdo puro,
 * no mesmo idioma da seção de Transportadoras ao lado.
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

    // Calculado uma vez e usado tanto na tabela quanto no rodapé — achado
    // ANOTADO da rodada de correção: o rodapé contava `logs.length` (a
    // contagem CRUA) enquanto a tabela já mostrava menos linhas por causa
    // do agrupamento, e os dois números paravam de bater.
    const grupos = agruparRepeticoesDeErro(logs);

    return (
      <div
        id="historico-cotacoes-section"
        className="flex flex-col gap-3 text-zinc-200"
      >
        <p className="flex items-start gap-2 text-left text-xs leading-relaxed text-zinc-400">
          <Boxes className="mt-0.5 size-3.5 shrink-0 text-admin-gold" />
          <span>
            As últimas consultas de frete que o app fez para os seus clientes,
            das mais recentes para as mais antigas. Serve para conferir se a
            cotação com a transportadora está respondendo.
          </span>
        </p>

        {loadingLogs ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
            <Skeleton className="h-8 w-full rounded-lg bg-white/5" />
          </div>
        ) : logsError ? (
          <div className="py-4 text-center text-xs font-semibold text-red-400">
            Não foi possível carregar o histórico de cotações. Tente novamente
            em "Atualizar".
          </div>
        ) : logs.length === 0 && provedorSalvo === "flat_fee" ? (
          <p className="py-4 text-center text-xs text-zinc-400">
            Sem transportadora conectada (a Taxa Única Fixa foi descontinuada):
            este histórico registra um erro a cada tentativa de entrega fora da
            cidade. Se está vazio, ainda não houve tentativa de fora — mas
            nenhuma vai funcionar até você conectar Melhor Envio, Frenet ou
            SuperFrete.
          </p>
        ) : logs.length === 0 ? (
          <p className="py-4 text-center text-xs italic text-zinc-500">
            Nenhuma cotação registrada recentemente.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-zinc-950/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <th className="p-2.5">Quando</th>
                  <th className="p-2.5">Destino</th>
                  <th className="p-2.5">Transportadora</th>
                  <th className="p-2.5">Tempo</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {grupos.map(({ log, repeticoes }) => (
                  <Fragment key={log.id}>
                    <tr className="hover:bg-white/5">
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
                          {repeticoes > 1 ? ` ×${repeticoes}` : ""}
                        </span>
                      </td>
                    </tr>
                    {/* Achado HistoricoCotacoesCard-100: a edge grava
                        `error_message` com o motivo ACIONÁVEL ("Conecte a
                        transportadora...") e aguarda a gravação só para isso
                        chegar aqui — sem esta linha, o selo vermelho não
                        distingue "falta credencial" de "Melhor Envio fora do
                        ar". Segunda linha do <tr>, não coluna nova: o
                        motivo é texto livre e longo, e uma sexta coluna
                        estouraria a tabela no celular.

                        RODADA DE CORREÇÃO (achado ANTES DE CRESCER):
                        `error_message` não tem limite de tamanho — no ramo
                        de falha de API a edge concatena o corpo BRUTO da
                        resposta do provedor. `title` no <td> carrega o
                        texto INTEIRO (hover mostra o motivo completo); o
                        texto EXIBIDO é cortado em
                        `LIMITE_MOTIVO_EXIBIDO` caracteres para não empurrar
                        o resto da tabela para fora da tela no celular. */}
                    {log.status !== "success" && log.error_message ? (
                      <tr className="bg-white/[0.02]">
                        <td
                          colSpan={5}
                          title={log.error_message}
                          className="px-2.5 pb-2.5 pt-0 text-[11px] leading-relaxed text-zinc-400"
                        >
                          <span className="font-bold text-zinc-300">
                            Motivo:{" "}
                          </span>
                          {cortarMotivoExibido(log.error_message)}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-zinc-400">
          {logs.length > 0 && (
            <span>
              {grupos.length === logs.length ? (
                // Sem agrupamento nesta leitura: uma linha de dado por
                // consulta, então a contagem crua já é a verdade da tela.
                <>
                  Exibindo {logs.length === 1 ? "a" : "as"} {logs.length}{" "}
                  {logs.length === 1 ? "consulta" : "consultas"} mais recente
                  {logs.length === 1 ? "" : "s"}
                </>
              ) : (
                // RODADA DE CORREÇÃO (achado ANOTADO): com agrupamento a
                // tabela mostra menos linhas do que `logs.length` — dizer só
                // "Exibindo as N consultas" faria a lojista contar linhas na
                // tela e não bater com o número. As duas contagens, lado a
                // lado, continuam corretas nos dois sentidos.
                <>
                  Exibindo {logs.length}{" "}
                  {logs.length === 1 ? "consulta" : "consultas"} mais recente
                  {logs.length === 1 ? "" : "s"} em {grupos.length}{" "}
                  {grupos.length === 1 ? "ocorrência" : "ocorrências"}
                </>
              )}
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
    );
  },
);
