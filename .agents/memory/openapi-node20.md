---
name: OpenAPI no Node 20
description: Incompatibilidade observada entre o runtime do workspace e a geração OpenAPI.
---

O workspace usa Node 20, mas a versão observada do Orval chama `Map.groupBy`, que não existe nesse runtime. O codegen pode gerar o cliente React e depois falhar ao gerar os schemas Zod, deixando os artefatos desatualizados entre si. Uma execução isolada do CLI com um polyfill temporário de `Map.groupBy` concluiu a geração sem mudar o runtime do projeto.

**Why:** falha parcial no codegen pode parecer sucesso para um dos geradores e deixar contratos client/server divergentes.

**How to apply:** se o codegen falhar com `Map.groupBy`, confira as versões atuais de Node e Orval; prefira um runtime suportado ou um polyfill temporário no processo, depois rode `pnpm run typecheck:libs`.
