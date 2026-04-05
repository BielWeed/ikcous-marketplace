import { useState } from 'react';
import { ThumbsUp, Check, User } from 'lucide-react';
import { StarRating } from './StarRating';
import type { Review } from '@/types';

interface ReviewCardProps {
  review: Review;
  onHelpful?: (reviewId: string) => void;
}

export function ReviewCard({ review, onHelpful }: ReviewCardProps) {
  const [hasMarkedHelpful, setHasMarkedHelpful] = useState(false);

  const handleHelpful = () => {
    if (!hasMarkedHelpful && onHelpful) {
      onHelpful(review.id);
      setHasMarkedHelpful(true);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="bg-zinc-50/50 p-6 rounded-[2rem] border border-zinc-100/50 hover:bg-white transition-all duration-500 group">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-zinc-200 group-hover:scale-110 transition-transform duration-500">
            <User className="w-6 h-6" />
          </div>
          <div>
            <p className="font-black text-sm tracking-tight text-zinc-900">{review.customerName}</p>
            <div className="flex items-center gap-3 mt-1">
              <StarRating rating={review.rating} size={12} />
              {review.verified && (
                <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                  <Check className="w-3 h-3" />
                  Verificado
                </span>
              )}
            </div>
          </div>
        </div>
        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{formatDate(review.createdAt)}</span>
      </div>

      {/* Comment */}
      <p className="text-sm text-zinc-600 mb-4 leading-relaxed font-medium">{review.comment}</p>

      {/* Images */}
      {review.images && review.images.length > 0 && (
        <div className="flex gap-3 mb-4 overflow-x-auto pb-2 scrollbar-hide">
          {review.images.map((image, index) => (
            <div key={index} className="relative group/img overflow-hidden rounded-2xl">
              <img
                src={image}
                alt={`Review ${index + 1}`}
                className="w-20 h-20 object-cover flex-shrink-0 group-hover/img:scale-110 transition-transform duration-500"
              />
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-4">
        <button
          onClick={handleHelpful}
          disabled={hasMarkedHelpful}
          className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all px-4 py-2 rounded-full w-fit ${hasMarkedHelpful
            ? 'bg-zinc-900 text-white shadow-xl shadow-zinc-200'
            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900'
            }`}
        >
          <ThumbsUp className={`w-3.5 h-3.5 ${hasMarkedHelpful ? 'fill-current' : ''}`} />
          Útil ({review.helpful + (hasMarkedHelpful ? 1 : 0)})
        </button>

        {review.merchantReply && (
          <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm relative animate-in slide-in-from-left-2 duration-500">
            <div className="absolute left-0 top-4 bottom-4 w-1 bg-zinc-900 rounded-full" />
            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-2">Resposta da IKCOUS</p>
            <p className="text-sm text-zinc-800 italic leading-relaxed font-medium">"{review.merchantReply}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
