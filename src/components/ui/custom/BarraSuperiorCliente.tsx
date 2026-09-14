import type { ReactNode } from "react";

import { useToastDoHeader } from "@/utils/headerToast";

// O wrapper do header do cliente no App (antes: div literal em App.tsx).
// É ESTE elemento o dono do degrau transitório de z: o `gpu-accelerated`
// (transform + will-change, index.css) mais `relative` fazem dele um
// STACKING CONTEXT — e, como o Sheet é portalado em document.body (Radix,
// sem container), quem compete com o véu z-[130] na RAIZ é este wrapper,
// não o <header> que ele hospeda. Um z-[140] condicional dentro do header
// competia só com irmãos internos: inerte — o aviso "Falta escolher" pintava
// sob o véu no celular (onde o toaster do sonner é display:none e a cápsula
// é o único aviso) e o toque nela fechava a folha. Enquanto um toast está
// ativo (canal único em utils/headerToast.ts), o wrapper sobe para 140 e a
// cápsula fica nítida e clicável; expirada a janela (~2,6 s), volta ao 100.
// Régua da casa: barra 100/140-durante-toast < BottomNav 120 < sheet 130 <
// barra de progresso 99999.
export function BarraSuperiorCliente({ children }: { children: ReactNode }) {
  const { ativo: toastAtivo } = useToastDoHeader();
  return (
    <div
      className={`gpu-accelerated relative flex-shrink-0 ${
        toastAtivo ? "z-[140]" : "z-[100]"
      }`}
    >
      {children}
    </div>
  );
}
