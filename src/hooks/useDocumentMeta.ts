import { useEffect } from "react";

/**
 * Aplica título, metatags e JSON-LD da view atual.
 *
 * Substitui o `react-helmet-async`, que declara suporte só até o React 18 e,
 * sob o React 19 deste projeto, não injetava absolutamente nada: medindo o DOM
 * em produção, `document.querySelectorAll('[data-rh]').length` era 0 e nenhum
 * `<script type="application/ld+json">` chegava à página. Todo o SEO escrito
 * nas views era código morto.
 *
 * A escrita aqui é imperativa de propósito: faz *upsert* pelo seletor, então
 * atualiza as tags que já existem no index.html em vez de duplicá-las — que é
 * o que aconteceria deixando o React 19 hoistar `<meta>` por conta própria.
 *
 * Limite conhecido: isto roda no cliente. Crawlers que não executam JavaScript
 * (o do WhatsApp, entre outros) continuam lendo as tags estáticas do index.html.
 * Prévia de link por produto exige SSR ou prerender — não é resolvido aqui.
 */

export interface DocumentMetaOptions {
  readonly title?: string;
  /** metatags por `name=` (description, twitter:*) */
  readonly names?: Readonly<Record<string, string | undefined>>;
  /** metatags por `property=` (og:*) */
  readonly properties?: Readonly<Record<string, string | undefined>>;
  /** objeto de dados estruturados schema.org */
  readonly jsonLd?: unknown;
  /** id do <script> de JSON-LD, para não misturar o schema de views diferentes */
  readonly jsonLdId?: string;
}

/** Grava a meta e devolve como desfazer: restaura o conteúdo anterior ou remove a tag que esta chamada criou. */
const upsertMeta = (
  attr: "name" | "property",
  key: string,
  value: string,
): (() => void) => {
  // Sem CSS.escape aqui: o valor está entre aspas no seletor de atributo, então
  // escapar transformaria "og:title" em "og\:title" e o seletor deixaria de casar
  // com a tag estática do index.html — criando uma duplicata em vez de atualizá-la.
  // (As chaves são constantes nossas, não entrada de usuário.)
  const selector = `meta[${attr}="${key}"]`;
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  const criada = !tag;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.append(tag);
  }
  const anterior = tag.getAttribute("content");
  tag.setAttribute("content", value);
  const gravada = tag;
  return () => {
    if (criada) gravada.remove();
    else if (anterior === null) gravada.removeAttribute("content");
    else gravada.setAttribute("content", anterior);
  };
};

export function useDocumentMeta({
  title,
  names,
  properties,
  jsonLd,
  jsonLdId = "app-structured-data",
}: DocumentMetaOptions): void {
  const namesKey = JSON.stringify(names ?? {});
  const propsKey = JSON.stringify(properties ?? {});
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : "";

  useEffect(() => {
    if (typeof document === "undefined") return;

    // Tudo que esta tela escreve é devolvido ao sair: a Home fica montada por baixo das
    // telas secundárias e não reescreve o título quando a cliente volta para ela.
    const desfazer: Array<() => void> = [];
    if (title) {
      const tituloAnterior = document.title;
      document.title = title;
      desfazer.push(() => {
        document.title = tituloAnterior;
      });
    }

    for (const [key, value] of Object.entries(
      JSON.parse(namesKey) as Record<string, string | undefined>,
    )) {
      if (value) desfazer.push(upsertMeta("name", key, value));
    }

    for (const [key, value] of Object.entries(
      JSON.parse(propsKey) as Record<string, string | undefined>,
    )) {
      if (value) desfazer.push(upsertMeta("property", key, value));
    }

    const desfazerTudo = () => {
      for (const f of desfazer.reverse()) f();
    };

    if (!jsonLdKey) return desfazerTudo;

    let script = document.head.querySelector<HTMLScriptElement>(
      `script#${CSS.escape(jsonLdId)}`,
    );
    if (!script) {
      script = document.createElement("script");
      script.id = jsonLdId;
      script.type = "application/ld+json";
      document.head.append(script);
    }
    script.textContent = jsonLdKey;

    // Remover ao desmontar: o schema de Produto não pode sobreviver à saída
    // da página do produto e acabar descrevendo a Home.
    return () => {
      document.getElementById(jsonLdId)?.remove();
      desfazerTudo();
    };
  }, [title, namesKey, propsKey, jsonLdKey, jsonLdId]);
}
