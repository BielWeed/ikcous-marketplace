# Ensaio local das marcas pelo build real — A6b

No worktree reservado, execute em PowerShell:

```powershell
node tests/identity-real-kit-build/run.mjs
```

Sem argumentos, dependências novas, rede ou credenciais. O runner requer reserva exclusiva de `dist-test` e fontes de build; o coordenador deve confirmar essa reserva antes da execução. Requer HEAD descendente de `915185ff06c5920de63af9d7f4b18fe943d7082e`, registra o SHA real e congela os hashes das fontes antes/depois. Recusa nominalmente `.env`, `.env.local`, `.env.production` e `.env.production.local`, sem ler conteúdo. Cada build nasce em processo novo com somente variáveis de sistema permitidas e três seletores de ensaio; `envFile:false` não substitui a recusa de arquivos usada porque a config chama `loadEnv`.

Consome somente leitura o kit A6a em `C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/identidade-real-a6`, manifesto SHA-256 `cb5d259e7a35cd1e1ea7ed1c97e3d73b73cc55e8b71701c2604a59989382d74c`. Não execute `preparar.mjs`. Nomes `Ensaio IKCOUS` e `Ensaio Savy`, origem pública `.invalid`, cidade/UF ausentes e cores artificiais `#863B50`, `#FFFFFF`, `#C99730` são intencionais. A fase `update` acrescenta ` — atualização`; é coberta na fábrica/config pelos testes focados, sem terceiro build global.

O seletor UTF-8 local tem exatamente `kind`, `directory`, `store`, `expectedManifestSha256`, `phase` e no máximo 4096 bytes. Só funciona com `IKCOUS_IDENTITY_MODE=fixture`; fora desse modo a configuração recusa antes de consultar o kit ou banco, inclusive preview. Os objetos são selecionados por caminho, nunca apenas hash. Nenhum caminho `sources`, `provenance` ou `objects.local` dirige leitura.

O runner usa `buildStore`, configuração Vite/PWA, preparador e fontes reais, sem substituição da fábrica, de código ou metadados. Seu plugin apenas observa o snapshot e as entradas resolvidas. Só verifica saída depois de `buildStore` resolver. Preserva o resultado anterior de `dist-test` e cada nova marca em diretório exclusivo `controle/tarefa-A6b-<runId>`, com criação exclusiva de arquivos e conferência da cópia. Não remove provas anteriores. Uma segunda execução cria outra pasta; não há publicação nem sobrescrita de evidência.

Asserções cobrem 7/10 objetos, bytes/SHA/tamanho, segregação por marca, HTML de abertura, título/metas/favicon/apple/loader, manifesto PWA, precache por papel (inclusive quando um essencial também é original), snapshot, revisão e marcador `fixture/promotable:false`. A lista de precache é extraída com Acorn, pelo mesmo parser de arrays literais revisado da bancada de instalação: chaves JSON/identificadores e duplicatas idênticas são aceitas; revisões conflitantes e arrays ambíguos são recusados, sem executar o SW. Fontes e caminhos devem permanecer quiescentes durante a execução: checar ancestrais não promete impedir uma troca maliciosa concorrente no filesystem.

Verificação focada:

```powershell
npx vitest run tests/front/local-identity-build-fixture.test.ts tests/front/identity-build-config.test.ts tests/front/identity-build-integration.test.ts tests/front/identity-build-finalization.test.ts tests/front/prepare-identity-build.test.ts tests/front/store-identity.test.ts tests/front/public-store-identity.test.ts
node --check tests/identity-real-kit-build/run.mjs
```

O teste de finalização A4 cobre erro tardio em `writeBundle`/`closeBundle` com invalidação do marcador em fixture temporária própria; o runner de marcas não destrói um candidato para simular isso. Os testes unitários criam kits sintéticos próprios; mudar seu hash para testar schema não transforma objeto adulterado em kit aprovado.

Limite: prova de geração de artefato. HTML de abertura não é Header nem app executado. Inicialização de `main/App`, saída do loader, Header desktop/mobile, SW instalado, offline e atualização pela interface dependem da A6c e de seu plano próprio. Não certifica produção, serviços externos ou instalação no sistema operacional.
