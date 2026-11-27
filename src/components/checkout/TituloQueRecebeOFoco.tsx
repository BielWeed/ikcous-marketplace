import { cn } from "@/lib/utils";
import { type ReactNode, useEffect, useRef } from "react";

// Acessibilidade (lote r64-a): "Pedido recebido!", "Pagamento Confirmado!" e
// "Finalize o pagamento" SUBSTITUEM a tela inteira, e o botão que tinha o foco
// (Finalizar, "Copiar código Pix") some junto — o foco caía no corpo da página
// e o leitor de tela ficava em silêncio. O título recebe o foco UMA vez, quando
// a tela aparece (efeito sem dependência de render): o leitor fala o título e o
// teclado recomeça dali; redesenhos seguintes não puxam o foco de volta, para
// não tirar a pessoa do "Copiar código Pix". `semFocoNaAbertura` poupa quem só
// abriu/recarregou a página sem tocar em nada (mesma regra do foco do <main>
// no App.tsx: não atropelar o "Pular para o conteúdo"). Mora fora do
// CheckoutView para a "Situação do pagamento" (VerificacaoDoPagamento), que
// também substitui a tela do cartão, usar o mesmo título.
export function TituloQueRecebeOFoco({
  nivel,
  semFocoNaAbertura = false,
  className,
  children,
}: Readonly<{
  nivel: 1 | 2;
  semFocoNaAbertura?: boolean;
  className: string;
  children: ReactNode;
}>) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (semFocoNaAbertura && navigator.userActivation?.hasBeenActive === false)
      return;
    ref.current?.focus({ preventScroll: true });
  }, [semFocoNaAbertura]);
  const Titulo = nivel === 1 ? "h1" : "h2";
  return (
    <Titulo ref={ref} tabIndex={-1} className={cn(className, "outline-none")}>
      {children}
    </Titulo>
  );
}
