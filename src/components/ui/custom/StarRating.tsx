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
  // ProductCard, PremiumOffers, CompareView e ProductView renderizam
  // avaliação pura, sem controlar nota nenhuma, e três deles esqueciam de
  // passar `readonly`, deixando o cursor de mãozinha e o hover de campo de
  // entrada num clique que só abre o produto. Campo de nota clicável de
  // verdade é a EXCEÇÃO (hoje nenhum lugar do projeto usa) e precisa pedir
  // isso explicitamente com `readonly={false}` + `onRatingChange`.
  readonly = true,
  size = 20,
  className,
}: StarRatingProps) {
  return (
    <div className={cn("flex space-x-1", className)}>
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
  );
});
