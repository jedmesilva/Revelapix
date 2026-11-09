---
name: Carregamento inicial da grade
description: Decisão sobre carregar o estado da conta e a janela de células sem duplicar o indicador inicial.
---

**Regra:** Mantenha a busca do estado da conta separada da busca paginada de células. Na primeira abertura, mostre um único indicador contínuo até que o estado e a primeira janela de células estejam prontos.

**Why:** O estado da conta é atualizado após autenticação, pagamentos, mutações e atualizações periódicas. Incluir células nessa resposta faria cada atualização baixar novamente uma janela que o cliente já controla sob demanda.

**How to apply:** Preserve a janela de células limitada e coordene o indicador na interface entre a resposta de estado e a primeira janela. Só considere uma resposta combinada se ela não fizer as atualizações recorrentes do estado recarregarem células.
