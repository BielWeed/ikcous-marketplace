import {
  COLUNAS_DO_PEDIDO_DA_CLIENTE,
  type FalhaDoPedido,
  type PedidoDePrivacidade,
  type TipoDoPedidoDePrivacidade,
  classificarFalhaDoPedido,
  lerPedidosDePrivacidade,
} from "@/lib/pedidos-de-privacidade";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Os pedidos de privacidade DA CLIENTE (tabela `pedidos_de_privacidade`): ler os
 * dela e abrir um novo. Quem protege é a RLS do banco (só os dela, só em nome
 * dela, um aberto por tipo); este hook só leva o pedido e traduz a falha.
 *
 * Nada aqui apaga dado nem mexe na conta: o pedido é um REGISTRO que a loja
 * atende à mão.
 */

export type CargaDosPedidos = "carregando" | "pronta" | "erro";

export type ResultadoDoPedido =
  | { ok: true; pedido: PedidoDePrivacidade }
  | { ok: false; falha: FalhaDoPedido };

export interface UsePedidosDePrivacidade {
  readonly carga: CargaDosPedidos;
  readonly pedidos: readonly PedidoDePrivacidade[];
  /** O tipo que está sendo enviado agora (um por vez), ou `null`. */
  readonly enviando: TipoDoPedidoDePrivacidade | null;
  recarregar: () => Promise<void>;
  pedir: (
    tipo: TipoDoPedidoDePrivacidade,
    emailNovo?: string,
  ) => Promise<ResultadoDoPedido>;
}

export function usePedidosDePrivacidade(
  userId: string | null | undefined,
): UsePedidosDePrivacidade {
  const [carga, setCarga] = useState<CargaDosPedidos>("carregando");
  const [pedidos, setPedidos] = useState<PedidoDePrivacidade[]>([]);
  const [enviando, setEnviando] = useState<TipoDoPedidoDePrivacidade | null>(
    null,
  );
  const ativoRef = useRef(true);
  const enviandoRef = useRef(false);
  // Número da leitura: a resposta de uma leitura velha não passa por cima da nova.
  const rodadaRef = useRef(0);

  const recarregar = useCallback(async () => {
    if (!userId) return;
    const rodada = ++rodadaRef.current;
    setCarga("carregando");
    try {
      // `.eq("user_id", userId)` é redundante com a RLS de propósito: se a
      // política um dia afrouxar, a tela da cliente continua só com os dela.
      const { data, error } = await supabase
        .from("pedidos_de_privacidade")
        .select(COLUNAS_DO_PEDIDO_DA_CLIENTE)
        .eq("user_id", userId)
        .order("criado_em", { ascending: false });
      if (!ativoRef.current || rodada !== rodadaRef.current) return;
      if (error) {
        setCarga("erro");
        return;
      }
      setPedidos(lerPedidosDePrivacidade(data));
      setCarga("pronta");
    } catch {
      if (!ativoRef.current || rodada !== rodadaRef.current) return;
      setCarga("erro");
    }
  }, [userId]);

  useEffect(() => {
    ativoRef.current = true;
    void recarregar();
    return () => {
      ativoRef.current = false;
    };
  }, [recarregar]);

  const pedir = useCallback(
    async (
      tipo: TipoDoPedidoDePrivacidade,
      emailNovo?: string,
    ): Promise<ResultadoDoPedido> => {
      if (!userId) return { ok: false, falha: "sem_sessao" };
      // Clique duplo não manda dois pedidos (o banco também barra o segundo).
      if (enviandoRef.current) return { ok: false, falha: "ja_existe" };
      enviandoRef.current = true;
      setEnviando(tipo);
      try {
        const { data, error } = await supabase
          .from("pedidos_de_privacidade")
          .insert({
            user_id: userId,
            tipo,
            email_novo: tipo === "corrigir_email" ? (emailNovo ?? null) : null,
          })
          .select(COLUNAS_DO_PEDIDO_DA_CLIENTE)
          .single();
        if (error) {
          const falha = classificarFalhaDoPedido(error);
          // Já existe um aberto (outra aba, outro aparelho): a tela passa a mostrá-lo.
          if (falha === "ja_existe") await recarregar();
          return { ok: false, falha };
        }
        const [criado] = lerPedidosDePrivacidade([data]);
        if (!criado) {
          // Gravou, mas a resposta veio em forma que não entendemos: relê.
          await recarregar();
          return { ok: false, falha: "outra" };
        }
        if (ativoRef.current) {
          setPedidos((antes) => [
            criado,
            ...antes.filter((p) => p.id !== criado.id),
          ]);
          setCarga("pronta");
        }
        return { ok: true, pedido: criado };
      } catch (erro) {
        return { ok: false, falha: classificarFalhaDoPedido(erro) };
      } finally {
        enviandoRef.current = false;
        if (ativoRef.current) setEnviando(null);
      }
    },
    [userId, recarregar],
  );

  return { carga, pedidos, enviando, recarregar, pedir };
}
