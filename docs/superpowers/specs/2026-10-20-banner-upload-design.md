# U3 — upload normal não disputa o salvamento do banner

## Base e evidência
Base c898851501d2596a2fc8bb7a60f47dabc2c69b65. Correções contínuas autorizadas por Gabriel, sem banco real ou interface rejeitada. O revisor Opus de U2 identificou U3 fora daquela spec; a principal conferiu o código real: Input banner-upload desabilita só por uploading (2936); handleFileUpload não consulta isSubmittingRef (1743–1752) e pode excluir formData.imageUrl pelo editingBanner capturado (1766–1767).

Cenário: X é upload temporário pronto e começa a ser salvo; durante a resposta pendente, o seletor permite iniciar Y. Se Y conclui antes do salvar, a limpeza pode apagar X, que está sendo publicado. O mesmo risco existe se o salvamento detecta edição durante o envio e mantém o editor aberto. Isto é hipótese causal estática conferida, ainda sem RED React; não alegar incidente em Storage real.

## Comportamento exigido
- Enquanto salvar está pendente, nenhum upload normal novo começa, inclusive um evento atrasado do seletor aberto antes do clique em Salvar. O input indica o bloqueio e o handler tem guarda síncrona, não só estado que espera render.
- Enquanto upload normal está pendente, salvar não publica a imagem anterior. A guarda vale inclusive para upload e salvar no mesmo lote de eventos antes de renderizar o estado uploading.
- Após upload atual terminar, salvar publica a imagem atual, sem que conclusão antiga apague a imagem publicada. Falha de salvar preserva imagem e rascunho e libera nova tentativa. Edição textual durante salvar permanece permitida e preservada.
- Resets/finally e bloqueios temporários pertencem à geração do editor; resultado antigo não libera uma abertura nova. Preservar as garantias U1/U2 e a limpeza apenas de arquivos temporários realmente órfãos.
- Não ampliar para redesenho de upload, fila genérica, Storage real, nova API, campos financeiros ou rejeições de produto. Se surgir outro cenário não alcançável ou que peça contrato maior, registrar separado antes de corrigir.

## Prova e limite
TDD no componente real, fronteiras de Storage/upload simuladas e promessas controladas. RED deve atingir a exclusão/publicação ou guarda incorreta nesta base, não erro de fixture/import. Cobrir modos Simples e Completo, evento atrasado/síncrono, sucesso/falha, regressões U1/U2 e rascunho. Não usar apenas teste AST como prova do componente. Nenhum serviço, rede ou arquivo de cliente.

Risco de exclusão de imagem: revisão independente Opus no SHA final e diretor factual antes de promover. CI verde não equivale a teste físico. Não alterar versão/release/deploy.
