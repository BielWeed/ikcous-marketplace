import { useCallback, useEffect, useRef, useState } from "react";

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
import type {
  DevolucaoDetalhe,
  ElegibilidadeDevolucao,
  MetodoDevolucao,
  MotivoDevolucao,
  ResolucaoDevolucao,
  ResultadoSolicitacao,
  ResumoDevolucao,
} from "@/types/devolucao";

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
  cancelar: (id: string) => Promise<Desfecho>;
  informarEnvio: (id: string, codigo: string) => Promise<Desfecho>;
}

const ERRO_GENERICO = "Não foi possível concluir agora. Tente de novo.";

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
 * `notificacoes` (gatilho da migration); a tela relê ao abrir e após cada
 * ação dela.
 */
export function useDevolucaoCliente(
  orderId: string,
  habilitado: boolean,
): DevolucaoDoCliente {
  const [elegibilidade, setElegibilidade] =
    useState<ElegibilidadeDevolucao | null>(null);
  const [devolucoes, setDevolucoes] = useState<ResumoDevolucao[]>([]);
  const [atual, setAtual] = useState<DevolucaoDetalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const ativoRef = useRef(true);
  // Rodada da leitura: a resposta velha que chega depois da nova não pinta
  // a tela (mesmo padrão de useAvisosDoLojista).
  const rodadaRef = useRef(0);

  const carregar = useCallback(async () => {
    if (!habilitado) return;
    const rodada = ++rodadaRef.current;
    const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
    setCarregando(true);
    try {
      const [respElegibilidade, respLista] = await Promise.all([
        supabase.rpc("devolucao_elegibilidade", { p_order_id: orderId }),
        supabase.rpc("devolucoes_do_pedido", { p_order_id: orderId }),
      ]);
      if (!valeAinda()) return;
      if (respElegibilidade.error || respLista.error) {
        setErro(true);
        return;
      }
      const lida = lerElegibilidade(respElegibilidade.data);
      const lista = lerDevolucoesDoPedido(respLista.data);
      if (!lida || !lista) {
        setErro(true);
        return;
      }

      let detalhe: DevolucaoDetalhe | null = null;
      if (lista.length > 0) {
        const respDetalhe = await supabase.rpc("devolucao_detalhe", {
          p_id: lista[0].id,
        });
        if (!valeAinda()) return;
        detalhe = respDetalhe.error
          ? null
          : lerDevolucaoDetalhe(respDetalhe.data);
        if (!detalhe) {
          setErro(true);
          return;
        }
      }

      setElegibilidade(lida);
      setDevolucoes(lista);
      setAtual(detalhe);
      setErro(false);
    } catch {
      // Inclui o cliente sem `rpc` (dublê de teste antigo) e a rede caída:
      // "não consegui ler" nunca vira "não tem devolução".
      if (valeAinda()) setErro(true);
    } finally {
      if (valeAinda()) setCarregando(false);
    }
  }, [orderId, habilitado]);

  useEffect(() => {
    ativoRef.current = true;
    if (habilitado) void carregar();
    return () => {
      ativoRef.current = false;
    };
  }, [habilitado, carregar]);

  const solicitar = useCallback(
    async (
      dados: DadosDaSolicitacao,
    ): Promise<Desfecho<ResultadoSolicitacao>> => {
      try {
        const { data, error } = await supabase.rpc("solicitar_devolucao", {
          p_order_id: orderId,
          p_itens: dados.itens,
          p_motivo: dados.motivo,
          p_detalhe: dados.detalhe.trim() || null,
          p_resolucao: dados.resolucao,
          p_metodo: dados.metodo,
          p_fotos: dados.fotos,
        });
        if (error)
          return { ok: false, erro: mensagemDoErro(error, ERRO_GENERICO) };
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
        return { ok: false, erro: mensagemDoErro(e, ERRO_GENERICO) };
      }
    },
    [orderId, carregar],
  );

  const enviarFoto = useCallback(
    async (arquivo: File, userId: string): Promise<Desfecho<string>> => {
      if (!TIPOS_DE_FOTO.includes(arquivo.type)) {
        return { ok: false, erro: "Envie fotos em JPG, PNG ou WEBP." };
      }
      // Fail-open: sem redimensionar (navegador antigo), sobe o original.
      const pronto = await redimensionarImagem(arquivo);
      if (pronto.size > TAMANHO_MAXIMO_DA_FOTO) {
        return { ok: false, erro: "A foto passa de 5 MB. Escolha uma menor." };
      }
      const caminho = caminhoDaFoto(
        userId,
        orderId,
        crypto.randomUUID(),
        pronto.type,
      );
      try {
        const { error } = await supabase.storage
          .from("devolucoes")
          .upload(caminho, pronto, { contentType: pronto.type, upsert: false });
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
          erro: mensagemDoErro(e, "Não foi possível enviar a foto."),
        };
      }
    },
    [orderId],
  );

  const cancelar = useCallback(
    async (id: string): Promise<Desfecho> => {
      try {
        const { data, error } = await supabase.rpc("cancelar_devolucao", {
          p_id: id,
        });
        if (error)
          return { ok: false, erro: mensagemDoErro(error, ERRO_GENERICO) };
        await carregar();
        return lerResultadoDeStatus(data)
          ? { ok: true, valor: undefined }
          : { ok: false, erro: ERRO_GENERICO };
      } catch (e) {
        return { ok: false, erro: mensagemDoErro(e, ERRO_GENERICO) };
      }
    },
    [carregar],
  );

  const informarEnvio = useCallback(
    async (id: string, codigo: string): Promise<Desfecho> => {
      try {
        const { data, error } = await supabase.rpc("informar_envio_devolucao", {
          p_id: id,
          p_codigo_rastreio: codigo.trim(),
        });
        if (error)
          return { ok: false, erro: mensagemDoErro(error, ERRO_GENERICO) };
        await carregar();
        return lerResultadoDeStatus(data)
          ? { ok: true, valor: undefined }
          : { ok: false, erro: ERRO_GENERICO };
      } catch (e) {
        return { ok: false, erro: mensagemDoErro(e, ERRO_GENERICO) };
      }
    },
    [carregar],
  );

  return {
    elegibilidade,
    devolucoes,
    atual,
    carregando,
    erro,
    recarregar: carregar,
    solicitar,
    enviarFoto,
    cancelar,
    informarEnvio,
  };
}
