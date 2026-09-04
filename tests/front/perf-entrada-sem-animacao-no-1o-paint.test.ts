// F1 "loja abre mais rápido" (frente glm-perf-1paint-0309, equipe
// loja-rapida-0409, 04/09/2026).
//
// O defeito: o entry importava framer-motion estaticamente — direto no
// App.tsx (l.4) e via componentes de chrome importados estaticamente
// (Header, BottomNav, CartReminder, PushNotificationBanner e o
// PWAUpdateManager, que importa UpdateNotification). O Vite até separava a
// biblioteca no chunk `vendor-motion` (~123 KB brutos / ~40 KB gzip), mas o
// import estático fazia dele dependência OBRIGATÓRIA do primeiro paint de
// toda loja.
//
// O conserto: nenhum módulo alcançável por imports ESTÁTICOS a partir do
// entry pode importar framer-motion. A biblioteca continua existindo e as
// animações continuam idênticas — só mudou o endereço: os três usos que
// viviam no App foram para src/components/layouts/AppMotionFallbacks.tsx e
// TODO uso no caminho do entry passa por React.lazy/lazyWithPreload
// (import() dinâmico).
//
// Este teste cavalca a regra caminhando pelo grafo estático de verdade
// (não confia em "ninguém vai re-adicionar"), e prova o outro lado do
// contrato: a animação NÃO foi apagada — o App carrega o módulo dela por
// lazy, e o módulo é o dono do import estático de framer-motion.
//
// Leitura de arquivo via `import.meta.glob` com `?raw` — o padrão da pasta
// para tocar disco sem node:fs (que derruba o typecheck; ver
// fragmento-do-pedido-nao-aceita-curinga.test.ts).
import { describe, expect, it } from "vitest";

const CONTEUDOS = import.meta.glob<string>(
  "/src/**/*.{ts,tsx,js,jsx,mjs,cjs,css,json}",
  { query: "?raw", import: "default", eager: true },
);

const ENTRY = "/src/main.tsx";
const APP = "/src/App.tsx";
const MODULO_DAS_ANIMACOES = "/src/components/layouts/AppMotionFallbacks.tsx";

const EXTENSOES = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", ".json"];

/** Resolve "@/x" e "./x" para a chave do glob ("/src/..."); null se não há. */
function resolverEspecificador(deOnde: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? `/src/${spec.slice(2)}`
    : `${deOnde.slice(0, deOnde.lastIndexOf("/"))}/${spec}`;
  const limpo = (p: string) => p.replaceAll("/./", "/");
  for (const ext of EXTENSOES) {
    for (const candidato of [limpo(base + ext), limpo(`${base}/index${ext}`)]) {
      if (candidato in CONTEUDOS) return candidato;
    }
  }
  return null;
}

/** Imports ESTÁTICOS (from "x" e import "x"); import() dinâmico NÃO entra. */
function importsEstaticos(conteudo: string): string[] {
  const especificadores = new Set<string>();
  const padraoFrom =
    /(?:^|[^\w$])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;
  const padraoLado = /(?:^|[^\w$])import\s*["']([^"']+)["']/g;
  for (const padrao of [padraoFrom, padraoLado]) {
    for (const m of conteudo.matchAll(padrao)) {
      especificadores.add(m[1]);
    }
  }
  return [...especificadores];
}

function grafoEstaticoAPartirDoEntry(): {
  arquivos: string[];
  semResolucao: { de: string; spec: string }[];
} {
  const vistos = new Set<string>();
  const fila = [ENTRY];
  const semResolucao: { de: string; spec: string }[] = [];
  while (fila.length > 0) {
    const arquivo = fila.shift() as string;
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    const conteudo = CONTEUDOS[arquivo];
    for (const spec of importsEstaticos(conteudo)) {
      const externo = !spec.startsWith(".") && !spec.startsWith("@/");
      if (externo) continue;
      const alvo = resolverEspecificador(arquivo, spec);
      if (!alvo) {
        semResolucao.push({ de: arquivo, spec });
        continue;
      }
      if (!vistos.has(alvo)) fila.push(alvo);
    }
  }
  return { arquivos: [...vistos], semResolucao };
}

const importaFramerMotion = (conteudo: string) =>
  /from\s*["']framer-motion(?:\/[^"']*)?["']/.test(conteudo) ||
  /import\s*["']framer-motion(?:\/[^"']*)?["']/.test(conteudo);

describe("perf: o primeiro paint da loja não baixa framer-motion", () => {
  it("o App.tsx não declara import estático de framer-motion", () => {
    expect(importaFramerMotion(CONTEUDOS[APP])).toBe(false);
  });

  it("nenhum módulo do grafo estático do entry importa framer-motion", () => {
    const { arquivos, semResolucao } = grafoEstaticoAPartirDoEntry();
    // A caminhada parte do main.tsx e PRECISA alcançar o App — sem isto a
    // suíte ficaria cega (entry errado, tudo verde por vacuidade).
    expect(arquivos, "o grafo do entry não alcançou o App.tsx").toContain(APP);
    const infratores = arquivos
      .filter((arquivo) => importaFramerMotion(CONTEUDOS[arquivo]))
      .map((arquivo) => arquivo.slice(1));
    expect(
      infratores,
      `Estes módulos estão no caminho ESTÁTICO do entry e puxam ` +
        `framer-motion para o primeiro paint: ${infratores.join(", ")}. ` +
        `Importe-os por React.lazy (ou mova o uso para um módulo lazy) — ` +
        `veja o cabeçalho de src/App.tsx.`,
    ).toEqual([]);
    // Se um import parar de resolver, a caminhada fica cega sem ninguém
    // perceber — os não resolvidos do entry são pacote externo (fora do
    // escopo) ou defeito deste teste.
    expect(semResolucao).toEqual([]);
  });

  it("a animação não morreu: o App carrega as animações por lazy", () => {
    const conteudo = CONTEUDOS[APP];
    expect(conteudo).toContain(
      'import("@/components/layouts/AppMotionFallbacks")',
    );
    // E o módulo das animações é quem detém o import estático — com os
    // mesmos três usos que o App tinha (shells + barra de rota).
    const modulo = CONTEUDOS[MODULO_DAS_ANIMACOES];
    expect(importaFramerMotion(modulo)).toBe(true);
    for (const exportacao of [
      "MainTabsMotionShell",
      "SecondaryViewMotionShell",
      "RouteLoadingProgress",
    ]) {
      expect(modulo).toContain(`export function ${exportacao}`);
    }
  });

  it("os componentes de chrome que usam framer-motion são lazy no App", () => {
    const conteudo = CONTEUDOS[APP];
    // PWAUpdateManager importa UpdateNotification (framer-motion) — o
    // caminho do aviso de update também é lazy.
    for (const modulo of [
      "Header",
      "BottomNav",
      "CartReminder",
      "PushNotificationBanner",
      "PWAUpdateGate",
    ]) {
      const dinamico = new RegExp(`import\\("@/[^"]*${modulo}"\\)`);
      expect(
        dinamico.test(conteudo),
        `${modulo} precisa ser carregado por import() dinâmico no App (ele usa framer-motion).`,
      ).toBe(true);
      const estatico = new RegExp(`from "@/[^"]*${modulo}"`);
      expect(
        estatico.test(conteudo),
        `${modulo} voltou a ser importado estaticamente no App (ele usa framer-motion).`,
      ).toBe(false);
    }
  });
});
