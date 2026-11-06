import { cn } from "@/lib/utils";
import React from "react";

/**
 * A simple markdown-like renderer that handles:
 * - Line breaks (\n)
 * - Bold (**text**)
 * - Simple headers (# a ###### Header) — só a PRIMEIRA linha do bloco é título;
 *   as linhas coladas abaixo dela seguem o fluxo normal (parágrafo ou lista).
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

/**
 * Título de uma linha: de 1 a 6 "#" seguidos de espaço e de texto ("## Algo").
 * Devolve só o texto, sem os "#". Conta os "#" num laço, sem regex aninhada.
 * "#hashtag" (sem espaço) e 7+ "#" não são título.
 */
function textoDoTitulo(linha: string): string | null {
  const limpa = linha.trim();
  let hashes = 0;
  while (limpa.charAt(hashes) === "#") hashes++;
  if (hashes < 1 || hashes > 6) return null;
  const resto = limpa.slice(hashes);
  // Precisa de espaço logo depois dos "#". A linha já veio aparada, então se
  // há espaço ali há texto de verdade depois dele.
  if (!/\s/.test(resto.charAt(0))) return null;
  return resto.trim();
}

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

// Corpo de um bloco (as linhas que NÃO são o título): separador, lista, título
// em negrito + lista ou parágrafo comum.
function renderCorpo(lines: string[], i: number) {
  // Um parágrafo que é SÓ um separador (---) vira <hr/>, não texto.
  if (lines.every((l) => ehSeparador(l))) {
    return <hr key={i} className="border-zinc-200" />;
  }

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

  // Process line breaks and bold within the paragraph
  return (
    <p
      key={i}
      className={cn("text-sm leading-relaxed text-gray-600", "lg:text-base")}
    >
      {lines.map((line, lineIdx) => (
        <React.Fragment key={lineIdx}>
          {processInline(line)}
          {lineIdx < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </p>
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
        const lines = para.split("\n");

        // Título: só a PRIMEIRA linha não vazia do bloco. As linhas coladas
        // abaixo dele (sem linha em branco) seguem o fluxo normal — antes o
        // bloco inteiro virava um <h3> gigante de uma linha só.
        const primeiraLinha = lines.find((l) => l.trim() !== "");
        const titulo =
          primeiraLinha !== undefined ? textoDoTitulo(primeiraLinha) : null;
        if (titulo !== null) {
          // A primeira linha não vazia é sempre a primeira ocorrência do texto.
          const abaixo = lines.slice(lines.indexOf(primeiraLinha!) + 1);
          return (
            <React.Fragment key={i}>
              <h3 className="mb-2 mt-6 text-lg font-black text-zinc-900">
                {titulo}
              </h3>
              {abaixo.some((l) => l.trim() !== "")
                ? renderCorpo(abaixo, i)
                : null}
            </React.Fragment>
          );
        }

        return renderCorpo(lines, i);
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
