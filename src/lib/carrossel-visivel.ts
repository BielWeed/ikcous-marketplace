// A Home fica montada (só escondida) quando a cliente vai ao carrinho, ao
// produto ou a outra aba (App.tsx, `TabWrapper`: só a aba ativa leva a classe
// `active-scroll-container`). Sem esta checagem os carrosséis seguem girando e
// atualizando estado por trás. Fora de um `.admin-tab-pane` (esqueleto, painel,
// testes) o carrossel conta como visível.
export function carrosselPodeGirar(raiz: Element | null | undefined): boolean {
  if (typeof document !== "undefined" && document.hidden) return false;
  const aba = raiz?.closest(".admin-tab-pane");
  if (!aba) return true;
  return aba.classList.contains("active-scroll-container");
}
