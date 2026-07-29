import { LazyImage } from "@/components/LazyImage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Review, View } from "@/types";
import { Check, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { StarRating } from "./StarRating";

interface ReviewCardProps {
  review: Review;
  onHelpful?: (reviewId: string) => void;
  onNavigate?: (view: View, id?: string) => void;
}

export function ReviewCard({ review, onHelpful, onNavigate }: ReviewCardProps) {
  const [hasMarkedHelpful, setHasMarkedHelpful] = useState(false);

  const handleHelpful = () => {
    if (!hasMarkedHelpful && onHelpful) {
      onHelpful(review.id);
      setHasMarkedHelpful(true);
    }
  };

  const handleUserClick = () => {
    if (onNavigate && review.userId) {
      onNavigate("user-profile", review.userId);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getInitials = (name: string) => {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (
      parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
    ).toUpperCase();
  };

  return (
    <div className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            onClick={handleUserClick}
            role={onNavigate && review.userId ? "button" : undefined}
            tabIndex={onNavigate && review.userId ? 0 : undefined}
            onKeyDown={(e) => {
              if (
                onNavigate &&
                review.userId &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                handleUserClick();
              }
            }}
            className={`flex-shrink-0 ${onNavigate && review.userId ? "cursor-pointer select-none transition-transform duration-200 active:scale-95" : ""}`}
          >
            <Avatar className="size-10 border border-zinc-200/50 shadow-sm transition-transform duration-300 hover:scale-105">
              <AvatarImage
                src={review.customerAvatar}
                className="object-cover"
              />
              <AvatarFallback className="flex select-none items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-xs font-bold text-zinc-700">
                {getInitials(review.customerName)}
              </AvatarFallback>
            </Avatar>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                onClick={handleUserClick}
                role={onNavigate && review.userId ? "button" : undefined}
                tabIndex={onNavigate && review.userId ? 0 : undefined}
                onKeyDown={(e) => {
                  if (
                    onNavigate &&
                    review.userId &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    handleUserClick();
                  }
                }}
                className={`text-sm font-bold tracking-tight text-zinc-900 ${onNavigate && review.userId ? "cursor-pointer hover:underline" : ""}`}
              >
                {review.customerName}
              </span>
              {review.verified && (
                <span className="flex items-center gap-0.5 rounded-md border border-emerald-100/50 bg-emerald-50/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600">
                  <Check className="size-2.5" />
                  Verificado
                </span>
              )}
            </div>
            <div className="mt-0.5">
              <StarRating rating={review.rating} size={11} readonly />
            </div>
          </div>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          {formatDate(review.createdAt)}
        </span>
      </div>

      {/* Comment */}
      <p className="mb-4 mt-3 text-xs font-normal leading-relaxed text-zinc-600 md:text-sm">
        {review.comment}
      </p>

      {/* Images */}
      {review.images && review.images.length > 0 && (
        <div className="scrollbar-hide mb-4 flex gap-2 overflow-x-auto pb-2">
          {review.images.map((image, index) => (
            <div
              key={index}
              className="group/img relative flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100"
            >
              <LazyImage
                src={image}
                alt={`Review ${index + 1}`}
                className="size-16 object-cover transition-transform duration-300 group-hover/img:scale-105"
              />
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          onClick={handleHelpful}
          disabled={hasMarkedHelpful}
          className={`flex w-fit items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
            hasMarkedHelpful
              ? "border-zinc-950 bg-zinc-950 text-white shadow-sm"
              : "border-zinc-200/50 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
          }`}
        >
          <ThumbsUp
            className={`size-3 ${hasMarkedHelpful ? "fill-current" : ""}`}
          />
          <span>Útil ({review.helpful + (hasMarkedHelpful ? 1 : 0)})</span>
        </button>

        {review.merchantReply && (
          <div className="relative mt-1 rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3.5 text-xs duration-300 animate-in slide-in-from-left-1">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-zinc-900" />
              <span className="text-[9px] font-black uppercase tracking-wider text-zinc-800">
                Resposta da Loja
              </span>
            </div>
            <p className="font-medium italic leading-relaxed text-zinc-600">
              "{review.merchantReply}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
