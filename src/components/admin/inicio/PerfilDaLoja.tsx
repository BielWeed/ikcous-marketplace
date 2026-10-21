import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { CheckCircle2, MapPin, Share2, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Cartão de identidade do Início: logo (ou a inicial), nome da loja,
 * cidade/UF, quem está no comando e o botão de compartilhar o link da loja
 * (WhatsApp/Instagram). O antigo "Ver loja" saiu: o botão Voltar do Perfil
 * já leva para a vitrine — dois botões para o mesmo lugar não fazem sentido.
 * Componente puro — quem lê `useStore`/`useAuth` é a ponte em
 * `AdminDashboardView`.
 */
export function PerfilDaLoja({
  nome,
  logoUrl,
  cidade,
  uf,
  responsavel,
}: Readonly<{
  nome: string;
  logoUrl: string | null;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
}>) {
  const [logoFalhou, setLogoFalhou] = useState(false);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const inicial = nome.trim().charAt(0).toUpperCase() || "L";
  const local = [cidade, uf].filter(Boolean).join(" / ");

  async function compartilharLoja() {
    setLinkCopiado(false);
    const url = `${window.location.origin}/`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: nome,
          text: `Conheça a ${nome} — compre pelo app:`,
          url,
        });
      } catch (erro) {
        // Cancelar o share (usuário fechou a folha) não é falha — é a pessoa
        // desistindo. Só avisa quando o motivo é outro (sem permissão etc.).
        if ((erro as { name?: string } | null)?.name !== "AbortError") {
          toast.error("Não foi possível compartilhar agora");
        }
      }
      return;
    }
    // Desktop não tem Web Share API: cai para copiar o link, mesma regra do
    // `copiarParaClipboard` (só comemora quando DEU CERTO).
    if (await copiarParaClipboard(url)) {
      toast.success("Link da loja copiado");
      setLinkCopiado(true);
    } else {
      toast.error("Não foi possível compartilhar agora");
    }
  }

  return (
    <section
      aria-label="Sua loja"
      className="min-w-0 rounded-[22px] border border-admin-border bg-admin-surface p-3 lg:border-0 lg:bg-transparent lg:p-0"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-admin-border bg-sky-400/10 text-sky-300">
          {logoUrl && !logoFalhou ? (
            <img
              src={logoUrl}
              alt={`Logo da ${nome}`}
              className="size-full object-cover"
              onError={() => setLogoFalhou(true)}
            />
          ) : (
            <span
              aria-hidden="true"
              className="text-2xl font-bold text-sky-300"
            >
              {inicial}
            </span>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <h2 className="break-words text-base font-bold leading-snug text-white [overflow-wrap:anywhere]">
            {nome}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
            {local ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {local}
              </span>
            ) : null}
            {responsavel ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="break-words [overflow-wrap:anywhere]">
                  {responsavel}
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void compartilharLoja()}
          aria-label="Compartilhar o link da loja"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300 transition-colors hover:bg-sky-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <Share2 className="size-5" aria-hidden="true" />
          <span className="sr-only" aria-hidden="true">
            Compartilhar
          </span>
        </button>
      </div>
      {linkCopiado ? (
        <div
          role="status"
          className="mt-3 space-y-2 border-t border-admin-border pt-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-teal-300">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            Endereço da loja copiado
          </p>
          <p className="text-sm leading-relaxed text-zinc-400">
            Compartilhamento indisponível neste aparelho. Cole o endereço na
            conversa.
          </p>
        </div>
      ) : null}
    </section>
  );
}
