import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { useReviews } from '@/hooks/useReviews';
import { cn } from '@/lib/utils';

const reviewSchema = z.object({
    rating: z.number().min(1, 'Selecione uma nota de 1 a 5.'),
    comment: z.string().min(3, 'O comentário deve ter pelo menos 3 caracteres.'),
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
            comment: '',
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 bg-zinc-950 rounded-[2.5rem] p-10 text-white relative overflow-hidden group border border-white/5 shadow-22xl">
                {/* Visual Accent */}
                <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-[80px]" />

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-white/10 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform duration-700">
                            <Star className="w-6 h-6 text-primary fill-primary" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-[0.2em]">Sua Opinião Vale Ouro</h3>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Compartilhe sua experiência premium</p>
                        </div>
                    </div>

                    <div className="space-y-8">
                        <FormField
                            control={form.control}
                            name="rating"
                            render={({ field }) => (
                                <FormItem className="space-y-4">
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Sua Nota de Satisfação</FormLabel>
                                    <FormControl>
                                        <div className="flex gap-2 p-4 bg-white/5 rounded-3xl border border-white/5 w-fit">
                                            {[1, 2, 3, 4, 5].map((star) => (
                                                <button
                                                    key={star}
                                                    type="button"
                                                    className="relative p-1 transition-all active:scale-90"
                                                    onMouseEnter={() => setHoverRating(star)}
                                                    onMouseLeave={() => setHoverRating(0)}
                                                    onClick={() => field.onChange(star)}
                                                >
                                                    <Star
                                                        className={cn(
                                                            "w-7 h-7 transition-all duration-300",
                                                            (hoverRating || field.value) >= star
                                                                ? "fill-primary text-primary drop-shadow-[0_0_8px_rgba(251,191,36,0.5)] scale-110"
                                                                : "fill-transparent text-zinc-700 hover:text-zinc-500"
                                                        )}
                                                    />
                                                </button>
                                            ))}
                                        </div>
                                    </FormControl>
                                    <FormMessage className="text-[10px] uppercase font-black tracking-widest text-red-400" />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="comment"
                            render={({ field }) => (
                                <FormItem className="space-y-4">
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Detalhes da Experiência</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Conte-nos os detalhes que lhe surpreenderam..."
                                            className="min-h-[140px] bg-white/5 border-white/10 rounded-[2rem] p-6 text-sm placeholder:text-zinc-700 focus:ring-primary/20 transition-all resize-none shadow-inner"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage className="text-[10px] uppercase font-black tracking-widest text-red-400" />
                                </FormItem>
                            )}
                        />

                        <Button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full h-16 bg-white text-zinc-900 text-[11px] font-black uppercase tracking-[0.3em] rounded-[1.5rem] hover:bg-primary transition-all shadow-3xl shadow-black/20 active:scale-95 disabled:opacity-20 translate-y-2"
                        >
                            {isSubmitting ? (
                                <div className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-zinc-900/20 border-t-zinc-900 rounded-full animate-spin" />
                                    <span>Publicando...</span>
                                </div>
                            ) : 'Transmitir Avaliação'}
                        </Button>
                    </div>
                </div>
            </form>
        </Form>
    );
}
