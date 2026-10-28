// Banner com link de categoria e link `/?category=X` levam a cliente até o
// Catálogo já filtrado. Tenta por ~2 s até a Home montar o título e respeita
// "menos movimento" ("instant": "auto" herdaria o scroll-smooth da tela).
export const rolarAoCatalogo = (tentativas = 7): void => {
  setTimeout(() => {
    const alvo = document.getElementById("catalogo");
    if (alvo) {
      alvo.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    } else if (tentativas > 0) rolarAoCatalogo(tentativas - 1);
  }, 300);
};
