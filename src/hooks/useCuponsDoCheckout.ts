import {
  type CupomDisponivel,
  lerCuponsDoCheckout,
} from "@/lib/cupons-do-checkout";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A lista de cupons que o checkout mostra (RPC `cupons_do_checkout`,
 * migration 20261187000000). O servidor filtra QUEM vê o quê — este hook só
 * busca, descarta resposta atrasada e diz em que pé está.
 *
 * - `indisponivel`: a loja desligou os cupons, ou o banco ainda não tem a RPC
 *   (front novo publicado antes da migration — PGRST202). A seção cai no
 *   campo de digitar de sempre, sem aviso nenhum.
 * - `erro`: a consulta falhou (rede). A seção oferece "Tentar de novo"; o
 *   campo de digitar continua funcionando.
 * - Mudou o subtotal: busca de novo depois de uma pausa curta (quem mexe na
 *   quantidade não dispara uma consulta por toque), MANTENDO a lista de antes
 *   na tela até a nova chegar.
 * - Mudou a conta (entrou/saiu): busca na hora — o exclusivo de uma conta
 *   nunca fica na tela da outra (a lista velha é apagada antes).
 */
export type SituacaoDosCupons =
  | "carregando"
  | "pronto"
  | "erro"
  | "indisponivel";

interface Parametros {
  readonly subtotal: number;
  readonly userId: string | null;
  readonly ligado: boolean;
}

const PAUSA_DO_SUBTOTAL_MS = 400;

/** Cliente sem Supabase (build sem banco, dublês de teste): nem tenta. */
function semCliente(): boolean {
  return typeof (supabase as { rpc?: unknown } | undefined)?.rpc !== "function";
}

/** Função inexistente no banco (PostgREST) ou rota 404: banco antigo. */
function ehRpcAusente(erro: { code?: string; status?: number } | null) {
  return erro?.code === "PGRST202" || erro?.status === 404;
}

export function useCuponsDoCheckout({ subtotal, userId, ligado }: Parametros) {
  const [cupons, setCupons] = useState<CupomDisponivel[]>([]);
  const [situacao, setSituacao] = useState<SituacaoDosCupons>(
    ligado && !semCliente() ? "carregando" : "indisponivel",
  );
  const rodadaRef = useRef(0);
  const contaRef = useRef<string | null>(userId);
  const ausenteRef = useRef(semCliente());

  const buscar = useCallback(async (valor: number) => {
    const rodada = ++rodadaRef.current;
    try {
      const { data, error } = await supabase.rpc("cupons_do_checkout", {
        p_subtotal: Math.max(Number.isFinite(valor) ? valor : 0, 0),
      });
      if (rodada !== rodadaRef.current) return;
      if (error) {
        if (ehRpcAusente(error as { code?: string; status?: number })) {
          ausenteRef.current = true;
          setCupons((antes) => (antes.length === 0 ? antes : []));
          setSituacao("indisponivel");
          return;
        }
        setSituacao("erro");
        return;
      }
      setCupons(lerCuponsDoCheckout(data));
      setSituacao("pronto");
    } catch {
      // Lançar (em vez de devolver `error`) é defeito de programação ou
      // cliente sem Supabase (testes) — a seção fica só com o campo.
      if (rodada !== rodadaRef.current) return;
      setCupons((antes) => (antes.length === 0 ? antes : []));
      setSituacao("indisponivel");
    }
  }, []);

  // Conta nova: a lista da conta anterior some NA HORA.
  useEffect(() => {
    if (contaRef.current === userId) return;
    contaRef.current = userId;
    rodadaRef.current++;
    setCupons((antes) => (antes.length === 0 ? antes : []));
    if (ligado && !ausenteRef.current) setSituacao("carregando");
  }, [userId, ligado]);

  useEffect(() => {
    if (!ligado || ausenteRef.current) {
      rodadaRef.current++;
      setCupons((antes) => (antes.length === 0 ? antes : []));
      setSituacao("indisponivel");
      return;
    }
    const espera = setTimeout(() => {
      void buscar(subtotal);
    }, PAUSA_DO_SUBTOTAL_MS);
    return () => clearTimeout(espera);
    // `userId` entra para a conta nova buscar de novo.
  }, [subtotal, userId, ligado, buscar]);

  const tentarDeNovo = useCallback(() => {
    if (!ligado || ausenteRef.current) return;
    setSituacao("carregando");
    void buscar(subtotal);
  }, [buscar, subtotal, ligado]);

  return { cupons, situacao, tentarDeNovo };
}
