import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useReviews } from "@/hooks/useReviews";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Star } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const reviewSchema = z.object({
  rating: z.number().min(1, "Selecione uma nota de 1 a 5."),
  comment: z.string().min(3, "O comentário deve ter pelo menos 3 caracteres."),
});

interface ReviewFormProps {
  productId: string;
  onSuccess?: () => void;
}

export function ReviewForm({ productId, onSuccess }: ReviewFormProps) {
  const { addReview } = useReviews();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);

  const form = useForm<z.infer<typeof reviewSchema>>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      rating: 0,
      comment: "",
    },
  });

  async function onSubmit(values: z.infer<typeof reviewSchema>) {
    setIsSubmitting(true);
    try {
      const result = await addReview({
        productId,
        rating: values.rating,
        comment: values.comment,
      });

      if (result) {
        form.reset();
        onSuccess?.();
      }
    } catch {
      // Error handled in hook
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="group relative space-y-6 overflow-hidden rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
      >
        <div className="relative z-10 space-y-5">
          <FormField
            control={form.control}
            name="rating"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Sua Nota de Satisfação
                </FormLabel>
                <FormControl>
                  <div className="flex w-fit gap-2 rounded-2xl border border-zinc-200/50 bg-zinc-50 p-2.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        className="relative p-0.5 transition-all active:scale-90"
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => field.onChange(star)}
                      >
                        <Star
                          className={cn(
                            "w-6 h-6 transition-all duration-200",
                            (hoverRating || field.value) >= star
                              ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.4)] scale-110"
                              : "fill-transparent text-zinc-300 hover:text-zinc-400",
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </FormControl>
                <FormMessage className="text-[10px] font-bold uppercase tracking-wider text-red-500" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="comment"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Detalhes da Experiência
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Conte-nos os detalhes que lhe surpreenderam..."
                    className="min-h-[110px] resize-none rounded-2xl border-zinc-200/60 bg-zinc-50 p-4 text-xs shadow-none transition-all placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-0 md:text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-[10px] font-bold uppercase tracking-wider text-red-500" />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded-2xl bg-zinc-950 text-[11px] font-bold uppercase tracking-widest text-white shadow-sm transition-all hover:bg-zinc-900 active:scale-[0.98] disabled:opacity-40"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <span>Publicando...</span>
              </div>
            ) : (
              "Publicar Avaliação"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
