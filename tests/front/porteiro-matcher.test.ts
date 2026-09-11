// O matcher só pode invocar o porteiro para DOCUMENTOS — asset com extensão
// ou arquivo de raiz do build NUNCA (é o que mantém `/index.html` fora dele
// e permite o self-fetch). Rodada B (11/09/2026, brief T3b item 6): a
// exclusão trocou de EXTENSÃO GENÉRICA para LISTA NOMEADA — o crítico e o
// revisor apontaram que excluir por extensão também excluiria qualquer
// rota de documento que um dia ganhasse ponto no nome. `path-to-regexp` não
// está no `package.json` (brief T3): o teste usa a mesma expressão que o
// padrão do matcher já é (regex nativa do Vercel Edge, não sintaxe
// path-to-regexp), via `new RegExp`, e documenta que isto testa a REGRA,
// não o compilador de rota da Vercel.
import { describe, expect, it } from "vitest";

import { CAMINHO_DOCUMENTO_REGEX, matcher } from "@/hospedagem/porteiro";

describe("matcher — os três padrões exportados para config.matcher", () => {
  it("tem exatamente os três padrões do desenho (rodada 2, correção do achado 1: offline.html e google*.html entram na lista de raiz)", () => {
    expect(matcher).toEqual([
      "/((?!assets/|store-identity/|icons/|images/|fonts/|sw\\.js$|workbox-[^/]*\\.js$|version\\.json$|favicon\\.ico$|favicon\\.svg$|logo\\.svg$|apple-touch-icon\\.png$|robots\\.txt$|sitemap\\.xml$|og-image\\.png$|silent-guardian\\.js$|loading\\.css$|404\\.html$|index\\.html$|registerSW\\.js$|offline\\.html$|google[A-Za-z0-9]*\\.html$).*)",
      "/identidade.json",
      "/manifest.webmanifest",
    ]);
  });
});

describe("CAMINHO_DOCUMENTO_REGEX — a regra do primeiro padrão do matcher", () => {
  it("casa a raiz e rotas de documento sem nome reservado", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/")).toBe(true);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/cart")).toBe(true);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/product-detail")).toBe(true);
  });

  it("agora CASA documento com ponto no nome, que a rodada A excluía por extensão genérica", () => {
    // Este é o teste que prova a mudança de rodada: com a exclusão por
    // EXTENSÃO (rodada A), `/qualquer.txt` NÃO casava — a lista nomeada
    // (rodada B) só exclui os nomes de raiz específicos, e qualquer outro
    // documento com ponto no nome agora recebe a ficha normalmente.
    expect(CAMINHO_DOCUMENTO_REGEX.test("/qualquer.txt")).toBe(true);
  });

  it("NÃO casa asset com prefixo reservado (é o que libera o self-fetch dos assets)", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/assets/x.js")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/assets/")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/store-identity/logo")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/icons/foo")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/images/foo")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/fonts/foo")).toBe(false);
  });

  it("NÃO casa os arquivos de raiz nomeados (existem hoje em dist-test/, medido 11/09/2026)", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/sw.js")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/index.html")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/version.json")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/favicon.svg")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/sitemap.xml")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/og-image.png")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/silent-guardian.js")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/loading.css")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/404.html")).toBe(false);
  });

  it("NÃO casa `offline.html` nem o arquivo de verificação do Google Search Console (rodada 2, achado 1: os dois EXISTEM em dist-test/ e casavam o padrão antigo — o porteiro fazia self-fetch de /index.html e devolvia o app shell no lugar deles)", () => {
    // `offline.html` vem de `public/offline.html`, copiado cru pelo Vite para
    // a raiz do build (medido: `ls dist-test/` e `grep -rn offline vite.config.ts`
    // não achou geração própria — é asset estático, não gerado pelo SW).
    expect(CAMINHO_DOCUMENTO_REGEX.test("/offline.html")).toBe(false);
    // O nome é gerado pelo console do Google a cada reverificação
    // (`google<hash>.html`) — por isso o padrão é por PREFIXO `google`, não
    // pelo nome exato de hoje (`google8e0e5366e254e024.html`), e sobrevive a
    // uma reverificação futura com hash diferente.
    expect(CAMINHO_DOCUMENTO_REGEX.test("/google8e0e5366e254e024.html")).toBe(
      false,
    );
    expect(CAMINHO_DOCUMENTO_REGEX.test("/googleOUTROHASH123.html")).toBe(
      false,
    );
  });

  it("NÃO casa os arquivos de raiz nomeados que não existem neste build mas entram por nome (favicon.ico, logo.svg, apple-touch-icon.png, robots.txt, registerSW.js)", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/favicon.ico")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/logo.svg")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/apple-touch-icon.png")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/robots.txt")).toBe(false);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/registerSW.js")).toBe(false);
  });

  it("workbox-*.js: NÃO casa, e vale tanto na raiz quanto dentro de assets/ (a raiz é prevenção, assets/ já cobre o caso real de hoje)", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/workbox-window.js")).toBe(false);
    expect(
      CAMINHO_DOCUMENTO_REGEX.test("/assets/workbox-window.prod.es5-x.js"),
    ).toBe(false);
  });

  it("nome de raiz reservado seguido de mais texto NÃO é excluído — o `$` ancora no fim (ex.: hipotético `/sw.jsx`)", () => {
    // Prova de que a ausência de `$` seria um bug: sem ancorar, "sw.js"
    // apareceria como prefixo de "sw.jsx" e excluiria um caminho que não é
    // o service worker.
    expect(CAMINHO_DOCUMENTO_REGEX.test("/sw.jsx")).toBe(true);
  });

  it("`/identidade.json` e `/manifest.webmanifest` TAMBÉM casam este padrão agora — nenhum dos dois nomes está na lista de raiz reservada (mudança de rodada: a extensão genérica os excluía antes, a lista nomeada não)", () => {
    expect(CAMINHO_DOCUMENTO_REGEX.test("/identidade.json")).toBe(true);
    expect(CAMINHO_DOCUMENTO_REGEX.test("/manifest.webmanifest")).toBe(true);
  });
});
