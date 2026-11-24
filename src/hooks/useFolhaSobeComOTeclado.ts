import { useAlturaDoTeclado } from "@/hooks/useAlturaDoTeclado";
import { type CSSProperties, useEffect } from "react";

/**
 * O teclado do celular se SOBREPÕE à página (não a redimensiona): a folha de
 * baixo sobe acima dele e cabe na área visível, para o botão principal do
 * rodapé não ficar escondido ao digitar. O mesmo desenho de `FolhaInferior`
 * (folha das Vitrines).
 *
 * Devolve o `style` do `SheetContent`: só VARIÁVEIS CSS (`--teclado-da-folha`,
 * `--altura-da-folha`), que as classes do celular leem — a gaveta do computador
 * (`lg:`) não muda, e um `bottom` inline venceria o `lg:bottom-auto`. O
 * `className` da folha precisa de:
 *   `bottom-[var(--teclado-da-folha,0px)]`
 *   `max-h-[min(92dvh,var(--altura-da-folha,92dvh))]` (a altura de sempre)
 *
 * Ao focar um campo DENTRO da folha (o elemento com o atributo `marca`, ex.:
 * `data-folha-de-nova-categoria`), traz o campo à vista dentro do corpo que
 * rola. O teclado leva um tempo para abrir: a rolagem se refaz quando a altura
 * dele muda. Campo fora da folha não é tocado.
 */
export function useFolhaSobeComOTeclado(
  marca: string,
): CSSProperties | undefined {
  const { altura: teclado, alturaVisivel } = useAlturaDoTeclado();
  const dentroDaFolha = `[${marca}]`;

  useEffect(() => {
    let timer: number | undefined;
    const aoFocar = (evento: FocusEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof HTMLElement)) return;
      if (alvo.tagName !== "INPUT" && alvo.tagName !== "TEXTAREA") return;
      if (!alvo.closest(dentroDaFolha)) return;
      window.clearTimeout(timer);
      // `?.`: o jsdom dos testes não tem a função.
      timer = window.setTimeout(
        () => alvo.scrollIntoView?.({ block: "nearest" }),
        150,
      );
    };
    document.addEventListener("focusin", aoFocar);
    return () => {
      document.removeEventListener("focusin", aoFocar);
      window.clearTimeout(timer);
    };
  }, [dentroDaFolha]);

  useEffect(() => {
    if (teclado === 0) return;
    const ativo = document.activeElement;
    if (!(ativo instanceof HTMLElement)) return;
    if (ativo.tagName !== "INPUT" && ativo.tagName !== "TEXTAREA") return;
    if (!ativo.closest(dentroDaFolha)) return;
    ativo.scrollIntoView?.({ block: "nearest" });
  }, [teclado, dentroDaFolha]);

  return teclado > 0
    ? ({
        "--teclado-da-folha": `${teclado}px`,
        "--altura-da-folha": `calc(${alturaVisivel}px - 1rem)`,
      } as CSSProperties)
    : undefined;
}
