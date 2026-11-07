import { useCallback, useEffect, useRef, useState } from "react";

import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  TAMANHO_MAXIMO_DA_FOTO,
  TIPOS_DE_FOTO,
  caminhoDaFoto,
  lerDevolucaoDetalhe,
  lerDevolucoesDoPedido,
  lerElegibilidade,
  lerResultadoDeStatus,
  lerResultadoSolicitacao,
  mensagemDoErro,
} from "@/lib/devolucao";
import { redimensionarImagem } from "@/lib/redimensiona-imagem";
import { supabase } from "@/lib/supabase";
import { gerarUuidV4 } from "@/lib/uuid-v4";
import type {
  DevolucaoDetalhe,
  ElegibilidadeDevolucao,
  MetodoDevolucao,
  MotivoDevolucao,
  ResolucaoDevolucao,
  ResultadoSolicitacao,
  ResumoDevolucao,
} from "@/types/devolucao";
import { PrazoEsgotado, comPrazo } from "@/utils/com-prazo";

export type Desfecho<T = undefined> =
  | { ok: true; valor: T }
  | { ok: false; erro: string };

export interface DadosDaSolicitacao {
  itens: Array<{ order_item_id: string; quantidade: number }>;
  motivo: MotivoDevolucao;
  detalhe: string;
  resolucao: ResolucaoDevolucao;
  metodo: MetodoDevolucao;
  fotos: string[];
}

export interface DevolucaoDoCliente {
  elegibilidade: ElegibilidadeDevolucao | null;
  /** `devolucoes_do_pedido` — mais recente primeiro. */
  devolucoes: ResumoDevolucao[];
  /** A ficha completa da devolução mais recente (instruções, trilha). */
  atual: DevolucaoDetalhe | null;
  carregando: boolean;
  /** A última leitura falhou (rede, RPC ou forma inesperada). */
  erro: boolean;
  recarregar: () => Promise<void>;
  solicitar: (
    dados: DadosDaSolicitacao,
  ) => Promise<Desfecho<ResultadoSolicitacao>>;
  enviarFoto: (arquivo: File, userId: string) => Promise<Desfecho<string>>;
  /** Apaga fotos enviadas e não usadas (melhor esforço; nunca lança). */
  descartarFotos: (caminhos: readonly string[]) => Promise<void>;
  cancelar: (id: string) => Promise<Desfecho>;
  informarEnvio: (id: string, codigo: string) => Promise<Desfecho>;
}

const ERRO_GENERICO = "Não foi possível concluir agora. Tente de novo.";
const PRAZO_DA_LEITURA_MS = 12_000;
const PRAZO_DA_GRAVACAO_MS = 20_000;
const PRAZO_DO_UPLOAD_DA_FOTO_MS = 90_000;
const SEM_RESPOSTA =
  "Sem resposta da rede. Confira se a mudança apareceu no pedido antes de tentar de novo.";

/**
 * Devolução/troca na tela do pedido do CLIENTE (plano 2026-09-26, seção
 * "Devoluções"). Lê a elegibilidade (o servidor decide prazos, métodos e o
 * que ainda pode voltar) e as devoluções do pedido; expõe as quatro ações
 * do cliente. Toda regra de negócio é do servidor — a tela só não oferece o
 * que a RPC recusaria, e mostra a recusa dela como veio quando acontece.
 *
 * `habilitado`: quem chama decide SE lê (pedido entregue + cliente logado —
 * convidado não tem `auth.uid()` e as RPCs recusam). O hook é chamado sempre
 * (regra do React) e, desligado, não busca nada.
 *
 * Sem realtime: a mudança de status já chega ao cliente como aviso em
 * `notificacoes` (gatilho da migration); a tela relê ao abrir, após cada
 * ação dela (inclusive quando o servidor a recusa: a recusa quase sempre
 * quer dizer que o cartão na tela está velho) e ao voltar ao app (aba
 * visível de novo ou conexão de volta).
 */
export function useDevolucaoCliente(
  orderId: string,
  habilitado: boolean,
): DevolucaoDoCliente {
  const [elegibilidade, setElegibilidade] =
    useState<ElegibilidadeDevolucao | null>(null);
  const [devolucoes, setDevolucoes] = useState<ResumoDevolucao[]>([]);
  const [atual, setAtual] = useState<DevolucaoDetalhe | null>(null);
  // Pedido a que os dados acima pertencem: no primeiro render depois da troca
  // de `orderId` o estado ainda é do pedido anterior (a limpeza roda num efeito).
  const [idDosDados, setIdDosDados] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [idDoErro, setIdDoErro] = useState<string | null>(null);
  const ativoRef = useRef(true);
  const orderIdRef = useRef(orderId);
  // Rodada da leitura: a resposta velha que chega depois da nova não pinta
  // a tela (mesmo padrão de useAvisosDoLojista).
  const rodadaRef = useRef(0);
  // A RPC não tem chave de idempotência. O banco recusa duas devoluções
  // ativas; após resposta perdida, até uma nova já encerrada impede reenviar.
  const solicitacaoIncertaRef = useRef<{
    orderId: string;
    idsAnteriores: Set<string>;
  } | null>(null);

  const carregar = useCallback(async () => {
    if (!habilitado || !ativoRef.current || orderIdRef.current !== orderId) {
      return;
    }
    const rodada = ++rodadaRef.current;
    const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
    setCarregando(true);
    try {
      // Um único prazo cobre a lista E o detalhe. A leitura atrasada não
      // alcança os setState abaixo, nem apaga o aviso de falha da consulta.
      const { lida, lista, detalhe } = await comPrazo(
        (async () => {
          const [respElegibilidade, respLista] = await Promise.all([
            supabase.rpc("devolucao_elegibilidade", { p_order_id: orderId }),
            supabase.rpc("devolucoes_do_pedido", { p_order_id: orderId }),
          ]);
          if (respElegibilidade.error || respLista.error) throw new Error();
          const lida = lerElegibilidade(respElegibilidade.data);
          const lista = lerDevolucoesDoPedido(respLista.data);
          if (!lida || !lista) throw new Error();

          let detalhe: DevolucaoDetalhe | null = null;
          if (lista.length > 0) {
            const respDetalhe = await supabase.rpc("devolucao_detalhe", {
              p_id: lista[0].id,
            });
            detalhe = respDetalhe.error
              ? null
              : lerDevolucaoDetalhe(respDetalhe.data);
            if (!detalhe) throw new Error();
          }
          return { lida, lista, detalhe };
        })(),
        PRAZO_DA_LEITURA_MS,
      );
      if (!valeAinda()) return;
      const incerta = solicitacaoIncertaRef.current;
      if (
        incerta?.orderId === orderId &&
        lista.some((d) => !incerta.idsAnteriores.has(d.id))
      ) {
        // O pedido apareceu: não mantém a dúvida depois de ele ser encerrado.
        solicitacaoIncertaRef.current = null;
      }

      setElegibilidade(lida);
      setDevolucoes(lista);
      setAtual(detalhe);
      setIdDosDados(orderId);
      setErro(false);
    } catch {
      // Inclui o cliente sem `rpc` (dublê de teste antigo) e a rede caída:
      // "não consegui ler" nunca vira "não tem devolução".
      if (valeAinda()) {
        setIdDoErro(orderId);
        setErro(true);
      }
    } finally {
      if (valeAinda()) setCarregando(false);
    }
  }, [orderId, habilitado]);

  useEffect(() => {
    ativoRef.current = true;
    orderIdRef.current = orderId;
    // Outro pedido começa sem dados nem erro da leitura anterior.
    setAtual(null);
    setElegibilidade(null);
    setDevolucoes([]);
    setIdDosDados(null);
    setIdDoErro(null);
    setErro(false);
    setCarregando(false);
    if (habilitado) void carregar();
    return () => {
      ativoRef.current = false;
      rodadaRef.current += 1;
    };
  }, [orderId, habilitado, carregar]);

  // Ficha aberta por muito tempo: a loja pode ter aprovado, recebido ou
  // cancelado sem a tela saber. Ao voltar ao app, relê (a guarda de rodada de
  // `carregar` descarta a resposta velha; os dados na tela ficam até a nova).
  useEffect(() => {
    if (!habilitado) return;
    const aoVoltarAba = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    const aoVoltarConexao = () => void carregar();
    document.addEventListener("visibilitychange", aoVoltarAba);
    window.addEventListener("online", aoVoltarConexao);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltarAba);
      window.removeEventListener("online", aoVoltarConexao);
    };
  }, [habilitado, carregar]);

  const solicitar = useCallback(
    async (
      dados: DadosDaSolicitacao,
    ): Promise<Desfecho<ResultadoSolicitacao>> => {
      const desmarcar = marcarOperacaoSensivel("solicitacao-de-devolucao");
      const idsAnteriores = new Set(devolucoes.map((d) => d.id));
      try {
        const incerta = solicitacaoIncertaRef.current;
        if (incerta?.orderId === orderId) {
          const resposta = await comPrazo(
            Promise.resolve(
              supabase.rpc("devolucoes_do_pedido", { p_order_id: orderId }),
            ),
            PRAZO_DA_LEITURA_MS,
          );
          const lista = resposta.error
            ? null
            : lerDevolucoesDoPedido(resposta.data);
          if (
            lista?.some((d) => !incerta.idsAnteriores.has(d.id)) &&
            solicitacaoIncertaRef.current === incerta
          ) {
            solicitacaoIncertaRef.current = null;
          }
          if (
            !lista ||
            lista.some(
              (d) =>
                !incerta.idsAnteriores.has(d.id) ||
                ["solicitada", "aprovada", "em_transito", "recebida"].includes(
                  d.status,
                ),
            )
          ) {
            void carregar();
            return { ok: false, erro: SEM_RESPOSTA };
          }
          solicitacaoIncertaRef.current = null;
        }
        const { data, error } = await comPrazo(
          Promise.resolve(
            supabase.rpc("solicitar_devolucao", {
              p_order_id: orderId,
              p_itens: dados.itens,
              p_motivo: dados.motivo,
              p_detalhe: dados.detalhe.trim() || null,
              p_resolucao: dados.resolucao,
              p_metodo: dados.metodo,
              p_fotos: dados.fotos,
            }),
          ),
          PRAZO_DA_GRAVACAO_MS,
          undefined,
          () => {
            if (
              solicitacaoIncertaRef.current?.idsAnteriores === idsAnteriores
            ) {
              solicitacaoIncertaRef.current = null;
            }
            void carregar();
          },
        );
        if (error) {
          await carregar();
          return { ok: false, erro: mensagemDoErro(error, ERRO_GENERICO) };
        }
        const resultado = lerResultadoSolicitacao(data);
        if (!resultado) {
          await carregar();
          return {
            ok: false,
            erro: "Não conseguimos confirmar o pedido. Confira se ele apareceu no pedido antes de tentar de novo.",
          };
        }
        await carregar();
        return { ok: true, valor: resultado };
      } catch (e) {
        if (e instanceof PrazoEsgotado) {
          if (solicitacaoIncertaRef.current?.orderId !== orderId) {
            solicitacaoIncertaRef.current = { orderId, idsAnteriores };
          }
          void carregar();
          return { ok: false, erro: SEM_RESPOSTA };
        }
        await carregar();
        return { ok: false, erro: mensagemDoErro(e, ERRO_GENERICO) };
      } finally {
        desmarcar();
      }
    },
    [orderId, carregar, devolucoes],
  );

  /**
   * Apaga do bucket as fotos que o cliente enviou e NÃO usou (tirou da lista,
   * ou fechou a tela sem concluir). "O melhor possível": a política de DELETE
   * do bucket (20261216) só deixa apagar foto da própria pasta que nenhuma
   * devolução referencia, e qualquer falha aqui é ignorada — a limpeza nunca
   * atrapalha o cliente.
   */
  const descartarFotos = useCallback(
    async (caminhos: readonly string[]): Promise<void> => {
      if (caminhos.length === 0) return;
      const desmarcar = marcarOperacaoSensivel(
        "descarte-de-fotos-de-devolucao",
      );
      try {
        await supabase.storage.from("devolucoes").remove([...caminhos]);
      } catch {
        // melhor esforço
      } finally {
        desmarcar();
      }
    },
    [],
  );

  const enviarFoto = useCallback(
    async (arquivo: File, userId: string): Promise<Desfecho<string>> => {
      if (!TIPOS_DE_FOTO.includes(arquivo.type)) {
        return { ok: false, erro: "Envie fotos em JPG, PNG ou WEBP." };
      }
      const desmarcar = marcarOperacaoSensivel("foto-de-devolucao");
      try {
        // Se o preparo da foto atrasar, não começa um upload após liberar a tela.
        const pronto = await comPrazo(
          redimensionarImagem(arquivo),
          PRAZO_DA_GRAVACAO_MS,
        );
        if (pronto.size > TAMANHO_MAXIMO_DA_FOTO) {
          return {
            ok: false,
            erro: "A foto passa de 5 MB. Escolha uma menor.",
          };
        }
        const caminho = caminhoDaFoto(
          userId,
          orderId,
          gerarUuidV4(),
          pronto.type,
        );
        const { error } = await comPrazo(
          supabase.storage.from("devolucoes").upload(caminho, pronto, {
            contentType: pronto.type,
            upsert: false,
          }),
          PRAZO_DO_UPLOAD_DA_FOTO_MS,
          undefined,
          (resposta) => {
            if (!resposta.error) void descartarFotos([caminho]);
          },
        );
        if (error) {
          return {
            ok: false,
            erro: mensagemDoErro(error, "Não foi possível enviar a foto."),
          };
        }
        return { ok: true, valor: caminho };
      } catch (e) {
        return {
          ok: false,
          erro:
            e instanceof PrazoEsgotado
              ? "Sem resposta da rede. Confira a conexão antes de tentar enviar a foto de novo."
              : mensagemDoErro(e, "Não foi possível enviar a foto."),
        };
      } finally {
        desmarcar();
      }
    },
    [orderId, descartarFotos],
  );

  const cancelar = useCallback(
    async (id: string): Promise<Desfecho> => {
      const desmarcar = marcarOperacaoSensivel("cancelamento-de-devolucao");
      try {
        const { data, error } = await comPrazo(
          Promise.resolve(supabase.rpc("cancelar_devolucao", { p_id: id })),
          PRAZO_DA_GRAVACAO_MS,
          undefined,
          () => {
            void carregar();
          },
        );
        if (error) {
          // O servidor recusou: o cartão na tela provavelmente está velho
          // (a loja já mudou o status). Relê para ele se corrigir sozinho.
          await carregar();
          return { ok: false, erro: mensagemDoErro(error, ERRO_GENERICO) };
        }
        await carregar();
        return lerResultadoDeStatus(data)
          ? { ok: true, valor: undefined }
          : { ok: false, erro: ERRO_GENERICO };
      } catch (e) {
        if (e instanceof PrazoEsgotado) {
          void carregar();
          return { ok: false, erro: SEM_RESPOSTA };
        }
        return { ok: false, erro: mensagemDoErro(e, ERRO_GENERICO) };
      } finally {
        desmarcar();
      }
    },
    [carregar],
  );

  const informarEnvio = useCallback(
    async (id: string, codigo: string): Promise<Desfecho> => {
      const desmarcar = marcarOperacaoSensivel("envio-de-devolucao");
      try {
        const { data, error } = await comPrazo(
          Promise.resolve(
            supabase.rpc("informar_envio_devolucao", {
              p_id: id,
              p_codigo_rastreio: codigo.trim(),
            }),
          ),
          PRAZO_DA_GRAVACAO_MS,
          undefined,
          () => {
            void carregar();
          },
        );
        if (error) {
          // O servidor recusou: o cartão na tela provavelmente está velho
          // (a loja já mudou o status). Relê para ele se corrigir sozinho.
          await carregar();
          return { ok: false, erro: mensagemDoErro(error, ERRO_GENERICO) };
        }
        await carregar();
        return lerResultadoDeStatus(data)
          ? { ok: true, valor: undefined }
          : { ok: false, erro: ERRO_GENERICO };
      } catch (e) {
        if (e instanceof PrazoEsgotado) {
          void carregar();
          return { ok: false, erro: SEM_RESPOSTA };
        }
        return { ok: false, erro: mensagemDoErro(e, ERRO_GENERICO) };
      } finally {
        desmarcar();
      }
    },
    [carregar],
  );

  const dadosSaoDesteId = idDosDados === orderId;
  return {
    elegibilidade: dadosSaoDesteId ? elegibilidade : null,
    devolucoes: dadosSaoDesteId ? devolucoes : [],
    atual: dadosSaoDesteId ? atual : null,
    carregando,
    erro: idDoErro === orderId && erro,
    recarregar: carregar,
    solicitar,
    enviarFoto,
    descartarFotos,
    cancelar,
    informarEnvio,
  };
}
