import { useLayoutEffect } from "react";

/**
 * Tema do painel: Escuro (padrão), Claro ou Confortável.
 *
 * A escolha fica NO APARELHO (localStorage), nunca no banco: cada celular da
 * loja pode ter o seu. Vira `data-admin-tema` na <html> (ausente = Escuro). As
 * regras de cor vivem em src/components/layouts/temas-do-painel*.css e só valem
 * com `html.admin-mode`, então a vitrine nunca é afetada.
 *
 * Este módulo só LIGA o tema ao entrar no painel (AdminLayout). Quem ESCOLHE é
 * o seletor de Ajustes (settings/AparenciaDoPainel.tsx), que grava o mesmo
 * storage e atributo por conta própria: de propósito não importa este módulo,
 * para ele não virar um chunk à parte (o pacote do painel está no teto de
 * tamanho e um chunk pequeno cobra a própria compressão e o hash dos imports).
 */
export type TemaDoPainel = "escuro" | "claro" | "confortavel";

export const CHAVE_DO_TEMA_DO_PAINEL = "admin_tema_do_painel";

/** Tema guardado no aparelho; valor inválido ou storage indisponível = Escuro. */
export function lerTemaDoPainel(): TemaDoPainel {
  try {
    const v = localStorage.getItem(CHAVE_DO_TEMA_DO_PAINEL);
    return v === "claro" || v === "confortavel" ? v : "escuro";
  } catch {
    return "escuro";
  }
}

/**
 * Liga o modo painel (`admin-mode`) e o tema guardado na <html> ANTES da
 * primeira pintura (useLayoutEffect: sem piscar o tema errado) e desliga os dois
 * ao sair, para nada do painel vazar para a vitrine.
 */
export function useTemaDoPainelNaRaiz(): void {
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    const tema = lerTemaDoPainel();
    raiz.classList.add("admin-mode");
    if (tema !== "escuro") raiz.dataset.adminTema = tema;
    return () => {
      raiz.classList.remove("admin-mode");
      delete raiz.dataset.adminTema;
    };
  }, []);
}
