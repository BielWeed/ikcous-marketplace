-- E as funções que 73/74 CRIAM não podem existir ainda (esperado: 0 linhas):
SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('get_my_cpf','set_my_cpf','forma_de_pagamento_aceita','formas_pagamento_sem_duplicata','store_config_exige_forma_de_pagamento');
