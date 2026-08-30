// CEP é local? — cópia FRONT do contrato de `is_local_cep`
// (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql:3128) e da
// `isLocalCep` da edge `calculate-shipping`
// (supabase/functions/calculate-shipping/index.ts:303).
//
// POR QUE EXISTE: a regra do convidado (decisão do Gabriel, 30/08/2026 —
// laudo caça-bugs Savy) precisa decidir NA TELA se o destino do convidado é
// entrega local; a decisão final continua sendo do servidor. Se um dia o SQL
// mudar, ESTE arquivo muda junto — as três cópias (SQL, edge, front) são
// uma regra só, e o teste `cep-local-espelha-o-banco` guarda o contrato.
//
// Contrato: origem/destino sem dígitos -> false. Sem faixa configurada ->
// mesmos 5 primeiros dígitos. Com faixa: tokens separados por vírgula;
// "38500000-38505000" (dois blocos longos) = faixa; "38500-000" (5+3) = CEP
// único; CEP completo casa exato, item curto vale como prefixo.

export function cepEhLocal(
  originCep: string,
  destCep: string,
  localCepRange?: string,
): boolean {
  const origemLimpa = originCep.replace(/\D/g, "");
  const destinoLimpo = destCep.replace(/\D/g, "");
  if (origemLimpa.length === 0 || destinoLimpo.length === 0) return false;

  const faixa = localCepRange?.trim();
  if (faixa) {
    const destinoValor = Number(destinoLimpo.padEnd(8, "0"));
    const faixas: Array<[number, number]> = [];
    const simples: string[] = [];

    for (const bruto of faixa.split(",")) {
      const partes = bruto
        .split("-")
        .map((p) => p.replace(/\D/g, ""))
        .filter(Boolean);
      if (partes.length === 0) continue;

      // "38500000-38505000": dois blocos longos = faixa explícita.
      // "38500-000": 5+3 dígitos = um único CEP formatado.
      if (partes.length === 2 && partes[0].length >= 6 && partes[1].length >= 6) {
        const inicio = Number(partes[0].padEnd(8, "0"));
        const fim = Number(partes[1].padEnd(8, "9"));
        faixas.push(inicio <= fim ? [inicio, fim] : [fim, inicio]);
      } else {
        simples.push(partes.join(""));
      }
    }

    if (faixas.some(([inicio, fim]) => destinoValor >= inicio && destinoValor <= fim)) {
      return true;
    }

    // Formato do placeholder do admin ("38500-000, 38500-999"):
    // dois CEPs completos = início e fim de uma faixa.
    if (
      faixas.length === 0 &&
      simples.length === 2 &&
      simples.every((s) => s.length === 8)
    ) {
      const bordas = simples.map(Number).sort((a, b) => a - b);
      return destinoValor >= bordas[0] && destinoValor <= bordas[1];
    }

    // Demais casos: CEP completo casa exato; item mais curto vale como prefixo.
    return simples.some((s) =>
      s.length === 8 ? destinoLimpo === s : destinoLimpo.startsWith(s),
    );
  }

  // Default fallback: mesmos 5 primeiros dígitos (CEP único de cidade).
  return origemLimpa.slice(0, 5) === destinoLimpo.slice(0, 5);
}
