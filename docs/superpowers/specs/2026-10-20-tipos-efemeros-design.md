# Tipos gerados do Postgres efêmero

## Objetivo e limite
Gerar um artefato de tipos TypeScript do schema public já provisionado pelo RPC-CI, antes da futura onda cliente do caixa. O banco e o consumidor e59a continuam inalterados. Não chamar banco real, Management API, login ou secrets; não iniciar serviço local, alterar permissões, instalar framework ou publicar código de app.

## Pesquisa conferida em 20/10/2026
- Release oficial v2.121.0 publicada14/10 e npm supabase@2.121.0 conferidos.
- CLI desta versão é o pacote novo: apps/cli/src/commands/gen/types/SIDE_EFFECTS.md e types.generator.layer.ts mostram introspecção direta de Postgres no caminho --db-url, sem Docker nem Management API. Documentação do develop contém também caminho Go antigo; não misturar versões.
- Sintaxe: supabase gen types --lang typescript --schema public --db-url <URL completa>.
- Fontes: https://supabase.com/docs/reference/cli/supabase-gen ; https://github.com/supabase/cli/releases/tag/v2.121.0 ; https://raw.githubusercontent.com/supabase/cli/v2.121.0/apps/cli/src/commands/gen/types/SIDE_EFFECTS.md ; https://registry.npmjs.org/supabase/2.121.0 .
- Nenhum pacote foi instalado localmente. CLI fixado somente no runner efêmero.

## Contrato
1. Script novo tests/banco/gerar-tipos-efemeros.cjs, executável só como entrada CLI; funções puras/exportadas testáveis sem banco.
2. Antes de iniciar subprocesso ou criar saída, chamar lerDatabaseUrlEfemera() existente, sem alterar sua guarda. Exigir CI=true, GITHUB_SHA 40hex e RUNNER_TEMP absoluto. Nunca usar projeto linkado/token nem interpretar .env.
3. Subprocesso sem shell: npx --yes --package=supabase@2.121.0 supabase gen types --lang typescript --schema public --db-url URL_validada. Timeout finito <=120s e buffer limitado. Não imprimir DSN nem stdout inteiro; falha devolve mensagem sanitizada/status sem sucesso parcial.
4. Não herdar credenciais Supabase do processo para o filho. Ambiente mínimo necessário ao npx/CLI, DATABASE_URL só por argumento validado; nenhuma credencial de projeto. Sem --local/--linked/--project-id.
5. Só aceitar stdout não vazio contendo export type Database e nomes das duas RPCs novas. Capturar stderr separado. Um stdout de erro ou resposta vazia reprova sem artefato.
6. Escrever database.types.ts e metadata.json em RUNNER_TEMP/tipos-efemeros. Metadata: SHA, schema public, CLI2.121.0, SHA256 do arquivo gerado (node crypto), sem URL/dados. Escrita só após validar o resultado, nenhuma alteração em src/types aqui.
7. Workflow existente: depois de aplica bem-sucedido, passo id tipos com mesma guarda !cancelled() && steps.aplica.outcome == 'success'; em seguida upload-artifact@v7 (já usado no repo), só quando tipos success, nome tipos-public-<github.sha>, path runner.temp/tipos-efemeros, if-no-files-found:error, retention-days:1. Não alterar jobs, secrets, permissões, timeout geral, antigas provas/guardas. Adicionar paths dos dois novos arquivos nos dois gatilhos.
8. TDD offline: recusar env/URL real sem executar nada; conferir argv/sem shell/versão fixa/ambiente sem token; CLI falho/vazio/inválido não grava; sucesso válido gera artefato+metadata/hash corretos. Testar estrutura workflow contra guardas/artefato. Sem PG/Docker/rede no teste unitário.
9. Não prometer tipos do banco real: artefato é do schema efêmero no SHA informado. Integrador lê/difere antes de aplicar tipos gerados à árvore; consumidor precisa de fase própria e de banco publicado antes de release.

## Fora do escopo
Impressão digital da tabela de tentativas exige investigação separada: adicionar à lista obrigatória faria a primeira aplicação falhar por tabela ausente. Não alterar essa guarda aqui. Sem PR financeiro direto contra5942 (carrega onda1), sem merge/deploy ou UI rejeitada.
