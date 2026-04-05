import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  onRatingChange?: (rating: number) => void;
  readonly?: boolean;
  size?: number;
  className?: string;
}

export function StarRating({
  rating,
  maxRating = 5,
  onRatingChange,
  readonly = false,
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
              !readonly && "cursor-pointer hover:text-yellow-500"
            )}
            onClick={() => !readonly && onRatingChange?.(starValue)}
          />
        );
      })}
    </div>
  );
}
