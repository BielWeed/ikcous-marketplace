import { Button } from "@/components/ui/button";
import { BannerProntoPreview } from "@/components/ui/custom/BannerPronto";
import { Sparkles, Upload } from "lucide-react";

export function EscolherCriacaoDoBanner({
  aoEscolher,
}: {
  aoEscolher: (jeito: "modelos" | "editor" | "ia") => void;
}) {
  return (
    <section className="space-y-5" aria-labelledby="como-criar-banner">
      <div>
        <h2 id="como-criar-banner" className="text-2xl font-bold text-white">
          Como você quer criar?
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Escolha o jeito mais fácil para você.
        </p>
      </div>
      <article className="space-y-3 rounded-3xl border border-admin-border-strong bg-admin-surface p-4">
        <div
          data-tema-fixo=""
          className="aspect-[2/1] max-w-52 overflow-hidden rounded-xl"
        >
          <BannerProntoPreview
            modelo="destaque"
            corHex="#2A2A31"
            fotoUrl=""
            titulo="Seu produto em destaque"
            subtitulo="Foto e link vêm do cadastro"
            botao="Confira"
          />
        </div>
        <p className="text-sm text-zinc-400">
          Recomendado · Escolha um modelo e seu produto. Sem criar uma arte.
        </p>
        <Button
          className="min-h-11 w-full bg-white text-zinc-950 hover:bg-zinc-200"
          onClick={() => aoEscolher("modelos")}
        >
          Modelo pronto
        </Button>
      </article>
      <article className="space-y-3 rounded-3xl border border-admin-border bg-admin-surface p-4">
        <Upload aria-hidden="true" className="size-6 text-zinc-400" />
        <p className="text-sm text-zinc-400">
          Envie sua arte pronta. Se quiser, coloque texto e botão por cima.
        </p>
        <Button
          variant="outline"
          className="min-h-11 w-full border-admin-border bg-admin-raised text-white"
          onClick={() => aoEscolher("editor")}
        >
          Usar minha imagem
        </Button>
      </article>
      <article className="space-y-3 rounded-3xl border border-admin-border bg-admin-surface p-4">
        <Sparkles aria-hidden="true" className="size-6 text-zinc-400" />
        <p className="text-sm text-zinc-400">
          Copie um texto pronto e crie a imagem no ChatGPT ou no Gemini. Eu
          explico como.
        </p>
        <Button
          variant="outline"
          className="min-h-11 w-full border-admin-border bg-admin-raised text-white"
          onClick={() => aoEscolher("ia")}
        >
          Criar com IA
        </Button>
      </article>
    </section>
  );
}
