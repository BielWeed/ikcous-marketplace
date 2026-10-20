# Banner publicado não pode ser excluído por um recorte pendente

## Problema e evidência
U2 é preexistente, não regressão de U1. Em 72240178: imagem original O, upload novo X no editor, recorte A pendente, Escape fecha só o ajustador e Salvar continua habilitado. Salvar publica X e fecha diretamente; A termina com a geração ainda válida e a referência antiga de editingBanner, pedindo deleteStorageFile(X).
Revisor Opus identificou o fluxo. Auxiliar GPT extraiu handlers reais por AST e observou em RAM: publish:X → dialog:false → delete:X. Controles sem recorte e com geração invalidada não apagam X publicado. Principal conferiu Escape, botões, conclusão de salvar e recorte. A prova não foi em React/navegador ou Storage real; o teste desta tarefa deve cobrir a tela real.

## Decisão técnica mínima
Impedir concorrência entre publicação e recorte na mesma abertura, tanto na interface quanto nos handlers. A pessoa não deve salvar silenciosamente uma imagem anterior enquanto o recorte escolhido ainda é enviado.
- Os dois botões de salvar ficam indisponíveis enquanto isUploadingAdjusted estiver ativo, reaproveitando o estado/linguagem de envio existente, sem texto novo ou redesign.
- O handler de salvar recusa uma tentativa enquanto um recorte da abertura atual estiver pendente. A guarda precisa ser síncrona quando necessária, não confiar apenas no disabled ou em uma renderização futura.
- Recorte novo não começa enquanto isSubmittingRef indicar publicação pendente. Não enviar arquivo e depois tentar compensar uma publicação com exclusão.
- Quando o salvar confirmado encerra a abertura, invalidar os resultados assíncronos daquela abertura sem executar limpeza destrutiva da imagem recém-publicada. Não mudar a lógica que preserva edição feita durante um salvar pendente.
- A propriedade dos indicadores de envio continua por geração: um finally antigo não desbloqueia a operação nova; abrir/fechar/desativar invalida a abertura anterior. Preservar U1.

## Aceite em componente real, serviços simulados
1. Upload X, iniciar recorte A, Escape: Salvar não publica enquanto A estiver pendente. Não excluir X publicado, pois nenhuma publicação concorrente foi iniciada.
2. A termina, imagem ajustada aparece; salvar publica a imagem ajustada. Nenhuma exclusão posterior atinge a imagem publicada.
3. Salvar já pendente: tentativa de iniciar recorte não dispara upload/cleanup; terminar salvar mantém a imagem publicada.
4. Falha de salvar preserva rascunho e imagem, libera a operação para tentativa posterior; sucesso sem recorte mantém o comportamento normal.
5. Ambos os modos de salvar protegidos; U1 e testes antigos de erro, Escape e edição durante salvar continuam verdes.
Sem rede, Storage, banco ou dados reais. Asserções novas devem falhar na base pelo motivo certo antes do fix. Teste não pode apenas reimplementar callbacks.

## Escopo e entrega
Somente AdminBannersView e um teste novo. Nada em ImageAdjuster, useBanners, configurações, dependências ou proposta rejeitada PR1027. Não remover imagens reais nem instalar ferramenta. Faixa validada e commitada antes de escrever. Revisão independente Opus no SHA final, verificação integrada e CI; última tarefa do fechamento é diretor factual. Não publicar antes dessa prova, nem chamar AST de teste físico.
