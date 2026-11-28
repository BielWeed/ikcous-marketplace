// As classes do botão "cancelar" dos avisos (Sonner), num lugar só: o
// `Toaster` do app (`sonner.tsx`) as aplica ao `cancel` comum, e o aviso de
// rascunho que desenha o próprio botão (`cancel` em JSX, para o "Descartar"
// funcionar num aviso que não fecha por gesto) usa as mesmas.
export const CLASSES_DO_BOTAO_CANCELAR_DO_AVISO =
  "group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-300 font-medium text-xs rounded-full px-3 py-1.5";
