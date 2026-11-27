// O rascunho de um texto longo do painel na TELA (as regras de guardar, a
// chave por conta e a validade estão em `@/lib/rascunho-de-texto`).
//
// - Grava quando a aba fica oculta (`visibilitychange` hidden, e `pagehide`):
//   é o último aviso que o celular dá antes de descartar a aba. Texto igual
//   ao salvo apaga o rascunho (não há o que oferecer).
// - Ao abrir a tela (já com o salvo de verdade na tela), oferece restaurar.
//   O aviso fica até ela decidir (Restaurar ou Descartar) e, enquanto espera,
//   nada grava por cima do rascunho antigo — mesmo cuidado do rascunho do
//   produto. Sair da tela sem decidir tira o aviso e o rascunho fica.
// - Quem chama apaga o rascunho ao SALVAR com sucesso (`apagarRascunho`).
//   Desmontar a tela NÃO apaga nem grava: o "Descartar e Sair" do aviso de
//   saída apaga em App.tsx (`descartarRascunhoDeTexto`).
import {
  type NomeDoRascunhoDeTexto,
  apagarRascunhoDeTexto,
  chaveDoRascunhoDeTexto,
  gravarRascunhoDeTexto,
  lerRascunhoDeTexto,
} from "@/lib/rascunho-de-texto";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

/** O recado quando o texto salvo mudou (outro aparelho) depois do rascunho. */
export const AVISO_TEXTO_ALTERADO_DEPOIS =
  "O texto salvo mudou depois deste rascunho: restaurar troca o salvo pelo que você tinha digitado.";

export function useRascunhoDeTexto({
  nome,
  userId,
  texto,
  salvo,
  pronto,
  aoRestaurar,
}: {
  readonly nome: NomeDoRascunhoDeTexto;
  readonly userId: string | undefined;
  /** O que está na tela agora. */
  readonly texto: string;
  /** O que está salvo no banco. */
  readonly salvo: string;
  /** A tela já mostra o salvo de verdade (leitura concluída). */
  readonly pronto: boolean;
  readonly aoRestaurar: (texto: string) => void;
}): { readonly apagarRascunho: () => void } {
  const chave = chaveDoRascunhoDeTexto(nome, userId);
  const idDoAviso = `rascunho-de-texto-${nome}`;
  // O último render, para os ouvintes da aba e o aviso lerem sem re-registrar.
  const atual = useRef({ texto, salvo, pronto, aoRestaurar });
  useEffect(() => {
    atual.current = { texto, salvo, pronto, aoRestaurar };
  });
  const ofertaPendenteRef = useRef(false);

  useEffect(() => {
    if (!chave || !pronto) return;
    const lido = lerRascunhoDeTexto(chave);
    if (!lido) return;
    if (lido.texto === atual.current.texto) {
      apagarRascunhoDeTexto(chave);
      return;
    }
    ofertaPendenteRef.current = true;
    const decidiu = () => {
      ofertaPendenteRef.current = false;
    };
    const mudouDepois = lido.base !== atual.current.salvo;
    toast.info("Rascunho não salvo encontrado", {
      id: idDoAviso,
      description: `Deseja restaurar o texto que você digitou e não salvou?${
        mudouDepois ? ` ${AVISO_TEXTO_ALTERADO_DEPOIS}` : ""
      }`,
      action: {
        label: "Restaurar",
        onClick: () => {
          decidiu();
          atual.current.aoRestaurar(lido.texto);
        },
      },
      cancel: {
        label: "Descartar",
        onClick: () => {
          decidiu();
          apagarRascunhoDeTexto(chave);
          toast.info("Rascunho descartado.");
        },
      },
      // Fica até a decisão: sumir sozinho deixaria o rascunho sem dono.
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
    });
    return () => {
      if (!ofertaPendenteRef.current) return;
      ofertaPendenteRef.current = false;
      toast.dismiss(idDoAviso);
    };
  }, [chave, pronto, idDoAviso]);

  useEffect(() => {
    if (!chave) return;
    const guardar = () => {
      const agora = atual.current;
      // Antes da leitura a tela não mostra o salvo; com o aviso esperando,
      // gravar apagaria o rascunho antigo sem ela decidir.
      if (!agora.pronto || ofertaPendenteRef.current) return;
      if (agora.texto === agora.salvo) apagarRascunhoDeTexto(chave);
      else
        gravarRascunhoDeTexto(chave, { texto: agora.texto, base: agora.salvo });
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "hidden") guardar();
    };
    window.addEventListener("pagehide", guardar);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      window.removeEventListener("pagehide", guardar);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [chave]);

  const apagarRascunho = useCallback(() => {
    if (!chave) return;
    apagarRascunhoDeTexto(chave);
    if (ofertaPendenteRef.current) {
      ofertaPendenteRef.current = false;
      toast.dismiss(idDoAviso);
    }
  }, [chave, idDoAviso]);

  return { apagarRascunho };
}
