# Baixar planilha de Produtos — verificação de 15/11/2026

## O que foi entregue

Botão ao lado de Cupons, no cabeçalho de Produtos. No celular aparece só o ícone,
com nome acessível "Baixar planilha"; em telas maiores, também o texto.
Reutiliza a aparência local de Cupons, sem novo CSS. Enquanto trabalha, mostra
indicador girando e "Gerando…"; falha mostra mensagem simples sem o erro bruto.

Exporta o catálogo COMPLETO, independentemente da busca, filtros ou página aberta.
O título do botão e o aviso de sucesso explicam esse recorte.
Uma linha por produto sem grade; uma por variante quando há grade, inclusive
inativas, identificadas numa coluna própria. Mantém código e nome do produto.

## Formato e biblioteca

Avaliados registro npm e documentação oficial de write-excel-file 4.1.1:
MIT, 1.812.264 bytes descompactados, metadados atualizados em 08/06/2026;
única dependência de execução fflate (MIT, JavaScript, sem código nativo).
Context7 e README oficial consultados. Instalação exata e npm ci limpo passaram
(1239 pacotes). A API permite cabeçalho em negrito e congelado; não documenta
filtro automático nativo.

O build experimental com import dinâmico da biblioteca passou, mas o portão
mediu painel em **554,46 kB**, acima dos **538 kB**. Foi aplicada a alternativa
CSV expressamente autorizada. Biblioteca removida; package.json e lock voltaram
exatamente à base, sem mudança da versão 1.5.186.

CSV: BOM UTF-8, separador ponto e vírgula, aspas duplicadas, linhas CRLF,
moeda/margem com duas casas e vírgula decimal. Arquivo
`produtos-<nome-da-loja>-AAAA-MM-DD.csv`.
CSV não suporta negrito, congelamento, filtro automático nem tipos de célula
nativos do XLSX. Nenhum teto foi alterado.

## Leitura e segurança

- Mesma RPC existente do painel: get_admin_products_paged, páginas de 200,
  todos os filtros neutros. Variações vêm na própria RPC; mesmo mapper do painel.
- Não altera lista, página, filtros ou cache da tela para exportar.
- Confere total e IDs únicos; lista incompleta, repetição, contagem alterada ou
  falha posterior recusam o arquivo, sem oferecer a primeira página como completa.
- Botão e custos usam o isAdmin do useProducts: o mesmo que escolhe a leitura
  administrativa com custo. Esta tela não tem outro gate de custo por cargo.
  A função pura também omite custo/lucro/margem quando comCustos é falso.
- Confere a sessão antes de cada página e do download, com prazo de espera.
  Troca de conta, perda de permissão, cancelamento ou desmontagem impedem download.
- Todo texto potencialmente executável recebe apóstrofo, inclusive fórmulas após
  espaços, tabulação, CR ou LF. Números negativos continuam números.
- Não inventa marca, rascunho, oferta ou lançamento: o tipo Product não possui
  esses campos próprios. Exporta etiquetas existentes, preço atual e original,
  destaque, descrição completa, fotos, códigos, peso/dimensões e datas existentes.
- Paginação não é snapshot transacional: edição simultânea que mantém a contagem
  e não repete IDs pode misturar instantes. Sem endpoint ou banco novo, não promete
  congelar o catálogo durante edições em outra sessão.

## Evidências observadas

`npm ci --no-audit --no-fund`: 1237 pacotes na base; 1239 com a dependência experimental.

`npm run typecheck`:
```text
> tsc -b --force
[exit 0]
```

Vitest por caminhos explícitos: 55 arquivos que citam AdminProductsView e os 3 novos:
```text
Test Files  58 passed (58)
Tests       487 passed (487)
Duration    49.94s
```

Depois, dois casos de segurança adicionais no teste de download; reexecutados os 3 novos:
```text
Test Files  3 passed (3)
Tests       36 passed (36)
```

Mutante real (função textoSeguro devolvendo valor sem neutralizar), revertido:
```text
Tests  7 failed | 14 passed (21)
```
Falharam os seis prefixos exigidos e a asserção do CSV final. Não foi erro de import.

ESLint dos sete arquivos da tarefa: 0 erros, 1 warning pré-existente
em AdminProductsView.tsx (acesso por índice), linha sem alteração neste diff.

Biome dos sete arquivos:
```text
Checked 7 files in 51ms. No fixes applied.
```

`IKCOUS_IDENTITY_MODE=fixture npm run build`:
```text
3745 modules transformed
built in 25.16s
PWA injectManifest: files generated dist-test/sw.js
[exit 0]
```
Warnings do Zod e de chunks grandes já apareciam no build base.

`IKCOUS_IDENTITY_MODE=fixture npm run size -- --json`:
```text
                      base       final        teto
cliente              669,54 kB  669720 bytes  672000 bytes
painel               536,14 kB  537674 bytes  538000 bytes
CSS                   47,07 kB   47068 bytes  100000 bytes
leitor               334,89 kB  334887 bytes  400000 bytes
passed: true nos quatro portões
```
Folga do painel: somente 326 bytes. A integração precisa medir de novo.

`npm run lint:ratchet`:
```text
ferramenta tipo       agora      teto       situação
eslint     errors     0          0          ok
eslint     warnings   300        300        ok
biome      errors     13         13         ok
biome      warnings   1          1          ok
[exit 0]
```
Dívida geral dentro do baseline; os sete arquivos da tarefa passam no Biome
escopado. O ratchet informa que Biome só é cobrado no CI Linux.

`npm run lint:links`:
```text
Links relativos verificados: 428 em 138 arquivos.
Nenhum link quebrado.
```

`git diff --check`: sem saída, exit 0.

## Navegador: o que foi e o que não foi provado

Servidor fixture iniciado explicitamente nesta worktree, porta 5187, sem banco,
sem credencial, sem dado real. A rota completa de Produtos parou na tela de erro
de ambiente porque o fixture não fornece conexão de banco: não houve validação
autenticada nem download usando catálogo remoto.

Para não confundir isso com uma prova visual completa, foi ensaiado SOMENTE
o cabeçalho isolado com os componentes/CSS reais e dados inventados.
Navegador real a 390 × 844:
- largura da página: 390 px, sem rolagem lateral;
- botão Baixar planilha: x=163,33, largura=46, altura=44, direita=209,33;
- Cupons: direita=318; ajuda: direita=370; título: direita=151,33.
Captura inspecionada. Não houve colisão entre título, botão e vizinhos.
O ensaio temporário não integra a entrega. Não foi testado em aparelho físico,
Excel ou Google Planilhas reais.

A primeira tentativa de preview_start ignorou o cwd fornecido e chamou o
launcher da árvore principal; encerrou antes de subir, por vite não encontrado.
Nenhum arquivo da árvore principal foi editado. O servidor usado no ensaio foi
iniciado por comando explicitamente dentro desta worktree.

## Fora do escopo

Sem migration, edge function, endpoint, deploy, release, PR ou push.
Sem mudança em .size-limit.cjs, versão ou notas das versões.

Skills: executar-tarefa (limites/TDD/evidência), tdd-guide (casos e mutante),
vercel-react-best-practices (módulo de exportação só no clique) e
anthropic-skills:built-in-browser (ensaio e limites da evidência visual) e
superpowers:verification-before-completion (conferência de resultado antes da entrega).
