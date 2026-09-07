import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import { memo } from "react";

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  onRatingChange?: (rating: number) => void;
  readonly?: boolean;
  size?: number;
  className?: string;
}

export const StarRating = memo(function StarRating({
  rating,
  maxRating = 5,
  onRatingChange,
  // LOJA-01 (auditoria 26/08/2026): exibição é a REGRA neste componente --
  // ProductCard, PremiumOffers e ProductView renderizam
  // avaliação pura, sem controlar nota nenhuma, e três deles esqueciam de
  // passar `readonly`, deixando o cursor de mãozinha e o hover de campo de
  // entrada num clique que só abre o produto. Campo de nota clicável de
  // verdade é a EXCEÇÃO (hoje nenhum lugar do projeto usa) e precisa pedir
  // isso explicitamente com `readonly={false}` + `onRatingChange`.
  readonly = true,
  size = 20,
  className,
}: StarRatingProps) {
  // Laudo de acessibilidade 05/09, M8: a nota (ex.: 4,5) nunca era falada —
  // as estrelas são desenho puro e "é bem avaliado?" ficava sem resposta em
  // TODOS os usos (ProductCard, PremiumOffers, ProductView, ReviewCard,
  // UserProfileView). Resolvido AQUI, no componente: texto `sr-only` com a
  // nota em pt-BR (vírgula decimal) junto às estrelas, que ficam
  // `aria-hidden` para o leitor não anunciar "gráfico" vazio.
  const notaFalada = Number.isInteger(rating)
    ? `${rating}`
    : rating.toFixed(1).replace(".", ",");

  return (
    <div className={cn("flex space-x-1", className)}>
      <span className="sr-only">{`${notaFalada} de ${maxRating}`}</span>
      <div aria-hidden="true" className="flex space-x-1">
        {Array.from({ length: maxRating }).map((_, index) => {
          const starValue = index + 1;
          const isFilled = starValue <= rating;

          return (
            <Star
              key={index}
              size={size}
              className={cn(
                "transition-colors",
                isFilled
                  ? "fill-yellow-400 text-yellow-400"
                  : "fill-transparent text-gray-300",
                !readonly && "cursor-pointer hover:text-yellow-500",
              )}
              onClick={() => !readonly && onRatingChange?.(starValue)}
            />
          );
        })}
      </div>
    </div>
  );
});
