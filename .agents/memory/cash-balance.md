---
name: Saldo de caixa
description: Requisito do produto para acompanhar saldo financeiro.
---

Revela precisa manter registros confiáveis do saldo de caixa. A gestão deve ficar em um painel administrativo hospedado separadamente do app público, com endpoints dedicados e sem integração no client de usuários.

**Why:** o usuário quer acompanhar compras e resgates, mas definiu que a interface administrativa futura deve ser separada e não compartilhar o client público.

**How to apply:** preserve o ledger e seus dados; não adicione controles, campos de permissão ou endpoints administrativos ao app público. Quando o painel for construído, hospede-o em local independente e use endpoints próprios.
