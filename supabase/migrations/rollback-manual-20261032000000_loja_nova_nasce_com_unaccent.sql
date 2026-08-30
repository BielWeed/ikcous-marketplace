-- Rollback manual da 20261032000000 (a extensao unaccent nasce com o banco).
-- ATENCAO: as funcoes de busca do molde (get_admin_products_paged e afins)
-- chamam unaccent() — derrubar a extensao quebra a busca do painel e da
-- vitrine. So rode se a extensao entrou por engano num banco que nao as usa.
-- O db-apply NAO roda este arquivo: copie e execute no SQL Editor.
DROP EXTENSION IF EXISTS unaccent;
