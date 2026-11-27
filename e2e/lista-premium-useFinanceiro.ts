// Só da bancada da lista premium (`e2e/lista-premium.vite.config.ts`): a
// FolhaFinanceira lê a largura por `useTelaLarga` de `@/hooks/useFinanceiro`,
// que arrasta o cliente do Supabase e exige as chaves do banco. A bancada não
// fala com banco nenhum; a largura vem da MESMA consulta (min-width: 1024px).
export { useTelaDeComputador as useTelaLarga } from "@/hooks/useTelaDeComputador";
