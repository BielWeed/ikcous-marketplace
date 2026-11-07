import { useCallback, useMemo, useRef } from "react";

/**
 * Para onde vai o foco do teclado quando a pergunta "Excluir ...?" fecha.
 *
 * O Radix só devolve o foco ao botão que ABRIU a janela quando existe um
 * `Trigger`; as perguntas do painel são controladas por estado (sem Trigger), então
 * o foco caía no corpo da página — em "Cancelar" e, pior, depois de excluir (o
 * cartão com a lixeira some). Quem usa teclado ou leitor de tela voltava ao
 * início da página.
 *
 * - Cancelou (ou Esc): volta para o botão que abriu a pergunta, se ele ainda existe.
 * - Excluiu: o botão sumiu junto com o cartão; o foco vai para o título da tela
 *   (`foco.propsDoTitulo`, passado ao AdminPageHeader), que nunca some.
 *
 * Uso: `const foco = useFocoAposExcluir()`; no `AlertDialogContent`
 * `{...foco.dialogo}`; no botão de confirmar `onClick={() => { foco.marcarExclusao(); ... }}`.
 */
export function useFocoAposExcluir() {
  const alvoRef = useRef<HTMLHeadingElement | null>(null);
  const origemRef = useRef<HTMLElement | null>(null);
  const excluiuRef = useRef(false);

  const marcarExclusao = useCallback(() => {
    excluiuRef.current = true;
  }, []);

  const dialogo = useMemo(
    () => ({
      // No instante em que a pergunta abre, o foco ainda está no botão que a abriu.
      onOpenAutoFocus: () => {
        const ativo = document.activeElement;
        origemRef.current =
          ativo instanceof HTMLElement && ativo !== document.body
            ? ativo
            : null;
        excluiuRef.current = false;
      },
      onCloseAutoFocus: (evento: Event) => {
        const destino = excluiuRef.current
          ? alvoRef.current
          : origemRef.current;
        excluiuRef.current = false;
        origemRef.current = null;
        if (!destino?.isConnected) return;
        evento.preventDefault();
        destino.focus({ preventScroll: true });
      },
    }),
    [],
  );

  // Para o `propsDoTitulo` do AdminPageHeader: o ref e o foco só por código.
  const propsDoTitulo = useMemo(() => ({ ref: alvoRef, tabIndex: -1 }), []);

  return { propsDoTitulo, marcarExclusao, dialogo };
}
