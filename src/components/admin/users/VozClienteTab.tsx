import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HelpCircle, MessageSquare, Star } from "lucide-react";

/**
 * Aba "Voz do Cliente" da ficha (AdminUserDetailView): o que ESTE cliente
 * escreveu na loja — avaliações que fez e perguntas que deixou.
 *
 * De onde vem o dado: as MESMAS tabelas que os hooks `useReviews` /
 * `useQuestions` leem (`reviews` e `questions`, com join em `produtos`), sob
 * as MESMAS policies de leitura pública (`reviews_select_policy` e
 * `questions_select_policy`, ambas `USING (true)` na baseline
 * 20260806000000). Os hooks não foram usados aqui porque nenhum dos dois
 * filtra por autor: `getAllReviews`/`getAllQuestions` são PAGINADOS (20 por
 * página) e servidos para a fila de moderação inteira — paginar a fila toda
 * para filtrar um autor no cliente traria a lista truncada e a ficha diria
 * "2 avaliações" sobre quem escreveu 9. A leitura direta com
 * `.eq("user_id", ...)` entrega o recorte completo com o mesmo direito de
 * leitura que a tela de produto já usa. Nenhuma RPC nova, nenhuma migration.
 *
 * Leitura, não moderação: aprovar/recusar continua nas telas próprias
 * (AdminReviewsView / AdminQAView). Aqui o status PENDENTE aparece como
 * selo — esconder que a avaliação ainda não foi publicada faria a lojista
 * ler na ficha um texto que o cliente final ainda não vê.
 */

export interface AvaliacaoDaFicha {
  id: string;
  productId: string;
  produtoNome: string;
  rating: number;
  comment: string;
  /** Ausente em avaliações antigas = publicada (mesma regra do tipo Review). */
  status?: "publicada" | "pendente";
  helpful: number;
  merchantReply?: string | null;
  createdAt: string;
}

export interface RespostaDaFicha {
  id: string;
  answer: string;
  createdAt: string;
}

export interface PerguntaDaFicha {
  id: string;
  productId: string;
  produtoNome: string;
  question: string;
  createdAt: string;
  respostas: RespostaDaFicha[];
}

interface VozClienteTabProps {
  carregando: boolean;
  /** Falha de consulta ≠ lista vazia: cada estado tem frase própria. */
  erro: string | null;
  avaliacoes: AvaliacaoDaFicha[];
  perguntas: PerguntaDaFicha[];
  onTentarDeNovo: () => void;
}

const dataCurta = (iso: string) =>
  format(new Date(iso), "dd MMM yy", { locale: ptBR });

function Estrelas({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={
            n <= rating
              ? "size-3 fill-admin-gold text-admin-gold"
              : "size-3 text-zinc-700"
          }
        />
      ))}
    </div>
  );
}

function EstadoVazioSecao({
  icone,
  titulo,
  subtitulo,
}: {
  icone: React.ReactNode;
  titulo: string;
  subtitulo: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner">
        {icone}
      </div>
      <p className="text-sm font-bold text-zinc-500">{titulo}</p>
      <p className="mt-1 text-xs text-zinc-600">{subtitulo}</p>
    </div>
  );
}

function ListaAvaliacoes({ avaliacoes }: { avaliacoes: AvaliacaoDaFicha[] }) {
  if (avaliacoes.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-zinc-600">
        Este cliente ainda não escreveu avaliações.
      </p>
    );
  }
  return (
    <div className="divide-y divide-zinc-800/30">
      {avaliacoes.map((a) => (
        <div
          key={a.id}
          className="p-4 transition-colors hover:bg-zinc-800/20"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Estrelas rating={a.rating} />
            {a.status === "pendente" && (
              <Badge
                variant="secondary"
                className="border-yellow-200/20 bg-yellow-100/10 text-[8px] font-black uppercase tracking-widest text-yellow-500"
              >
                Aguardando aprovação
              </Badge>
            )}
            <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-zinc-600">
              {dataCurta(a.createdAt)}
            </span>
          </div>
          {a.comment && (
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              “{a.comment}”
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
              {a.produtoNome}
            </span>
            {a.helpful > 0 && <span>Útil ({a.helpful})</span>}
          </div>
          {a.merchantReply && (
            <div className="mt-2 rounded-lg border border-admin-gold/20 bg-admin-gold/5 p-2">
              <p className="text-[8px] font-black uppercase tracking-widest text-admin-gold">
                Resposta da loja
              </p>
              <p className="mt-1 text-xs text-zinc-300">{a.merchantReply}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ListaPerguntas({ perguntas }: { perguntas: PerguntaDaFicha[] }) {
  if (perguntas.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-zinc-600">
        Este cliente ainda não deixou perguntas.
      </p>
    );
  }
  return (
    <div className="divide-y divide-zinc-800/30">
      {perguntas.map((q) => (
        <div key={q.id} className="p-4 transition-colors hover:bg-zinc-800/20">
          <div className="flex items-start gap-2">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-admin-gold" />
            <p className="text-xs font-semibold leading-relaxed text-zinc-200">
              {q.question}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
              {q.produtoNome}
            </span>
            <span>{dataCurta(q.createdAt)}</span>
          </div>
          {q.respostas.length > 0 && (
            <div className="mt-2 space-y-2">
              {q.respostas.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-zinc-800/60 bg-zinc-950/60 p-2"
                >
                  <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                    Resposta <span className="text-zinc-700">• {dataCurta(r.createdAt)}</span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                    {r.answer}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function VozClienteTab({
  carregando,
  erro,
  avaliacoes,
  perguntas,
  onTentarDeNovo,
}: VozClienteTabProps) {
  if (carregando) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="space-y-2 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-4"
          >
            <Skeleton className="h-3 w-24 animate-pulse rounded bg-white/5" />
            <Skeleton className="h-3 w-3/4 animate-pulse rounded bg-white/5" />
            <Skeleton className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  if (erro) {
    // Falha de rede/consulta tem frase PRÓPRIA — nunca a frase de lista
    // vazia, que mentiria "ele nunca escreveu" sobre uma consulta que nem
    // chegou ao servidor (mesma lição do `erro` no FavoritesContext e do
    // QAStatsResult no useQuestions).
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5">
          <HelpCircle className="size-6 text-red-400/70" />
        </div>
        <p className="text-sm font-bold text-zinc-400">
          Não conseguimos carregar o que este cliente escreveu.
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          A consulta falhou — não significa que a lista esteja vazia.
        </p>
        <button
          type="button"
          onClick={onTentarDeNovo}
          className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-admin-gold/30 hover:text-admin-gold"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const nadaEscrito = avaliacoes.length === 0 && perguntas.length === 0;
  if (nadaEscrito) {
    return (
      <EstadoVazioSecao
        icone={<MessageSquare className="size-6 text-zinc-700" />}
        titulo="Nada Escrito Ainda"
        subtitulo="Este cliente não avaliou nem perguntou até agora."
      />
    );
  }

  return (
    <div className="space-y-6 p-4">
      <section className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/20">
        <h3 className="flex items-center gap-2 border-b border-zinc-800/50 bg-zinc-900/50 p-3 text-[10px] font-black uppercase tracking-[0.2em] text-white">
          <Star className="size-3.5 text-admin-gold" />
          Avaliações
          <span className="ml-1 text-zinc-500">({avaliacoes.length})</span>
        </h3>
        <ListaAvaliacoes avaliacoes={avaliacoes} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/20">
        <h3 className="flex items-center gap-2 border-b border-zinc-800/50 bg-zinc-900/50 p-3 text-[10px] font-black uppercase tracking-[0.2em] text-white">
          <MessageSquare className="size-3.5 text-admin-gold" />
          Perguntas
          <span className="ml-1 text-zinc-500">({perguntas.length})</span>
        </h3>
        <ListaPerguntas perguntas={perguntas} />
      </section>
    </div>
  );
}
