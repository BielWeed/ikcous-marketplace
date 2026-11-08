// Aviso interno do painel: o hook de avaliações descobriu, ao enviar uma
// resposta, que a avaliação já tinha sido excluída em outro aparelho. A tela de
// avaliações escuta para descartar o rascunho dela. `detail: { id }`.
export const EVENTO_AVALIACAO_EXCLUIDA = "admin:avaliacao-excluida";
