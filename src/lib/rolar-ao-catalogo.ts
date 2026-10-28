// Banner com link de categoria e link `/?category=X` levam a cliente até o
// Catálogo já filtrado. Espera a tela montar e respeita "menos movimento".
export const rolarAoCatalogo = () =>
  setTimeout(
    () =>
      document.getElementById("catalogo")?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      }),
    300,
  );
