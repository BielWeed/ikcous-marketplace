import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { cn } from "@/lib/utils";
import type * as React from "react";

/**
 * Botão de AÇÃO "falar pelo WhatsApp" do lado do cliente (pedido do dono,
 * 26/10/2026): verde oficial do WhatsApp (#25D366) com o glifo oficial à
 * esquerda e o rótulo. Um só desenho para todo contato por WhatsApp da loja.
 *
 * Contraste: branco sobre #25D366 dá ~2:1 e reprova (WCAG pede 4,5:1 em texto);
 * por isso texto e glifo são ESCUROS (#0B141A, ~9,4:1 no repouso; ~7,9:1 no
 * hover e ~6,4:1 pressionado). A conta está em
 * tests/front/botao-whatsapp-original.test.tsx.
 *
 * Só para botão que ABRE o WhatsApp. Rótulo de dado ("Seu WhatsApp") e campo de
 * formulário NÃO usam este componente.
 *
 * Quem usa passa o MESMO handler que o botão antigo tinha — o componente não
 * abre link nenhum. `className` do chamador vence o padrão (twMerge): serve
 * para altura/largura/posição do lugar onde o botão mora.
 */
export function BotaoWhatsapp({
  className,
  children,
  type = "button",
  ...props
}: Omit<React.ComponentProps<"button">, "type"> & {
  type?: "button" | "submit" | "reset";
}) {
  return (
    <button
      type={type}
      className={cn(
        "flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#25D366] px-4 text-base font-semibold text-[#0B141A] shadow-sm transition-[background-color,transform] duration-150 hover:bg-[#20C25E] active:scale-[0.98] active:bg-[#1DAE55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <IconeWhatsapp className="size-5 shrink-0" />
      {children}
    </button>
  );
}
