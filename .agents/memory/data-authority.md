---
name: Autoridade de dados
description: Regra de projeto para separação de responsabilidades entre client e servidor.
---

**Regra:** A fonte de verdade, os dados persistentes e as decisões de negócio ficam no servidor. O client recebe somente os dados necessários para renderizar a interface e mantém estado transitório de apresentação.

**Why:** o usuário pediu que o client não mantenha dados nem decisões de negócio.

**How to apply:** valide toda entrada no servidor, derive identidade e permissões da sessão, persista alterações no banco e retorne projeções com escopo de usuário; não use `localStorage` como fonte de dados da aplicação.
