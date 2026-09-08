import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { LinhaDevolucaoDoCliente } from "@/lib/texto-estorno-do-cliente";

const INTERVALO_DE_RECARGA_MS = 15_000;
const ESTADOS_EM_CURSO = ["solicitado", "em_processamento"] as const;

interface DevolucaoDoPedidoCliente {
  linhas: LinhaDevolucaoDoCliente[];
  carregando: boolean;
  erro: boolean;
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
  const ativoRef = useRef(true);

  const carregar = useCallback(async () => {
    if (!habilitado) return;
    setCarregando(true);
    try {
      const { data, error } = await supabase
        .from("order_refunds")
        .select("amount, status, solicitado_por, concluido_em")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (!ativoRef.current) return;

      if (error) {
        setErro(true);
        return;
      }
      setLinhas((data ?? []) as unknown as LinhaDevolucaoDoCliente[]);
      setErro(false);
    } catch {
      if (ativoRef.current) setErro(true);
    } finally {
      if (ativoRef.current) setCarregando(false);
    }
  }, [orderId, habilitado]);

  useEffect(() => {
    ativoRef.current = true;
    if (habilitado) void carregar();
    return () => {
      ativoRef.current = false;
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

  return { linhas, carregando, erro };
}
