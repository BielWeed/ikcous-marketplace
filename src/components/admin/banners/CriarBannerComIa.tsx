import { OpcoesDaBusca } from "@/components/admin/BarraDeBusca";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  OBJETIVOS,
  type ObjetivoDoBanner,
  PASSOS_DA_IA,
  ROTULOS_DOS_OBJETIVOS,
  gerarPromptDeBanner,
} from "@/lib/prompt-de-banner";
import { ArrowLeft, Copy, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

interface CriarBannerComIaProps {
  nomeDaLoja?: string;
  produtoInicial?: string;
  aoEscolherImagem(file: File): void;
  aoVoltar(): void;
}

export function CriarBannerComIa({
  nomeDaLoja,
  produtoInicial = "",
  aoEscolherImagem,
  aoVoltar,
}: CriarBannerComIaProps) {
  const id = useId();
  const [objetivo, definirObjetivo] = useState<ObjetivoDoBanner>("promocao");
  const [produto, definirProduto] = useState(produtoInicial);
  const [estilo, definirEstilo] = useState<"escuro" | "claro">("escuro");
  const [copiando, definirCopiando] = useState(false);
  const [aviso, definirAviso] = useState({ texto: "", mensagem: "" });
  const caixaDeTexto = useRef<HTMLTextAreaElement>(null);
  const entradaDeImagem = useRef<HTMLInputElement>(null);
  const texto = gerarPromptDeBanner({
    objetivo,
    nomeDoProduto: produto,
    nomeDaLoja,
    estilo,
  });

  async function copiarTexto() {
    definirCopiando(true);
    definirAviso({ texto, mensagem: "" });
    let copiou = false;
    try {
      await navigator.clipboard.writeText(texto);
      copiou = true;
    } catch {
      const caixa = caixaDeTexto.current;
      const focoAnterior = document.activeElement;
      try {
        if (caixa) {
          caixa.focus({ preventScroll: true });
          caixa.select();
          copiou = document.execCommand("copy");
        }
      } catch {
        copiou = false;
      } finally {
        if (copiou && focoAnterior instanceof HTMLElement) {
          focoAnterior.focus({ preventScroll: true });
        }
      }
    } finally {
      definirCopiando(false);
      definirAviso({
        texto,
        mensagem: copiou
          ? "Texto copiado"
          : "Não deu para copiar. Selecione o texto e copie.",
      });
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 text-zinc-100">
      <header className="space-y-4">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 min-w-11 text-zinc-200"
          onClick={aoVoltar}
          aria-label="Voltar"
        >
          <ArrowLeft aria-hidden="true" /> Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Criar a imagem com IA</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Copie o texto e cole no ChatGPT ou no Gemini para criar a imagem.
          </p>
        </div>
      </header>

      <section aria-labelledby={`${id}-objetivo`} className="space-y-4">
        <h2 id={`${id}-objetivo`} className="text-base font-semibold">
          1. O que você quer divulgar?
        </h2>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Objetivo do banner"
        >
          <OpcoesDaBusca
            opcoes={OBJETIVOS.map((valor) => ({
              valor,
              rotulo: ROTULOS_DOS_OBJETIVOS.get(valor) ?? valor,
              selecionada: objetivo === valor,
              onClick: () => definirObjetivo(valor),
            }))}
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor={`${id}-produto`}
            className="block text-sm text-zinc-300"
          >
            Nome do produto (opcional)
          </label>
          <Input
            id={`${id}-produto`}
            type="text"
            value={produto}
            maxLength={100}
            onChange={(evento) => definirProduto(evento.target.value)}
            className="min-h-11 border-admin-border-strong bg-admin-raised text-zinc-100"
            placeholder="Ex.: Camiseta azul"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm text-zinc-400">Fundo da imagem</legend>
          <div className="flex flex-wrap gap-2">
            <OpcoesDaBusca
              opcoes={(["escuro", "claro"] as const).map((valor) => ({
                valor,
                rotulo: valor === "escuro" ? "Escuro" : "Claro",
                selecionada: estilo === valor,
                onClick: () => definirEstilo(valor),
              }))}
            />
          </div>
        </fieldset>
      </section>

      <section aria-labelledby={`${id}-copiar`} className="space-y-3">
        <h2 id={`${id}-copiar`} className="text-base font-semibold">
          <label htmlFor={`${id}-texto`}>2. Copie este texto</label>
        </h2>
        <Textarea
          ref={caixaDeTexto}
          id={`${id}-texto`}
          value={texto}
          readOnly
          rows={8}
          className="w-full resize-y rounded-2xl border-admin-border-strong bg-admin-raised p-4 text-sm leading-relaxed text-zinc-200"
        />
        <Button
          type="button"
          onClick={copiarTexto}
          disabled={copiando}
          className="min-h-11 w-full whitespace-normal bg-admin-gold font-bold text-black hover:bg-admin-gold/90"
        >
          <Copy aria-hidden="true" />
          {copiando ? "Copiando…" : "Copiar texto"}
        </Button>
        <p role="status" aria-atomic="true" className="text-sm text-zinc-300">
          {aviso.texto === texto ? aviso.mensagem : ""}
        </p>
      </section>

      <section aria-labelledby={`${id}-enviar`} className="space-y-4">
        <h2 id={`${id}-enviar`} className="text-base font-semibold">
          3. Cole e traga a imagem pronta
        </h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-zinc-300">
          {PASSOS_DA_IA.map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
        <input
          ref={entradaDeImagem}
          type="file"
          accept="image/*"
          aria-label="Escolher imagem pronta"
          hidden
          onChange={(evento) => {
            const arquivo = evento.target.files?.[0];
            evento.target.value = "";
            if (arquivo) aoEscolherImagem(arquivo);
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => entradaDeImagem.current?.click()}
          className="min-h-11 w-full whitespace-normal border-admin-border-strong bg-admin-raised text-zinc-100"
        >
          <Upload aria-hidden="true" /> Enviar a imagem pronta
        </Button>
      </section>
    </div>
  );
}
