// Tipos de `classificarPedidos.mjs` para quem o importa de um .ts --
// tests/front/medir-pedidos-separa-rede-de-cache.test.ts. Sem `allowJs` no
// projeto, o import do .mjs vira TS7016 (implicit any); o `.d.mts` de mesmo
// nome é o par que o TypeScript associa sozinho.

export interface EventoDeRede {
  readonly origem: string;
  readonly method: string;
  /** Parâmetros crus do evento CDP. */
  readonly params: unknown;
}

export interface ContagemDaOrigem {
  rede: number;
  cache: number;
  servidosPeloSW: number;
  falhas: number;
  semResposta: number;
  urls: string[];
}

export function classificarPedidos(eventos: readonly EventoDeRede[]): {
  rede: number;
  pagina: ContagemDaOrigem;
  sw: ContagemDaOrigem;
};
