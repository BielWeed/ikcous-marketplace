# Baixar planilha de Produtos — verificação de 15/11/2026

## Entrega atual: XLSX real

Sobre o commit CSV `5186dc977`, o mesmo botão baixa agora
`produtos-<loja>-AAAA-MM-DD.xlsx`, com o MIME oficial de XLSX.
Não adiciona biblioteca, dependência, endpoint ou consulta.

O gerador mínimo em `src/lib/planilha-xlsx.ts` só é importado dinamicamente
no clique. Escreve ZIP store, CRC-32 próprio e seis partes OOXML:
Content Types, relações do pacote, workbook, relações do workbook, estilos
e uma folha chamada Produtos.

Cabeçalho Arial/negrito/branco sobre fundo escuro, primeira linha congelada,
larguras por coluna, quebra de texto e filtro automático na área inteira.
Dinheiro usa o formato interno `#,##0.00`; estoque/vendidos, `0`; margem,
`0.00%`, armazenada como fração (62,5% = 0,625).
SKU/EAN/códigos são textos inline: preservam zeros e códigos longos.

Reutiliza as linhas puras do catálogo completo e mantém a neutralização por
apóstrofo, embora texto inline não seja fórmula. Escapa XML, preserva
acentos/emoji/tab/LF/CR e remove controles inválidos do XML 1.0 e surrogates
soltos. Recusa texto acima de 32767 unidades UTF-16, dimensões incompatíveis,
linhas incompletas, números não finitos e ZIP além do limite clássico, em vez
de gerar arquivo inválido ou truncar o catálogo.

Somente falha na geração/importação do XLSX ativa o CSV existente.
O botão avisa: "Não foi possível gerar o XLSX. Baixamos o catálogo completo
em CSV, sem a formatação." Falha na leitura ou sessão não vira download
parcial. A conferência final de conta/permissão/cancelamento continua fora
do fallback, imediatamente antes de criar o endereço baixável.

Ressalva da revisão do CSV também corrigida: a coluna Fotos ignora o host
`placehold.co`, usado pelo mapeador quando não há foto. O teste passa pela
saída REAL de `mapProductFromDB`, não apenas por `images: []`.
Nenhuma alteração no mapeador, na permissão de custo ou na leitura paginada.

## Tamanho observado, mesma worktree e mesmas dependências

Comandos antes e depois:
`IKCOUS_IDENTITY_MODE=fixture npm run build` e
`IKCOUS_IDENTITY_MODE=fixture npm run size -- --json`.

```text
                     base CSV      XLSX        teto final (bytes)
cliente                669705      669675       672000
painel                 537711      539900       542000
CSS                     47068       47068       100000
leitor                 334887      334887       400000
```

O painel cresceu 2189 B e ultrapassou o teto antigo de 538000 B em 1900 B.
Aplicado SOMENTE o degrau de 4 kB expressamente autorizado no brief:
538 → 542 kB em `.size-limit.cjs`, junto do literal e histórico em
`tests/front/portao-de-tamanho-mede-por-arquivo.test.ts`.
Justificativa: XLSX formatado/preservação de códigos, sem a biblioteca que
antes media 554,46 kB. O excedente de 1900 B é menor que 4000 B.
Os quatro portões terminaram com `passed: true`.
A variação de -30 B do cliente é ruído dos hashes; não é melhoria prometida.

```text
build base: 3745 modules transformed; built in 28.66s; exit 0
build XLSX: 3746 modules transformed; built in 23.04s; exit 0
chunk planilha-xlsx: 5.60 kB bruto (gzip 2.30 kB)
PWA injectManifest: dist-test/sw.js gerado
```

Zod/aviso de chunks grandes já apareciam no build base.
O portão soma brotli POR ARQUIVO, inclusive o chunk lazy.

## Validade independente do arquivo

Geradas três amostras inventadas usando o código real, compilado com esbuild:
com custos (14643 B), sem custos (13894 B), catálogo vazio (8115 B).
Scripts/amostras temporários ficam apenas no scratchpad da sessão.
Nenhum catálogo real foi consultado ou enviado para fora.

Python isolado (`-I`), `zipfile.testzip()` e ElementTree:
seis nomes na ordem esperada, método ZIP_STORED, CRCs corretos e todos os
XMLs bem formados. `openpyxl 3.1.5`, instalado gratuitamente em venv temporária
FORA do repo, abriu as três amostras sem aviso (warnings tratados como erro).

```text
com-custos: ZIP store/CRC/XML OK; openpyxl 4x31, tipos/estilos/pane/filtro/larguras OK
sem-custos: ZIP store/CRC/XML OK; openpyxl 4x28, tipos/estilos/pane/filtro/larguras OK
vazio: ZIP store/CRC/XML OK; openpyxl 1x28, tipos/estilos/pane/filtro/larguras OK
```

Conferidos valores/tipos numéricos, margem fracionária, formatos, negrito,
fonte/cor/fundo, A2 congelado, filtros AE4/AB4/AB1, larguras, variantes ativa e
inativa, preço zero, custo ausente, foto ausente, acentos/emoji/`&<>"'`, CR,
quebras, zeros à esquerda e EAN de 21 dígitos.

LibreOffice não encontrado no PATH nem nos dois caminhos usuais de instalação
do Windows. Portanto NÃO houve conversão headless.
NÃO foi validado em Excel nem Google Planilhas reais. Também não houve
novo ensaio visual autenticado, aparelho físico ou download com banco remoto.
Abrir no openpyxl prova leitura/estrutura/valores, não a apresentação no Excel.

## Testes e verificações

Vermelhos observados ANTES das respectivas implementações:
download ainda terminava em CSV quando o teste exigiu XLSX;
fallback não avisava no botão; mapeador sem foto exportava o placeholder.
Não foram falhas de importação.

Vitest com caminhos explícitos: os 55 arquivos que citam AdminProductsView,
quatro arquivos da exportação e o teste do portão (sem suíte inteira):

```text
Test Files  60 passed (60)
Tests       506 passed (506)
Duration    51.58s
```

Depois da atualização do teto, reexecutados os cinco arquivos da tarefa/portão:

```text
Test Files  5 passed (5)
Tests       53 passed (53)
Duration    2.05s
```

`tests/front/planilha-xlsx.test.ts` confere assinatura PK, nomes/ordem,
CRC independente via node:zlib, cabeçalhos locais/diretório central/EOCD,
XML via DOMParser, estilos, dados, códigos, variantes, ausência de custo e
catálogo vazio. Os testes de download cobrem MIME/extensão, fallback e
permissão perdida durante a geração; os do botão cobrem o aviso.

Mutantes REAIS no gerador, executados separadamente e revertidos:

```text
CRC final adulterado: Tests 7 failed | 1 passed (8)
Escape de & removido: Tests 4 failed | 4 passed (8)
Restaurado:           Tests 8 passed (8)
```

Falharam no CRC e no parser XML respectivamente, não por importação.

`npm run typecheck`:
```text
> tsc -b --force
[exit 0]
```

ESLint dos sete arquivos de código/teste: sem saída, exit 0.
Biome escopado: sete arquivos de código/teste e dois de configuração/portão,
sem erro após formatação.

`npm run lint:ratchet`:
```text
ferramenta tipo       agora      teto       situação
eslint     errors     0          0          ok
eslint     warnings   300        300        ok
biome      errors     13         13         ok
biome      warnings   1          1          ok
[exit 0]
```

O ratchet manteve a dívida preexistente; os arquivos alterados passam no
Biome escopado. O Vitest mostrou avisos locais de localStorage e mensagens
dos dublês de erro já existentes nos testes vizinhos, sem falha de teste.

## Limites e fora do escopo

Sem push/PR, deploy, release, versão/package.json/lock, migration ou dado real.
A paginação continua sem snapshot transacional: edições simultâneas com o
mesmo total e IDs únicos podem misturar instantes. Essa limitação do CSV
anterior não mudou; não se promete congelar o catálogo no banco.

Skills: executar-tarefa (escopo/evidência), xlsx (leitura independente e
formatação), superpowers:test-driven-development (vermelho/verde e mutantes),
vercel-react-best-practices (import dinâmico só no clique).
Skill-router falhou ao conectar; Serena não estava disponível no despacho.
