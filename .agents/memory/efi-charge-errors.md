---
name: Erros de cobrança Efí
description: Tratamento de consultas Efí para cobranças Pix inexistentes e expiração local.
---

**Regra:** A consulta a uma cobrança Pix inexistente pode retornar HTTP 400 com `nome: cobranca_nao_encontrada`, não apenas HTTP 404. Expire o pedido local automaticamente somente após esse erro específico e depois de `expiresAt`; não expire por qualquer HTTP 400 ou erro genérico. Em um cancelamento explícito, confirme o estado final com a Efí: se pago, registre o pagamento; se removido ou inexistente, expire o pedido; se incerto, mantenha-o pendente e não libere outra cobrança.

**Why:** Um pedido sem cobrança no provedor permanecia `pending` indefinidamente quando o código reconhecia apenas 404. Expirar qualquer erro seria inseguro porque uma cobrança válida ainda poderia estar pagável ou já ter sido paga.

**How to apply:** Preserve o campo `nome` dos erros JSON da Efí e use o `providerTxid` junto ao prazo persistido do pedido para reconciliar. Após solicitar cancelamento, consulte novamente o estado remoto antes de liberar uma nova compra.
