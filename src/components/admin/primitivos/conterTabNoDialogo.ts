// Mesmo filtro usado no ModalVarianteGrade: controles desabilitados,
// escondidos ou inertes não fazem parte da sequência do teclado.
export function controlesDoDialogo(dialogo: HTMLElement) {
  return [
    ...dialogo.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]",
    ),
  ].filter(
    (elemento) =>
      elemento.tabIndex >= 0 &&
      !elemento.matches(':disabled, input[type="hidden"]') &&
      !elemento.closest("[hidden], [inert]") &&
      getComputedStyle(elemento).display !== "none" &&
      getComputedStyle(elemento).visibility !== "hidden",
  );
}

export function conterTabNoDialogo(
  evento: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "defaultPrevented" | "preventDefault"
  >,
  dialogo: HTMLElement,
) {
  if (evento.key !== "Tab" || evento.defaultPrevented) return;
  const controles = controlesDoDialogo(dialogo);
  const primeiro = controles.at(0);
  const ultimo = controles.at(-1);
  if (!primeiro || !ultimo) {
    evento.preventDefault();
    dialogo.focus();
  } else if (
    !dialogo.contains(document.activeElement) ||
    document.activeElement === dialogo ||
    (evento.shiftKey
      ? document.activeElement === primeiro
      : document.activeElement === ultimo)
  ) {
    evento.preventDefault();
    (evento.shiftKey ? ultimo : primeiro).focus();
  }
}
