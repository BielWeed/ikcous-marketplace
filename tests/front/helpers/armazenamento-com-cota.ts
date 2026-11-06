// Um `localStorage` de mentira com COTA, para provar o que acontece quando o
// aparelho enche: `setItem` lança `QuotaExceededError` se a soma de chaves e
// valores passar do limite (em caracteres), como o navegador faz (~5 MB).
export class ArmazenamentoComCota {
  private readonly dados = new Map<string, string>();

  private readonly limite: number;

  constructor(limite: number) {
    this.limite = limite;
  }

  get length(): number {
    return this.dados.size;
  }

  key(indice: number): string | null {
    return [...this.dados.keys()].at(indice) ?? null;
  }

  getItem(chave: string): string | null {
    return this.dados.get(chave) ?? null;
  }

  setItem(chave: string, valor: string): void {
    const depois = new Map(this.dados).set(chave, String(valor));
    let total = 0;
    for (const [k, v] of depois) total += k.length + v.length;
    if (total > this.limite) {
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError",
      );
    }
    this.dados.set(chave, String(valor));
  }

  removeItem(chave: string): void {
    this.dados.delete(chave);
  }

  clear(): void {
    this.dados.clear();
  }

  chaves(): string[] {
    return [...this.dados.keys()];
  }
}
