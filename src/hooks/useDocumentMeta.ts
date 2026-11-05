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

interface Original {
  readonly conteudo: string | null;
  readonly criada: boolean;
}

interface Pilha {
  readonly original: Original;
  readonly entradas: { readonly valor: string }[];
}

interface Alvo {
  capturar(): Original;
  gravar(valor: string): void;
  devolver(original: Original): void;
}

/**
 * Cada título ou meta tem uma PILHA de quem o escreveu. A Home fica montada por
 * baixo das telas secundárias e, no fallback de animação, a tela que sai só
 * limpa DEPOIS de a que entra ter escrito: guardar "o valor de antes" em cada
 * chamada devolveria um título velho por cima do novo. Com a pilha, quem sai
 * tira só a sua entrada e vale a de cima; com a pilha vazia volta o original.
 */
const pilhas = new Map<string, Pilha>();

const empilhar = (chave: string, valor: string, alvo: Alvo): (() => void) => {
  let pilha = pilhas.get(chave);
  if (!pilha) {
    pilha = { original: alvo.capturar(), entradas: [] };
    pilhas.set(chave, pilha);
  }
  const entrada = { valor };
  pilha.entradas.push(entrada);
  alvo.gravar(valor);
  return () => {
    const atual = pilhas.get(chave);
    if (!atual) return;
    const posicao = atual.entradas.indexOf(entrada);
    if (posicao >= 0) atual.entradas.splice(posicao, 1);
    const topo = atual.entradas.at(-1);
    if (topo) {
      alvo.gravar(topo.valor);
    } else {
      pilhas.delete(chave);
      alvo.devolver(atual.original);
    }
  };
};

const alvoDoTitulo: Alvo = {
  capturar: () => ({ conteudo: document.title, criada: false }),
  gravar: (valor) => {
    document.title = valor;
  },
  devolver: (original) => {
    document.title = original.conteudo ?? "";
  },
};

const alvoDaMeta = (attr: "name" | "property", key: string): Alvo => {
  // Sem CSS.escape aqui: o valor está entre aspas no seletor de atributo, então
  // escapar transformaria "og:title" em "og\:title" e o seletor deixaria de casar
  // com a tag estática do index.html — criando uma duplicata em vez de atualizá-la.
  // (As chaves são constantes nossas, não entrada de usuário.)
  const selector = `meta[${attr}="${key}"]`;
  const achar = () => document.head.querySelector<HTMLMetaElement>(selector);
  return {
    capturar: () => {
      const tag = achar();
      return { conteudo: tag?.getAttribute("content") ?? null, criada: !tag };
    },
    gravar: (valor) => {
      let tag = achar();
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.append(tag);
      }
      tag.setAttribute("content", valor);
    },
    devolver: (original) => {
      const tag = achar();
      if (!tag) return;
      if (original.criada) tag.remove();
      else if (original.conteudo === null) tag.removeAttribute("content");
      else tag.setAttribute("content", original.conteudo);
    },
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

    // O que esta tela escreve é devolvido ao sair (ver a pilha acima).
    const desfazer: Array<() => void> = [];
    const desfazerTudo = () => {
      for (const parar of desfazer.reverse()) parar();
    };

    if (title) desfazer.push(empilhar("titulo", title, alvoDoTitulo));

    for (const [key, value] of Object.entries(
      JSON.parse(namesKey) as Record<string, string | undefined>,
    )) {
      if (value)
        desfazer.push(empilhar(`name:${key}`, value, alvoDaMeta("name", key)));
    }

    for (const [key, value] of Object.entries(
      JSON.parse(propsKey) as Record<string, string | undefined>,
    )) {
      if (value)
        desfazer.push(
          empilhar(`property:${key}`, value, alvoDaMeta("property", key)),
        );
    }

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
