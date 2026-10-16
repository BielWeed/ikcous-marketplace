import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { LinhaDevolucaoDoCliente } from "@/lib/texto-estorno-do-cliente";

const INTERVALO_DE_RECARGA_MS = 15_000;
const ESTADOS_EM_CURSO = ["solicitado", "em_processamento"] as const;
// Enquanto a PRIMEIRA leitura não deu certo, tenta de novo (rede que oscilou)
// antes de desistir: a tela precisa de uma resposta honesta, e "ainda não sei"
// não pode durar para sempre nem virar "fale com a loja" só porque a primeira
// tentativa caiu.
const TENTATIVAS_ATE_DESISTIR = 3;
const ATRASO_DA_NOVA_TENTATIVA_MS = 4_000;

interface DevolucaoDoPedidoCliente {
  linhas: LinhaDevolucaoDoCliente[];
  carregando: boolean;
  erro: boolean;
  /**
   * A leitura deste pedido já deu certo ao menos uma vez. Antes disso,
   * `linhas: []` NÃO quer dizer "sem devolução" — quer dizer "ainda não sei".
   */
  lido: boolean;
  /**
   * Todas as tentativas da primeira leitura falharam: "não sei" virou "não
   * consegui saber". Só vale enquanto `lido` for falso.
   */
  desistiu: boolean;
}

/**
 * Lê `order_refunds` do pedido para a TELA DO CLIENTE (T7 do plano-mãe
 * `20260907-plano-estorno-pelo-app.md`). Deliberadamente menor que
 * `useEstornosDoPedido.ts` (o hook do PAINEL): só as 4 colunas que o cliente
 * pode ver (`amount, status, solicitado_por, concluido_em` — a policy
 * `order_refunds_cliente_le` libera as linhas do próprio pedido) e nada de
 * `mp_status`/`ultimo_erro`/`tentativas`, que são vocabulário do lojista.
 *
 * SEM REALTIME (mesma razão do hook do painel): `order_refunds` não está na
 * publication `supabase_realtime`. Recarrega ao montar e, ENQUANTO houver
 * linha `solicitado`/`em_processamento`, a cada 15s; o intervalo some
 * sozinho quando a última linha ativa se resolve, e é limpo no unmount.
 *
 * `habilitado`: quem chama decide SE deve ler (só faz sentido para pedido
 * `cancelled` e pago online) — mas o hook em si é sempre chamado, incondi-
 * cional, porque React proíbe hook atrás de `if` no componente. Com
 * `habilitado=false` ele não busca nada e não agenda nada.
 */
export function useDevolucaoDoPedidoCliente(
  orderId: string,
  habilitado: boolean,
): DevolucaoDoPedidoCliente {
  const [linhas, setLinhas] = useState<LinhaDevolucaoDoCliente[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [idDoErro, setIdDoErro] = useState<string | null>(null);
  // Qual pedido já teve uma leitura bem-sucedida (guarda o id, não um
  // booleano: trocar de pedido volta a "ainda não sei").
  const [lidoDoPedido, setLidoDoPedido] = useState<string | null>(null);
  const [desistiuDe, setDesistiuDe] = useState<string | null>(null);
  // A nova tentativa chama sempre a versão mais recente de `carregar` (o
  // `setTimeout` guardaria a do render em que foi agendado).
  const carregarRef = useRef<() => Promise<void>>(async () => {});
  const lidoRef = useRef<string | null>(null);
  const falhasRef = useRef(0);
  const novaTentativaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ativoRef = useRef(true);

  // Rodada da leitura: a resposta do orderId antigo que chega depois da nova
  // não pinta a tela (mesmo padrão de useDevolucaoCliente).
  const rodadaRef = useRef(0);

  const carregar = useCallback(async () => {
    if (!habilitado) return;
    const rodada = ++rodadaRef.current;
    const valeAinda = () => ativoRef.current && rodada === rodadaRef.current;
    setCarregando(true);
    // Falha: mostra o erro; se ainda não houve leitura boa deste pedido,
    // tenta de novo algumas vezes e só então desiste. Depois de uma leitura
    // boa, a falha de uma volta do relógio não apaga o que já se sabe.
    const aoFalhar = () => {
      setIdDoErro(orderId);
      setErro(true);
      if (lidoRef.current === orderId) return;
      falhasRef.current += 1;
      if (falhasRef.current >= TENTATIVAS_ATE_DESISTIR) {
        setDesistiuDe(orderId);
        return;
      }
      novaTentativaRef.current = setTimeout(() => {
        void carregarRef.current();
      }, ATRASO_DA_NOVA_TENTATIVA_MS);
    };
    try {
      const { data, error } = await supabase
        .from("order_refunds")
        .select("amount, status, solicitado_por, concluido_em")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (!valeAinda()) return;

      if (error) {
        aoFalhar();
        return;
      }
      setLinhas((data ?? []) as unknown as LinhaDevolucaoDoCliente[]);
      setErro(false);
      lidoRef.current = orderId;
      falhasRef.current = 0;
      setLidoDoPedido(orderId);
      setDesistiuDe(null);
    } catch {
      if (valeAinda()) aoFalhar();
    } finally {
      if (valeAinda()) setCarregando(false);
    }
  }, [orderId, habilitado]);

  useEffect(() => {
    carregarRef.current = carregar;
  }, [carregar]);

  useEffect(() => {
    ativoRef.current = true;
    falhasRef.current = 0;
    setDesistiuDe(null);
    if (habilitado) void carregar();
    return () => {
      ativoRef.current = false;
      if (novaTentativaRef.current) clearTimeout(novaTentativaRef.current);
    };
  }, [habilitado, carregar]);

  const temLinhaAtiva = linhas.some((linha) =>
    (ESTADOS_EM_CURSO as readonly string[]).includes(linha.status),
  );

  // O intervalo só existe enquanto houver linha ativa: pedido totalmente
  // resolvido (tudo `concluido`/`falhou`/`recusado`) para de recarregar
  // sozinho — não há nada em voo para confirmar a cada 15s.
  useEffect(() => {
    if (!habilitado || !temLinhaAtiva) return;
    const id = setInterval(() => {
      void carregar();
    }, INTERVALO_DE_RECARGA_MS);
    return () => clearInterval(id);
  }, [habilitado, temLinhaAtiva, carregar]);

  const lido = lidoDoPedido === orderId;
  return {
    linhas,
    carregando,
    erro: idDoErro === orderId && erro,
    lido,
    desistiu: !lido && desistiuDe === orderId,
  };
}
