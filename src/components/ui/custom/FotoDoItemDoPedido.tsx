import { cn } from "@/lib/utils";
import { Package } from "lucide-react";
import { useState } from "react";

interface FotoDoItemDoPedidoProps {
  /** `OrderItem.image`: vazio no pedido de convidado e no produto desativado. */
  src: string | null | undefined;
  alt: string;
  /** Classe da `<img>` (cada tela tem o seu tamanho e o seu hover). */
  className?: string;
}

/**
 * A foto de um item de pedido que nunca fica quebrada: sem foto, ou foto que
 * dá erro ao carregar, mostra o ícone de pacote — o mesmo que a lista de
 * pedidos (`OrderList`) mostra quando o item não tem imagem.
 *
 * Existe por causa do detalhe do pedido (14/10/2026): a consulta por código do
 * convidado devolve `oi.image_url` vazio, e o produto desativado perde a foto;
 * a `<img>` crua ficava com o ícone de imagem quebrada e o texto alternativo
 * cortado. A lista tem a guarda de "sem foto" mas não o `onError` — este
 * componente é o detalhe completo, e a lista segue como está.
 *
 * Quem usa dá a moldura (tamanho, borda, fundo); o ícone se centraliza dentro
 * dela e precisa de um pai `flex items-center justify-center`.
 */
export function FotoDoItemDoPedido({
  src,
  alt,
  className,
}: Readonly<FotoDoItemDoPedidoProps>) {
  // Guarda QUAL url falhou, e não "falhou": outra foto (o mesmo componente
  // reaproveitado para outro item) tem a chance de carregar — o erro de uma
  // URL não condena a seguinte, e sem efeito para zerar nem piscar o ícone.
  const [urlQueFalhou, setUrlQueFalhou] = useState<string | null>(null);

  if (!src || urlQueFalhou === src) {
    return (
      <Package
        data-testid="foto-do-item-sem-imagem"
        aria-hidden="true"
        className="size-6 text-zinc-300"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("size-full object-cover", className)}
      onError={() => setUrlQueFalhou(src)}
    />
  );
}
