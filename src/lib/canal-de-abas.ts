export function criarCanalDeAbas(nome: string): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }
  try {
    return new BroadcastChannel(nome);
  } catch {
    return null;
  }
}
