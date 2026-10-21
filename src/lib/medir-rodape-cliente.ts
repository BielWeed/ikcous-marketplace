// Duas telas podem coexistir na transição. A maior barra reserva espaço;
// desmontar a anterior não deve apagar a medida da próxima.
const alturas = new Map<HTMLElement, number>();

function publicarAltura() {
  const estilo = document.documentElement.style;
  if (alturas.size) {
    estilo.setProperty(
      "--customer-footer-height",
      `${Math.max(...alturas.values())}px`,
    );
  } else {
    estilo.removeProperty("--customer-footer-height");
  }
}

/** Ref estável de React 19: mede o próprio rodapé e limpa quando ele sai. */
export function medirRodapeCliente(elemento: HTMLElement | null) {
  if (!elemento) return;
  const medir = () => {
    // Não inclui translateY da animação; zera quando display:none.
    alturas.set(elemento, elemento.offsetHeight);
    publicarAltura();
  };
  medir();
  const observador =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
  observador?.observe(elemento);
  return () => {
    observador?.disconnect();
    alturas.delete(elemento);
    publicarAltura();
  };
}
