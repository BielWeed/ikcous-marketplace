// O AdminLayout dispara um Escape SINTÉTICO a cada troca de tela (para fechar
// menu/diálogo do Radix pendurado). Quem trata Esc como "o lojista quis
// fechar" (ex.: a ficha da devolução em tela cheia) precisa ignorar esse:
// ele não é do usuário. `isTrusted` não serve — o jsdom só produz eventos
// não confiáveis — por isso o layout MARCA o evento antes do dispatch.
const sinteticos = new WeakSet<Event>();

export function marcarEscapeSintetico(evento: Event): void {
  sinteticos.add(evento);
}

export function ehEscapeSintetico(evento: Event): boolean {
  return sinteticos.has(evento);
}
