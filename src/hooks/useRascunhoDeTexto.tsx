import { CLASSES_DO_BOTAO_CANCELAR_DO_AVISO } from "@/components/ui/classes-do-aviso";
// O rascunho de um texto longo do painel na TELA (as regras de guardar, a
// chave por conta e a validade estão em `@/lib/rascunho-de-texto`).
//
// - Grava quando a aba fica oculta (`visibilitychange` hidden, e `pagehide`):
//   é o último aviso que o celular dá antes de descartar a aba. Texto igual
//   ao salvo apaga o rascunho (não há o que oferecer).
// - Ao abrir a tela (já com o salvo de verdade na tela), oferece restaurar.
//   O aviso fica até ela decidir (Restaurar ou Descartar) e, enquanto espera,
//   nada grava por cima do rascunho antigo — mesmo cuidado do rascunho do
//   produto. Sair da tela sem decidir tira o aviso e o rascunho fica. Tela
//   montada mas escondida (a aba Ajustes por baixo de Pedidos, ou o grupo
//   fechado: `ativo` falso) não mostra o aviso, mas a pendência vem do
//   APARELHO e não da tela: esconder a aba do navegador sem ter visto o aviso
//   não apaga o rascunho. Ao ficar à vista, o aviso aparece. O aviso não
//   fecha por gesto (`dismissible: false`): arrastá-lo deixaria a pendência
//   presa e o rascunho deixaria de ser guardado. Por isso o "Descartar" é um
//   botão próprio (`cancel` em JSX): no Sonner 2.0.8 o `cancel` comum sai
//   sem chamar o onClick quando o aviso não é dismissible.
// - O salvo pode mudar com o aviso aberto (o tempo real traz o que outro
//   aparelho gravou). "Restaurar" confere de novo: se mudou e ela ainda não
//   foi avisada, o aviso fica aberto com o recado e só o segundo toque troca.
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
  ativo = true,
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
  /** A tela está à vista (montada e escondida: `false`). */
  readonly ativo?: boolean;
  readonly aoRestaurar: (texto: string) => void;
}): { readonly apagarRascunho: () => void } {
  const chave = chaveDoRascunhoDeTexto(nome, userId);
  const idDoAviso = `rascunho-de-texto-${nome}`;
  // O último render, para os ouvintes da aba e o aviso lerem sem re-registrar.
  const atual = useRef({ texto, salvo, pronto, aoRestaurar });
  useEffect(() => {
    atual.current = { texto, salvo, pronto, aoRestaurar };
  });
  // Há rascunho antigo esperando a decisão dela (o aviso pode estar fora da
  // tela enquanto ela está em outra aba: continua esperando).
  const ofertaPendenteRef = useRef(false);
  // A conta (chave) cujo rascunho antigo já se resolveu nesta montagem: não
  // havia, era igual à tela, ou ela decidiu. Esconder e mostrar a tela depois
  // disso não reabre a pergunta sobre um rascunho que já é o texto da tela.
  const resolvidoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chave || !pronto) return;
    if (resolvidoRef.current === chave) return;
    ofertaPendenteRef.current = false;
    const lido = lerRascunhoDeTexto(chave);
    const resolveu = () => {
      ofertaPendenteRef.current = false;
      resolvidoRef.current = chave;
    };
    if (!lido) {
      resolveu();
      return;
    }
    if (lido.texto === atual.current.texto) {
      apagarRascunhoDeTexto(chave);
      resolveu();
      return;
    }
    // A pendência vem do aparelho: vale mesmo com a tela escondida.
    ofertaPendenteRef.current = true;
    if (!ativo) return;
    const decidiu = resolveu;
    const mudouDepois = () => lido.base !== atual.current.salvo;
    const oferecer = (avisouQueMudou: boolean) => {
      toast.info("Rascunho não salvo encontrado", {
        id: idDoAviso,
        description: `Deseja restaurar o texto que você digitou e não salvou?${
          avisouQueMudou ? ` ${AVISO_TEXTO_ALTERADO_DEPOIS}` : ""
        }`,
        action: {
          label: "Restaurar",
          onClick: (evento) => {
            // O salvo mudou depois de o aviso abrir: restaurar agora apagaria
            // o texto do outro aparelho sem ela saber. Avisa antes.
            if (!avisouQueMudou && mudouDepois()) {
              evento.preventDefault();
              oferecer(true);
              return;
            }
            decidiu();
            atual.current.aoRestaurar(lido.texto);
          },
        },
        // Botão próprio: o `cancel` comum não roda num aviso não dismissible.
        // A decisão vem ANTES de fechar; `toast.dismiss` fecha sem olhar o
        // dismissible.
        cancel: (
          <button
            type="button"
            data-button=""
            data-cancel=""
            className={CLASSES_DO_BOTAO_CANCELAR_DO_AVISO}
            onClick={() => {
              decidiu();
              apagarRascunhoDeTexto(chave);
              toast.dismiss(idDoAviso);
              toast.info("Rascunho descartado.");
            }}
          >
            Descartar
          </button>
        ),
        // Fica até a decisão: não some sozinho nem por gesto.
        duration: Number.POSITIVE_INFINITY,
        dismissible: false,
      });
    };
    oferecer(mudouDepois());
    return () => {
      // Sai da tela (ou da vista) sem decidir: o aviso sai, a pendência fica
      // (a próxima rodada deste efeito a refaz a partir do aparelho).
      if (ofertaPendenteRef.current) toast.dismiss(idDoAviso);
    };
  }, [chave, pronto, ativo, idDoAviso]);

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
    resolvidoRef.current = chave;
    if (ofertaPendenteRef.current) {
      ofertaPendenteRef.current = false;
      toast.dismiss(idDoAviso);
    }
  }, [chave, idDoAviso]);

  return { apagarRascunho };
}
