import { cn } from "@/lib/utils";
import React from "react";

/**
 * A simple markdown-like renderer that handles:
 * - Line breaks (\n)
 * - Bold (**text**)
 * - Simple headers (### Header)
 * - Lists (* Item / - Item) — F3, 29/09: a prévia de desktop mostrava os
 *   asteriscos LITERAIS da descrição ("* 📖 50 Páginas…") porque o renderer
 *   prometia listas no comentário e nunca as implementou. Blocos cujas
 *   linhas começam com "* " ou "- " viram <ul>/<li> com marcador de verdade.
 * - Separador (---): linha só de traços virava texto cru no meio da
 *   descrição; agora é um <hr/> discreto.
 * - Emojis (already supported by unicode strings)
 *
 * O literal do parágrafo ("text-sm leading-relaxed text-gray-600" +
 * "lg:text-base") é contrato do teste F3.6 — não editar, apenas acrescentar.
 */
interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const ehItemDeLista = (linha: string) => /^[*-]\s+/.test(linha);
const ehSeparador = (linha: string) =>
  /^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(linha);

const ehTituloEmNegrito = (linha: string) =>
  /^\*\*[^*]+\*\*:?\s*$/.test(linha.trim());

function renderLista(itens: string[], chave: number) {
  return (
    <ul
      key={chave}
      className={cn(
        "list-disc space-y-1.5 pl-5 marker:text-zinc-400",
        "lg:pl-6",
      )}
    >
      {itens.map((line, lineIdx) => (
        <li
          key={lineIdx}
          className={cn(
            "text-sm leading-relaxed text-gray-600",
            "lg:text-base",
          )}
        >
          {processInline(line.replace(/^[*-]\s+/, ""))}
        </li>
      ))}
    </ul>
  );
}

export function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  if (!content) return null;

  // Split by double newlines for paragraphs
  const paragraphs = content.split(/\n\n+/);

  return (
    <div className={`space-y-4 ${className}`}>
      {paragraphs.map((para, i) => {
        // Check if it's a header
        if (para.startsWith("###")) {
          return (
            <h3 key={i} className="mb-2 mt-6 text-lg font-black text-zinc-900">
              {para.replace("###", "").trim()}
            </h3>
          );
        }

        // Um parágrafo que é SÓ um separador (---) vira <hr/>, não texto.
        if (para.split("\n").every((l) => ehSeparador(l))) {
          return <hr key={i} className="border-zinc-200" />;
        }

        // Process line breaks and bold within the paragraph
        const lines = para.split("\n");

        // Bloco de lista: TODAS as linhas (não vazias) começam com "* " ou
        // "- " — é a forma que a lojista escreve na descrição. Renderiza
        // <ul> com marcador; linha solta no meio de texto segue parágrafo.
        const naoVazias = lines.filter((l) => l.trim() !== "");
        if (naoVazias.length > 0 && naoVazias.every(ehItemDeLista)) {
          return renderLista(naoVazias, i);
        }

        // Lista colada numa linha de título em negrito, sem linha em branco
        // (título em negrito seguido de "* Tema: …"): o título vira parágrafo e
        // o resto vira lista. Só esse caso — "texto comum" seguido de "* item"
        // segue parágrafo.
        const [primeira, ...resto] = naoVazias;
        if (
          primeira !== undefined &&
          ehTituloEmNegrito(primeira) &&
          resto.length > 0 &&
          resto.every(ehItemDeLista)
        ) {
          return (
            <React.Fragment key={i}>
              <p
                className={cn(
                  "text-sm leading-relaxed text-gray-600",
                  "lg:text-base",
                )}
              >
                {processInline(primeira)}
              </p>
              {renderLista(resto, i)}
            </React.Fragment>
          );
        }

        return (
          <p
            key={i}
            className={cn(
              "text-sm leading-relaxed text-gray-600",
              "lg:text-base",
            )}
          >
            {lines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {processInline(line)}
                {lineIdx < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function processInline(text: string) {
  // Simple regex for bold **text**
  const parts = text.split(/(\*\*.*?\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-black text-zinc-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
