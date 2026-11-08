---
name: Catálogo de prêmios
description: Tipos dos itens de célula, armazenamento de imagens e migração segura do catálogo.
---

**Regra:** Cada célula revelada deve referenciar um item do catálogo. Itens são do tipo Pix, com valor monetário em centavos, ou imagem, com caminho relativo para um arquivo no bucket público do App Storage. Os bytes da imagem ficam no armazenamento de objetos, não no PostgreSQL. O servidor só envia detalhes do item quando a célula está aberta.

**Why:** o usuário definiu esse modelo para substituir prêmios embutidos nas células e armazenar imagens no bucket.

**How to apply:** mantenha a relação célula-item e os tipos Pix/imagem como fonte de verdade; valide resgates apenas para itens Pix; trate caminhos de imagem como relativos ao bucket público.

**Migração segura:** mantenha os valores antigos como fonte de compatibilidade até os dados existentes terem sido associados a itens em todos os ambientes. Não torne a relação obrigatória nem remova os campos antigos antes dessa etapa.

**Why:** a publicação pode encontrar células antigas sem o novo vínculo; remover ou exigir campos antes do backfill pode interromper a aplicação ou perder dados.

**How to apply:** faça a transição em etapas compatíveis com os dados de produção e só limpe o modelo legado depois que o backfill estiver confirmado.
