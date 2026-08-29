// Tradução do erro cru de invocação de Edge Function (via
// `supabase.functions.invoke`) para o que quem usa o app lê na tela.
//
// Módulo NOVO, e não uma extensão de `mensagens-auth.ts` ou de um dos
// tradutores locais de `useOrders.ts`/`useProducts.ts`: nenhum dos dois é o
// mesmo assunto. `mensagens-auth.ts` guarda só TEXTO estático de login, sem
// lógica de classificação. Os tradutores de `useOrders.ts`/`useProducts.ts`
// classificam por `error.code` no formato SQLSTATE — porque a fonte real do
// erro ali é o Postgres, via RPC/PostgREST. Aqui a fonte é o SDK
// `@supabase/functions-js`, que não devolve SQLSTATE nenhum — devolve um
// `name` de classe de erro fixo. É esse `name`, e não `code`, que prova a
// causa. Dois pontos usam esta mesma lógica hoje: `ShippingCalculator.tsx`
// (cotação de frete que o COMPRADOR vê) e `AdminShippingView.tsx` (teste de
// credenciais de frete que a LOJISTA vê) — os dois chamam a MESMA edge
// function `calculate-shipping`.
//
// CONFIRMADO NA FONTE, NÃO PRESUMIDO (node_modules/@supabase/functions-js/
// dist/main/types.js):
//
//   - `FunctionsHttpError` (resposta HTTP fora de 2xx): `.message` é SEMPRE
//     a frase fixa em inglês "Edge Function returned a non-2xx status
//     code" — o corpo de verdade que a função devolveu (que pode conter
//     texto técnico de provedor de frete, ex.: "Melhor Envio (Status 500):
//     <corpo>") mora em `error.context` (a `Response` crua), que nenhum dos
//     dois pontos lê hoje. Ou seja: `.message` NUNCA carrega a causa
//     específica aqui — só esse rótulo genérico do SDK. Por isso este caso
//     cai no genérico de quem chamou, e não presume qual foi a causa real.
//   - `FunctionsFetchError` (o `fetch` em si falhou, sem chegar a existir
//     resposta HTTP): É rede, sempre — o único caso em que dá para nomear a
//     causa com segurança.
//   - `FunctionsRelayError` (o relay da Supabase não alcançou a função):
//     infraestrutura, não é nem "sem internet da pessoa" nem uma causa de
//     negócio — cai no genérico também.
export function mensagemAmigavelErroEdgeFunction(
  error: unknown,
  opcoes: {
    /**
     * Mensagens que o PRÓPRIO chamador já escreveu, em português, para um
     * ramo que não passou pelo SDK de Edge Function (ex.: a checagem de
     * "está offline" que roda ANTES de invocar). Comparação por texto
     * exato: são um punhado de literais conhecidos, escritos no próprio
     * componente — não texto vindo de fora.
     */
    mensagensSeguras?: string[];
    /** Frase para toda causa sem tradução específica conhecida. */
    mensagemGenerica: string;
  },
): string {
  const detalhes = (error ?? {}) as { name?: unknown; message?: unknown };
  const nome = typeof detalhes.name === "string" ? detalhes.name : "";
  const textoOriginal =
    typeof detalhes.message === "string" ? detalhes.message : "";

  if (opcoes.mensagensSeguras?.includes(textoOriginal)) {
    return textoOriginal;
  }

  if (nome === "FunctionsFetchError") {
    return "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
  }

  return opcoes.mensagemGenerica;
}
