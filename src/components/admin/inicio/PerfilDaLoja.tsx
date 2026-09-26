import { ExternalLink, MapPin, UserRound } from "lucide-react";
import { useState } from "react";

/**
 * Cartão de identidade do Início: logo (ou a inicial), nome da loja,
 * cidade/UF, quem está no comando e o atalho para ver a vitrine como o
 * cliente vê. Componente puro — quem lê `useStore`/`useAuth` é a ponte em
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

      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="relative flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:border-admin-gold/30 hover:text-white"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        <span className="sr-only xs:not-sr-only">Ver loja</span>
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    </section>
  );
}
