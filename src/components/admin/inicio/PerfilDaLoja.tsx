import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { MapPin, Share2, UserRound } from "lucide-react";
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
  const inicial = nome.trim().charAt(0).toUpperCase() || "L";
  const local = [cidade, uf].filter(Boolean).join(" / ");

  async function compartilharLoja() {
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
    } else {
      toast.error("Não foi possível compartilhar agora");
    }
  }

  return (
    <section
      aria-label="Sua loja"
      className="admin-glass relative flex items-center gap-4 overflow-hidden rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-5"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-admin-gold/[0.06] blur-3xl" />
      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 sm:size-16">
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
            className="text-2xl font-black italic text-admin-gold"
          >
            {inicial}
          </span>
        )}
      </div>

      <div className="relative min-w-0 flex-1">
        <h2 className="truncate text-lg font-black tracking-tight text-white sm:text-xl">
          {nome}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          {local ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              {local}
            </span>
          ) : null}
          {responsavel ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{responsavel}</span>
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void compartilharLoja()}
        aria-label="Compartilhar o link da loja"
        className="relative flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-[11px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:border-admin-gold/30 hover:text-white"
      >
        <Share2 className="size-4" aria-hidden="true" />
        <span className="sr-only xs:not-sr-only" aria-hidden="true">
          Compartilhar
        </span>
      </button>
    </section>
  );
}
