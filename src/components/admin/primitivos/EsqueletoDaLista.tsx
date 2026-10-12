/**
 * Esqueleto de lista em carregamento. `aria-busy` + texto sr-only para quem
 * usa leitor de tela (as barras cinzas sozinhas não dizem nada).
 */
export function EsqueletoDaLista({
  linhas = 3,
}: {
  readonly linhas?: number;
}) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div
          // Linhas idênticas e estáticas: o índice é a chave certa.
          key={i}
          aria-hidden="true"
          data-linha-do-esqueleto=""
          className="h-16 animate-pulse rounded-2xl bg-zinc-900/60"
        />
      ))}
    </div>
  );
}
