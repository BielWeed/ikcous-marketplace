import {
  INTERVALO_DA_CHECAGEM_MS,
  lojaSaiuDaManutencao,
  podeRecarregarSozinha,
  recarregarComPaginaNova,
  registrarRecargaSozinha,
} from "@/lib/volta-da-manutencao";
import { useEffect } from "react";

/**
 * Enquanto a tela de manutenção estiver montada, pergunta de tempos em tempos
 * se a loja já voltou e, se voltou, recarrega a página (a ficha é lida uma
 * vez por carregamento). Tudo o que importa mora em
 * `src/lib/volta-da-manutencao.ts`: a pergunta sem cache, a limpeza da cópia
 * guardada pelo service worker e a trava contra laço.
 *
 * - Para quando a tela sai do ar (o efeito desmonta): sem intervalo, sem
 *   ouvinte, e uma resposta que chegue depois não faz nada.
 * - Pergunta UMA vez na montagem: o service worker abre o app pela cópia
 *   guardada da página, que pode ser a da manutenção já encerrada — sem isso
 *   a cliente esperava 45 s olhando "manutenção" com a loja aberta. Logo
 *   depois de uma recarga feita por este hook essa pergunta não sai: a trava
 *   (90 s desde a última recarga anotada) barra antes de ir à rede.
 * - Aba escondida não gasta rede; ao voltar a ficar visível pergunta na hora.
 * - Uma pergunta por vez.
 * - Trava vencida (3 recargas em 30 min, ou menos de 90 s da última): nem
 *   pergunta — o botão "Tentar de novo" segue valendo.
 */
export function useVoltaDaManutencao(): void {
  useEffect(() => {
    let ativo = true;
    let perguntando = false;

    const checar = async () => {
      if (!ativo || perguntando) return;
      if (document.visibilityState === "hidden") return;
      if (!podeRecarregarSozinha()) return;
      perguntando = true;
      try {
        const voltou = await lojaSaiuDaManutencao();
        // A tela pode ter saído do ar enquanto a pergunta viajava.
        if (!ativo || !voltou) return;
        if (!podeRecarregarSozinha()) return;
        // Sem como anotar a recarga não há trava contra laço: não recarrega.
        if (!registrarRecargaSozinha()) return;
        ativo = false;
        await recarregarComPaginaNova();
      } finally {
        perguntando = false;
      }
    };

    void checar();
    const intervalo = setInterval(() => {
      void checar();
    }, INTERVALO_DA_CHECAGEM_MS);
    const aoVoltarAFicarVisivel = () => {
      if (document.visibilityState === "visible") void checar();
    };
    document.addEventListener("visibilitychange", aoVoltarAFicarVisivel);

    return () => {
      ativo = false;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltarAFicarVisivel);
    };
  }, []);
}
