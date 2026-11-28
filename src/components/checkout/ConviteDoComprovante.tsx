import {
  type DesfechoDoComprovanteDaVisitante,
  emailDaVisitanteValido,
  pedirComprovanteDaVisitante,
} from "@/lib/comprovante-da-visitante";
import { type FormEvent, useRef, useState } from "react";

/**
 * O convite da tela "Pedido recebido!" para quem comprou SEM conta (lote 579):
 * deixar o e-mail para receber o comprovante e acompanhar o pedido. Opcional e
 * pedido UMA vez: depois que o e-mail fica no pedido (ou o banco recusa de vez),
 * o campo some e a frase diz o que aconteceu. Só "e-mail com formato errado" e
 * "não deu para guardar agora" deixam o campo para corrigir ou tentar de novo.
 *
 * Nunca diz que enviou o que não enviou: se o teto diário de e-mails da loja
 * barrar, a frase diz isso — e o e-mail continua guardado para o rastreio.
 */
// O caminho que existe hoje para a visitante: a tela "Meus pedidos" (no celular,
// a aba ao lado do Carrinho) e, nela, "Rastrear sem Conta" (OrderSearch).
const ONDE_ACOMPANHAR =
  "Com este e-mail você acompanha o pedido em “Meus pedidos”, na opção “Rastrear sem Conta”.";

// O e-mail JÁ está no pedido, mas o comprovante não saiu (ou não se sabe).
const MENSAGEM_GUARDADO = {
  teto_diario: `Seu e-mail ficou guardado, mas a loja atingiu o limite de e-mails de hoje e o comprovante não foi enviado. ${ONDE_ACOMPANHAR}`,
  envio_falhou: `Seu e-mail ficou guardado, mas o comprovante não saiu agora. ${ONDE_ACOMPANHAR}`,
  sem_resposta: `Seu e-mail ficou guardado. Não deu para saber se o comprovante foi enviado: confira sua caixa de entrada e o spam. ${ONDE_ACOMPANHAR}`,
} as const;
const MENSAGEM_FORA_DO_PRAZO =
  "O prazo para informar o e-mail deste pedido acabou. Guarde o número do pedido para falar com a loja.";
const MENSAGEM_NAO_ACEITA =
  "Não foi possível guardar o e-mail neste pedido. Guarde o número do pedido para falar com a loja.";

const AVISO_FORMATO =
  "Confira o e-mail: ele precisa ter o formato nome@provedor.com.";
const AVISO_FALHA =
  "Não foi possível guardar o e-mail agora. Confira a conexão e tente de novo.";

function fraseFinal(desfecho: DesfechoDoComprovanteDaVisitante): string {
  if (desfecho.etapa === "enviado") {
    return `Pronto! Enviamos o comprovante para ${desfecho.email}. ${ONDE_ACOMPANHAR}`;
  }
  if (desfecho.etapa === "guardado_sem_envio") {
    return MENSAGEM_GUARDADO[desfecho.motivo];
  }
  return desfecho.motivo === "fora_do_prazo"
    ? MENSAGEM_FORA_DO_PRAZO
    : MENSAGEM_NAO_ACEITA;
}

export function ConviteDoComprovante({
  orderId,
}: Readonly<{ orderId: string }>) {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [final, setFinal] = useState<DesfechoDoComprovanteDaVisitante | null>(
    null,
  );
  // Dois toques seguidos: o segundo não sai enquanto o primeiro está no ar.
  const emCurso = useRef(false);

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (emCurso.current) return;
    if (!emailDaVisitanteValido(email)) {
      setAviso(AVISO_FORMATO);
      return;
    }
    emCurso.current = true;
    setEnviando(true);
    setAviso(null);
    try {
      const desfecho = await pedirComprovanteDaVisitante(orderId, email);
      if (desfecho.etapa === "nao_guardado") {
        if (desfecho.motivo === "email_invalido") {
          setAviso(AVISO_FORMATO);
          return;
        }
        if (desfecho.motivo === "falha") {
          setAviso(AVISO_FALHA);
          return;
        }
      }
      setFinal(desfecho);
    } finally {
      emCurso.current = false;
      setEnviando(false);
    }
  };

  if (final) {
    return (
      <p
        role="status"
        className="break-words rounded-2xl border border-zinc-100 bg-zinc-50 p-4 text-left text-sm font-medium leading-relaxed text-zinc-700"
      >
        {fraseFinal(final)}
      </p>
    );
  }

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-labelledby="convite-comprovante-titulo"
      className="space-y-3 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 text-left"
    >
      <p
        id="convite-comprovante-titulo"
        className="text-sm font-bold leading-snug text-zinc-900"
      >
        Quer receber o comprovante e acompanhar o pedido por e-mail?
      </p>
      <div>
        <label
          htmlFor="convite-comprovante-email"
          className="mb-1.5 ml-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500"
        >
          Seu e-mail (opcional)
        </label>
        <input
          id="convite-comprovante-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (aviso) setAviso(null);
          }}
          placeholder="nome@provedor.com"
          aria-invalid={aviso === AVISO_FORMATO ? true : undefined}
          aria-describedby={aviso ? "convite-comprovante-aviso" : undefined}
          className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-base font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 md:text-sm"
        />
        {aviso && (
          <p
            id="convite-comprovante-aviso"
            role="alert"
            className="ml-1 mt-1.5 text-xs font-bold text-red-700"
          >
            {aviso}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={enviando}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-zinc-900/90 disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Receber por e-mail"}
      </button>
    </form>
  );
}
