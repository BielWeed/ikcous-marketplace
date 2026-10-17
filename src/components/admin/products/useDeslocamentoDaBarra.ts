import { useEffect, useState } from "react";

/**
 * Quanto a barra de navegação do painel sobe no navegador comum (fora do app
 * instalado), para a barra de ações do produto subir junto e não ficar atrás
 * dela. Mesma conta do AdminLayout: diferença entre a janela e a área visível
 * (só abaixo de 150px, que descarta o teclado) e 56px quando o aparelho não
 * informa a área visível. No app instalado vale 0.
 */
export function useDeslocamentoDaBarra(): number {
  const [deslocamento, setDeslocamento] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const instalado =
      window.location.search.includes("standalone") ||
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true;
    const area = window.visualViewport;
    if (!area) {
      setDeslocamento(instalado ? 0 : 56);
      return;
    }
    const atualizar = () => {
      const diferenca = Math.max(
        0,
        window.innerHeight - (area.offsetTop + area.height),
      );
      setDeslocamento(
        !instalado && diferenca > 0 && diferenca < 150 ? diferenca : 0,
      );
    };
    area.addEventListener("resize", atualizar);
    area.addEventListener("scroll", atualizar);
    window.addEventListener("resize", atualizar);
    atualizar();
    return () => {
      area.removeEventListener("resize", atualizar);
      area.removeEventListener("scroll", atualizar);
      window.removeEventListener("resize", atualizar);
    };
  }, []);

  return deslocamento;
}
