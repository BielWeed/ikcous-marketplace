/**
 * O INSTALADOR NO PONTO DE PARADA — decide QUANDO recarregar o app para a
 * versão nova (atualização única e obrigatória, 16/10/2026).
 *
 * A atualização é obrigatória e sem botão de recusar, então toda a proteção da
 * pessoa mora aqui, em camadas que não dependem umas das outras:
 *
 *   1. VETO LOCAL (a que protege os dados): esta aba só recarrega se o
 *      momento dela é seguro — fora das telas de compra, sem pedido pendente,
 *      sem trabalho não salvo, sem operação sensível, passada a inicialização.
 *      Vale também no modo "so-recarregar" (o SW já assumiu; é o `onNeedReload`).
 *   2. PONTO DE PARADA: dentro do que é seguro, só instala quando a tela muda
 *      ou o app vai para segundo plano. É oportunidade, nunca licença.
 *   3. OUTRAS ABAS (cortesia): antes de acionar o service worker, olha se algum
 *      par anunciou "ocupada" (coordenacao-entre-abas.ts).
 *   4. EXCLUSÃO + TRAVA: uma aba por vez (reserva no localStorage), no máximo 2
 *      tentativas por versão-alvo, gravadas e confirmadas. Storage que não
 *      confirma = não instala.
 *   5. NUNCA PRESO: "instalando" que não vira recarga em 15 s volta a
 *      "aguardando" (a tentativa já contou na trava).
 *
 * O hook não sabe NADA do service worker nem do useUpdateCheck: recebe `instalar`
 * por parâmetro. Assim a regra inteira é testável sem o módulo virtual do PWA.
 */
import { useEffect, useRef } from "react";

import { existeAlgumPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";

import {
  type CanalDeAbas,
  criarCoordenacaoEntreAbas,
} from "./coordenacao-entre-abas";
import {
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
} from "./estado-da-atualizacao";
import {
  soltarReservaDeInstalacao,
  tomarReservaDeInstalacao,
} from "./exclusao-de-instalacao";
import { decidirMomentoSeguro } from "./momento-seguro";
import {
  assinarOperacoesSensiveis,
  haOperacaoSensivel,
} from "./operacao-sensivel";
import { podeTentarAtualizar, reservarTentativa } from "./trava-anti-repeticao";

/** Se a recarga não aconteceu neste prazo (beforeunload cancelou, o SW não
 * assumiu, página congelada), a fase volta a "aguardando". */
export const PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS = 15_000;

/** Nenhuma instalação nos primeiros segundos depois de montar o gate: o PDV e
 * outros restauram rascunhos DEPOIS do boot, e antes disso o app ainda não
 * sabe o que está em andamento. */
export const GRACA_DE_INICIALIZACAO_MS = 8000;

export interface OpcoesDoInstalador {
  /** Há atualização esperando (needRefresh, ou obrigatória, ou SW já assumiu). */
  ativo: boolean;
  /** "instalar": aciona o SW (coordena abas, trava, reserva). "so-recarregar":
   * o SW já assumiu — só falta recarregar esta aba, com o veto local. */
  modo: "instalar" | "so-recarregar";
  /** A chave da trava de tentativas (a versão-alvo). */
  alvo: string;
  /** O núcleo semver legível mostrado no estado (nulo = sem versão legível). */
  versaoNova: string | null;
  view: string;
  adminDirty: boolean;
  /** Executa a instalação/recarga. Pode lançar ou rejeitar: a fase se solta. */
  instalar: () => void | Promise<void>;
  /** Atualização obrigatória no boot: o ponto de parada já está satisfeito
   * (os vetos continuam valendo). */
  pontoDeParadaInicial?: boolean;
  prazoDeSegurancaMs?: number;
  gracaDeInicializacaoMs?: number;
  /** Para teste: o canal de abas (null = sem suporte). */
  fabricaDeCanal?: (nome: string) => CanalDeAbas | null;
}

type MotivoDaTentativa = "troca" | "oculto" | "inicial";

function documentoEstaOculto(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export function useInstaladorNoPontoDeParada(opcoes: OpcoesDoInstalador): void {
  // O que as funções de longa vida (ouvintes, timers, promessas) precisam ler
  // SEMPRE no valor mais novo — nunca o de quando foram criadas.
  const vivo = useRef(opcoes);
  const viewAnterior = useRef(opcoes.view);
  const adminDirtyAnterior = useRef(opcoes.adminDirty);
  const acoes = useRef<{
    tentar: (motivo: MotivoDaTentativa) => void;
    anunciar: () => void;
    /** Nova versão-alvo (ou nova armação): a desistência anterior não vale. */
    rearmar: () => void;
  } | null>(null);
  const armou = useRef(false);

  useEffect(() => {
    vivo.current = opcoes;
  });

  // ─── Montagem: coordenação, ouvintes, timers ───────────────────────────────
  useEffect(() => {
    let cancelado = false;
    const montadoEm = Date.now();
    let instalando = false;
    let inicioDaInstalacao = 0;
    let emVoo = false;
    let desistiu = false;
    let temporizadorDoPrazo: ReturnType<typeof setTimeout> | null = null;
    let temporizadorDaGraca: ReturnType<typeof setTimeout> | null = null;

    const graca = () =>
      vivo.current.gracaDeInicializacaoMs ?? GRACA_DE_INICIALIZACAO_MS;
    const prazo = () =>
      vivo.current.prazoDeSegurancaMs ?? PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS;
    const inicializada = () => Date.now() - montadoEm >= graca();

    const decidir = (trocouDeTela: boolean) =>
      decidirMomentoSeguro({
        view: vivo.current.view,
        adminDirty: vivo.current.adminDirty,
        pedidoPendenteDoCheckout: existeAlgumPedidoPendenteDoCheckout(),
        documentoOculto: documentoEstaOculto(),
        trocouDeTela,
        operacaoSensivel: haOperacaoSensivel(),
      });

    // O estado que esta aba anuncia às outras: livre E já inicializada.
    const coordenacao = criarCoordenacaoEntreAbas({
      estaLivre: () => decidir(false).livre && inicializada(),
      fabricaDeCanal: vivo.current.fabricaDeCanal,
    });

    const soltarFase = () => {
      // Só mexe no estado global se foi ESTA instância que o armou.
      if (!armou.current) return;
      const fase = obterEstadoDaAtualizacao().fase;
      if (fase === "aguardando" || fase === "instalando") {
        definirEstadoDaAtualizacao({ fase: "nenhuma" });
      }
    };

    const desistir = () => {
      // Trava esgotada (ou sem como contar): desiste em silêncio. O app segue
      // na versão que tem.
      desistiu = true;
      soltarFase();
    };

    const falhou = () => {
      if (!instalando) return;
      instalando = false;
      if (temporizadorDoPrazo !== null) {
        clearTimeout(temporizadorDoPrazo);
        temporizadorDoPrazo = null;
      }
      soltarReservaDeInstalacao(coordenacao.id);
      if (cancelado) return;
      if (vivo.current.ativo && armou.current) {
        definirEstadoDaAtualizacao({
          fase: "aguardando",
          versaoNova: vivo.current.versaoNova,
        });
      }
    };

    // Chamada pelo timer E ao voltar para a tela: página congelada em segundo
    // plano (iOS) não dispara o timer, mas o relógio andou.
    const verificarSePreso = () => {
      if (instalando && Date.now() - inicioDaInstalacao >= prazo()) falhou();
    };

    const iniciar = () => {
      const c = vivo.current;
      instalando = true;
      inicioDaInstalacao = Date.now();
      definirEstadoDaAtualizacao({
        fase: "instalando",
        versaoNova: c.versaoNova,
      });
      temporizadorDoPrazo = setTimeout(verificarSePreso, prazo());
      try {
        const resultado = c.instalar();
        if (
          resultado &&
          typeof (resultado as Promise<void>).then === "function"
        ) {
          (resultado as Promise<void>).then(undefined, () => falhou());
        }
      } catch {
        falhou();
      }
    };

    const agendarGraca = (motivo: MotivoDaTentativa, restanteMs: number) => {
      if (temporizadorDaGraca !== null) clearTimeout(temporizadorDaGraca);
      temporizadorDaGraca = setTimeout(() => {
        temporizadorDaGraca = null;
        tentar(motivo);
      }, restanteMs);
    };

    const tentar = (motivo: MotivoDaTentativa): void => {
      const c = vivo.current;
      if (cancelado || !c.ativo || desistiu || instalando || emVoo) return;

      const restante = graca() - (Date.now() - montadoEm);
      if (restante > 0) {
        agendarGraca(motivo, restante);
        return;
      }

      // "troca" e "inicial" são eventos já ocorridos (travam o ponto de
      // parada); "oculto" é lido ao vivo: se a pessoa já voltou, passou.
      const inicial = decidir(motivo !== "oculto");
      if (!inicial.instalarAgora) return;

      if (c.modo === "so-recarregar") {
        iniciar();
        return;
      }
      if (!podeTentarAtualizar(c.alvo)) {
        desistir();
        return;
      }

      emVoo = true;
      void coordenacao
        .perguntarSeTodasLivres()
        .then((paresLivres) => {
          if (cancelado) return;
          const agora = vivo.current;
          if (!agora.ativo || desistiu || instalando) return;
          // Reavalia com o mundo de AGORA: nos 300 ms da consulta a pessoa pode
          // ter entrado no carrinho ou sujado o formulário.
          if (!decidir(true).livre) return;
          if (agora.modo === "so-recarregar") {
            iniciar();
            return;
          }
          if (!paresLivres) return;
          if (!tomarReservaDeInstalacao(coordenacao.id)) return;
          if (!reservarTentativa(agora.alvo)) {
            soltarReservaDeInstalacao(coordenacao.id);
            if (!podeTentarAtualizar(agora.alvo)) desistir();
            return;
          }
          iniciar();
        })
        .catch(() => {
          // Defeito inesperado na decisão: não instala e não vira rejeição
          // não tratada (a próxima parada reavalia).
        })
        .finally(() => {
          emVoo = false;
        });
    };

    acoes.current = {
      tentar,
      anunciar: () => coordenacao.anunciar(),
      rearmar: () => {
        desistiu = false;
      },
    };

    const aoMudarVisibilidade = () => {
      if (documentoEstaOculto()) {
        tentar("oculto");
      } else {
        verificarSePreso();
      }
      coordenacao.anunciar();
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    const desassinarOperacoes = assinarOperacoesSensiveis(() =>
      coordenacao.anunciar(),
    );

    return () => {
      cancelado = true;
      acoes.current = null;
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      desassinarOperacoes();
      if (temporizadorDoPrazo !== null) clearTimeout(temporizadorDoPrazo);
      if (temporizadorDaGraca !== null) clearTimeout(temporizadorDaGraca);
      soltarReservaDeInstalacao(coordenacao.id);
      coordenacao.fechar();
      soltarFase();
      armou.current = false;
    };
  }, []);

  // ─── Armar/desarmar a espera conforme a atualização existe ─────────────────
  const { ativo, modo, alvo, versaoNova, pontoDeParadaInicial } = opcoes;
  useEffect(() => {
    if (!ativo) {
      if (armou.current) {
        const fase = obterEstadoDaAtualizacao().fase;
        if (fase === "aguardando")
          definirEstadoDaAtualizacao({ fase: "nenhuma" });
      }
      armou.current = false;
      return;
    }
    acoes.current?.rearmar();
    // Trava já esgotada (ou sem como contar): nem arma, a pessoa não vê nada.
    if (modo === "instalar" && !podeTentarAtualizar(alvo)) {
      armou.current = false;
      return;
    }
    armou.current = true;
    if (obterEstadoDaAtualizacao().fase !== "instalando") {
      definirEstadoDaAtualizacao({ fase: "aguardando", versaoNova });
    }
    if (pontoDeParadaInicial) {
      acoes.current?.tentar("inicial");
    } else if (documentoEstaOculto()) {
      acoes.current?.tentar("oculto");
    }
  }, [ativo, modo, alvo, versaoNova, pontoDeParadaInicial]);

  // ─── A tela mudou: ponto de parada; e o estado novo é anunciado ────────────
  const { view, adminDirty } = opcoes;
  useEffect(() => {
    const trocou = viewAnterior.current !== view;
    const mudouDirty = adminDirtyAnterior.current !== adminDirty;
    viewAnterior.current = view;
    adminDirtyAnterior.current = adminDirty;
    if (trocou || mudouDirty) acoes.current?.anunciar();
    if (trocou) acoes.current?.tentar("troca");
  }, [view, adminDirty]);
}
