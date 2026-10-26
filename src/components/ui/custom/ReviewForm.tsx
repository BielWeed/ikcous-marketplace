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
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const reviewSchema = z.object({
  rating: z.number().min(1, "Selecione uma nota de 1 a 5."),
  // As estrelas bastam: o banco aceita avaliação sem texto (reviews.comment é
  // nullable, sem CHECK nem trigger). Só espaços conta como vazio (trim no envio).
  comment: z.string(),
});

/**
 * Teclado de grupo de opções para as estrelas: a nota para onde a tecla leva
 * a partir da nota `de`, ou `null` se a tecla não é de navegação.
 */
function proximaNota(tecla: string, de: number): number | null {
  switch (tecla) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(de + 1, 5);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(de - 1, 1);
    case "Home":
      return 1;
    case "End":
      return 5;
    default:
      return null;
  }
}

interface ReviewFormProps {
  productId: string;
  onSuccess?: () => void;
  // Redesenho 25/09/2026 (cartão "O que achou da compra?" em
  // OrderDetailsView): quem toca numa estrela do cartão já chega aqui com a
  // nota escolhida — só preenche `defaultValues.rating`, nada mais muda.
  initialRating?: number;
  // Quem fecha a folha precisa saber se há comentário escrito a perder: o
  // formulário mantém esta ref em dia (true = tem texto digitado).
  temTextoRef?: { current: boolean };
}

export function ReviewForm({
  productId,
  onSuccess,
  initialRating,
  temTextoRef,
}: ReviewFormProps) {
  const { addReview } = useReviews();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);

  const form = useForm<z.infer<typeof reviewSchema>>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      rating: initialRating ?? 0,
      comment: "",
    },
  });

  const temTexto = form.watch("comment").trim() !== "";
  useEffect(() => {
    if (!temTextoRef) return;
    temTextoRef.current = temTexto;
    return () => {
      temTextoRef.current = false;
    };
  }, [temTexto, temTextoRef]);
  // O comentário digitado só existe neste formulário: recarregar o app
  // (atualização obrigatória, ao ir para segundo plano) o apagaria.
  useEffect(() => {
    if (!temTexto) return;
    return marcarOperacaoSensivel("avaliacao-em-digitacao");
  }, [temTexto]);

  async function onSubmit(values: z.infer<typeof reviewSchema>) {
    setIsSubmitting(true);
    try {
      const result = await addReview({
        productId,
        rating: values.rating,
        comment: values.comment.trim(),
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
                  {/* UI-191 (G9): é UMA escolha entre cinco notas, não cinco
                      botões que se ligam e desligam. Com `aria-pressed` o leitor
                      de tela dizia "4 botões pressionados"; como grupo de opções
                      (radiogroup) diz "4 de 5 estrelas, marcado". Teclado de
                      grupo de opções: Tab entra na nota marcada (ou na primeira),
                      as setas trocam a nota, Home/End vão às pontas. O desenho
                      (estrelas acesas até a nota) não muda. */}
                  <div
                    role="radiogroup"
                    aria-label="Sua nota de satisfação"
                    className="flex w-fit gap-2 rounded-2xl border border-zinc-200/50 bg-zinc-50 p-2.5"
                  >
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        role="radio"
                        disabled={isSubmitting}
                        aria-label={`${star} de 5 estrelas`}
                        aria-checked={field.value === star}
                        tabIndex={
                          field.value === star || (!field.value && star === 1)
                            ? 0
                            : -1
                        }
                        className="relative -m-2 p-2.5 transition-all active:scale-90"
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => field.onChange(star)}
                        onKeyDown={(e) => {
                          const alvo = proximaNota(e.key, star);
                          if (alvo === null) return;
                          e.preventDefault();
                          field.onChange(alvo);
                          e.currentTarget.parentElement
                            ?.querySelectorAll<HTMLButtonElement>(
                              '[role="radio"]',
                            )
                            .item(alvo - 1)
                            .focus();
                        }}
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
                  Detalhes da Experiência (Opcional)
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Conte-nos os detalhes que lhe surpreenderam..."
                    maxLength={1000}
                    className="min-h-[110px] resize-none rounded-2xl border-zinc-200/60 bg-zinc-50 p-4 text-base shadow-none transition-all placeholder:text-zinc-400 focus:border-primary focus:bg-white focus:ring-0 md:text-sm"
                    {...field}
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage className="text-[10px] font-bold uppercase tracking-wider text-red-500" />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-12 w-full rounded-2xl bg-primary text-[11px] font-bold uppercase tracking-widest text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground" />
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
