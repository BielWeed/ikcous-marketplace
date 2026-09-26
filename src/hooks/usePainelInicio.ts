import { useAuth } from "@/hooks/useAuth";
import {
  lerAssinaturaDaLoja,
  lerPainelInicio,
  mensagemDeErroDoPainel,
} from "@/lib/crm";
import { supabase } from "@/lib/supabase";
import type { AssinaturaDaLoja, PainelInicio } from "@/types/painel";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Números do Início do painel: `painel_inicio()` + `assinatura_da_loja_ler()`.
 *
 * - Cache de MÓDULO (stale-while-revalidate): voltar ao Início mostra na hora
 *   o último retrato e revalida em segundo plano; o hover da barra
 *   (`AdminLayout`) aquece o mesmo cache por `prefetchPainelInicio`.
 * - Só busca com a tela ATIVA e sessão presente (o painel fica montado
 *   atrás das outras abas).
 * - Tempo real: um canal em `marketplace_orders` enquanto a tela está ativa;
 *   rajada de eventos vira UMA recarga (espera de 1,5 s), e aba escondida só
 *   marca "sujo" — recarrega quando volta a ficar visível.
 */

interface RetratoDoPainel {
  readonly painel: PainelInicio | null;
  readonly erroPainel: string | null;
  readonly assinatura: AssinaturaDaLoja | null;
  /** A leitura da assinatura terminou sem erro (mesmo que tenha vindo `null`). */
  readonly assinaturaLida: boolean;
  readonly erroAssinatura: string | null;
  readonly lidoEm: number;
}

const FRESCOR_MS = 30_000;
const ESPERA_DO_TEMPO_REAL_MS = 1500;
const ESPERA_DA_ABERTURA_MS = 200;

let retratoEmCache: RetratoDoPainel | null = null;
let buscaEmVoo: Promise<RetratoDoPainel> | null = null;

async function buscarRetrato(): Promise<RetratoDoPainel> {
  const [respostaPainel, respostaAssinatura] = await Promise.all([
    supabase.rpc("painel_inicio"),
    supabase.rpc("assinatura_da_loja_ler"),
  ]);

  let painel: PainelInicio | null = null;
  let erroPainel: string | null = null;
  if (respostaPainel.error) {
    console.error(
      "[usePainelInicio] painel_inicio falhou:",
      respostaPainel.error,
    );
    erroPainel = mensagemDeErroDoPainel(
      respostaPainel.error,
      "carregar os números da loja",
    );
  } else {
    painel = lerPainelInicio(respostaPainel.data);
    if (!painel) {
      erroPainel =
        "Os números da loja chegaram num formato inesperado. Tente de novo em instantes.";
    }
  }

  let assinatura: AssinaturaDaLoja | null = null;
  let erroAssinatura: string | null = null;
  if (respostaAssinatura.error) {
    console.error(
      "[usePainelInicio] assinatura_da_loja_ler falhou:",
      respostaAssinatura.error,
    );
    erroAssinatura = mensagemDeErroDoPainel(
      respostaAssinatura.error,
      "ler a assinatura",
    );
  } else {
    assinatura = lerAssinaturaDaLoja(respostaAssinatura.data);
  }

  return {
    painel,
    erroPainel,
    assinatura,
    assinaturaLida: erroAssinatura === null,
    erroAssinatura,
    lidoEm: Date.now(),
  };
}

/**
 * Uma busca por vez: chamadas simultâneas (hover + abertura + tempo real)
 * compartilham a mesma promessa em voo. A falha de rede vira retrato com
 * erro — nunca uma promessa rejeitada solta.
 */
function buscarCoalescido(): Promise<RetratoDoPainel> {
  if (buscaEmVoo) return buscaEmVoo;
  const busca = buscarRetrato()
    .catch((erro: unknown): RetratoDoPainel => {
      console.error("[usePainelInicio] busca falhou:", erro);
      const mensagem = mensagemDeErroDoPainel(erro, "carregar o Início");
      return {
        painel: null,
        erroPainel: mensagem,
        assinatura: null,
        assinaturaLida: false,
        erroAssinatura: mensagem,
        lidoEm: Date.now(),
      };
    })
    .then((retrato) => {
      // Falha não apaga o último retrato bom: os números anteriores ficam
      // na tela, com o aviso de erro por cima.
      retratoEmCache = {
        painel: retrato.painel ?? retratoEmCache?.painel ?? null,
        erroPainel: retrato.erroPainel,
        assinatura: retrato.assinaturaLida
          ? retrato.assinatura
          : (retratoEmCache?.assinatura ?? null),
        assinaturaLida:
          retrato.assinaturaLida || (retratoEmCache?.assinaturaLida ?? false),
        erroAssinatura: retrato.erroAssinatura,
        lidoEm: retrato.lidoEm,
      };
      return retratoEmCache;
    })
    .finally(() => {
      if (buscaEmVoo === busca) buscaEmVoo = null;
    });
  buscaEmVoo = busca;
  return busca;
}

/** Aquece o cache no hover da barra — não faz nada se ele ainda está fresco. */
export function prefetchPainelInicio(): void {
  if (retratoEmCache && Date.now() - retratoEmCache.lidoEm < FRESCOR_MS) return;
  void buscarCoalescido();
}

interface EstadoDoPainelInicio {
  readonly painel: PainelInicio | null;
  readonly assinatura: AssinaturaDaLoja | null;
  readonly assinaturaLida: boolean;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly erroAssinatura: string | null;
  readonly atualizar: () => Promise<void>;
}

export function usePainelInicio(active: boolean): EstadoDoPainelInicio {
  const { session } = useAuth();
  const temSessao = Boolean(session);
  const [retrato, setRetrato] = useState<RetratoDoPainel | null>(
    retratoEmCache,
  );
  const [carregando, setCarregando] = useState(false);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const carregar = useCallback(async (forcar: boolean) => {
    if (
      !forcar &&
      retratoEmCache &&
      Date.now() - retratoEmCache.lidoEm < FRESCOR_MS
    ) {
      setRetrato(retratoEmCache);
      return;
    }
    setCarregando(true);
    try {
      const novo = await buscarCoalescido();
      if (montadoRef.current) setRetrato(novo);
    } finally {
      if (montadoRef.current) setCarregando(false);
    }
  }, []);

  const atualizar = useCallback(() => carregar(true), [carregar]);

  // Abertura: um respiro curto deixa a transição de aba terminar antes da
  // rede (mesma ideia do atraso do dashboard antigo).
  useEffect(() => {
    if (!active || !temSessao) return;
    const timer = setTimeout(() => {
      void carregar(false);
    }, ESPERA_DA_ABERTURA_MS);
    return () => clearTimeout(timer);
  }, [active, temSessao, carregar]);

  // Tempo real em marketplace_orders — só com a tela ativa.
  useEffect(() => {
    if (!active || !temSessao) return;
    let espera: ReturnType<typeof setTimeout> | null = null;
    let sujoEscondido = false;

    const recarregarJa = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => {
        espera = null;
        void carregar(true);
      }, ESPERA_DO_TEMPO_REAL_MS);
    };

    const aoMudarPedido = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        sujoEscondido = true;
        return;
      }
      recarregarJa();
    };

    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "visible" && sujoEscondido) {
        sujoEscondido = false;
        recarregarJa();
      }
    };

    const canal = supabase
      .channel("admin-inicio-pedidos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "marketplace_orders" },
        aoMudarPedido,
      )
      .subscribe();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      if (espera) clearTimeout(espera);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      supabase.removeChannel(canal);
    };
  }, [active, temSessao, carregar]);

  return {
    painel: retrato?.painel ?? null,
    assinatura: retrato?.assinatura ?? null,
    assinaturaLida: retrato?.assinaturaLida ?? false,
    // "Carregando" de verdade é não ter número nenhum ainda: com retrato em
    // mãos, a revalidação acontece por baixo sem esqueleto.
    carregando: carregando || (retrato === null && active && temSessao),
    erro: retrato?.erroPainel ?? null,
    erroAssinatura: retrato?.erroAssinatura ?? null,
    atualizar,
  };
}
