import { Button } from "@/components/ui/button";
import { BannerProntoPreview } from "@/components/ui/custom/BannerPronto";
import type { ModeloDeBanner } from "@/lib/banner-modelos";
import { INFO_DOS_MODELOS } from "@/lib/catalogo-de-banners";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function GaleriaDeBanners({
  aoEscolher,
  fotoUrl = "",
}: {
  aoEscolher: (modelo: ModeloDeBanner) => void;
  fotoUrl?: string;
}) {
  const [modelo, definirModelo] = useState<ModeloDeBanner>("destaque");
  const [grupo, definirGrupo] = useState("todos");
  const nome = INFO_DOS_MODELOS.find((m) => m.id === modelo)?.nome;
  return (
    <section className="space-y-5" aria-labelledby="galeria-de-banners">
      <div>
        <h2 id="galeria-de-banners" className="text-2xl font-bold text-white">
          Escolha um modelo
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Vamos preencher com seu produto.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Tipos de modelo">
        {[
          ["todos", "Todos"],
          ["promocao", "Promoção"],
          ["lancamento", "Lançamento"],
          ["simples", "Simples"],
        ].map(([id, rotulo]) => (
          <button
            type="button"
            key={id}
            aria-pressed={grupo === id}
            onClick={() => definirGrupo(id)}
            className={cn(
              "min-h-11 rounded-full border border-admin-border px-3 text-sm ring-1 ring-inset ring-admin-border-strong",
              grupo === id
                ? "bg-white text-zinc-950 ring-1 ring-inset ring-admin-border-strong hover:ring-current"
                : "bg-admin-surface text-zinc-400",
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {INFO_DOS_MODELOS.filter(
          (m) => grupo === "todos" || m.grupo === grupo,
        ).map((m) => (
          <article
            key={m.id}
            className={cn(
              "min-w-0 overflow-hidden rounded-2xl border bg-admin-surface p-2",
              modelo === m.id
                ? "border-admin-border-strong ring-1 ring-current"
                : "border-admin-border",
            )}
          >
            <div
              data-tema-fixo=""
              className="pointer-events-none aspect-[2/1] overflow-hidden rounded-xl"
              aria-hidden="true"
            >
              <BannerProntoPreview
                modelo={m.id}
                corHex={
                  m.id === "claro" || m.id === "vitrine" ? "#EDEDF0" : "#2A2A31"
                }
                fotoUrl={fotoUrl}
                titulo={m.id === "promocao" ? "-30%" : "Seu produto"}
                subtitulo="Uma novidade para você"
                botao="Confira"
                selo={m.id === "lancamento" ? "LANÇAMENTO" : undefined}
              />
            </div>
            <button
              type="button"
              aria-pressed={modelo === m.id}
              onClick={() => definirModelo(m.id)}
              className="min-h-11 w-full rounded-lg text-left text-sm font-semibold text-white ring-1 ring-inset ring-admin-border-strong"
            >
              {m.nome}
            </button>
            <p className="pb-2 text-xs text-zinc-400">{m.descricao}</p>
          </article>
        ))}
      </div>
      <Button
        className="min-h-11 w-full bg-white text-zinc-950 ring-1 ring-inset ring-admin-border-strong hover:ring-current hover:bg-white"
        onClick={() => aoEscolher(modelo)}
      >
        Usar o modelo {nome}
      </Button>
    </section>
  );
}
