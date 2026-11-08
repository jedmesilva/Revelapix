---
name: Hospedagem externa
description: Decisão de hospedagem para a interface e a API do Revela.
---

**Regra:** A interface web do Revela será hospedada na Vercel e a API Express no Railway, sem dividir ou reestruturar o monorepo pnpm.

**Why:** O usuário escolheu explicitamente Vercel para o frontend e Railway para o servidor.

**How to apply:** Mantenha os artefatos compartilhados acessíveis a partir da raiz do repositório. Encaminhe `/api/*` pelo domínio da Vercel ao Railway para preservar chamadas relativas e cookies same-origin. Não presuma que o armazenamento local do Replit, domínios Replit ou segredos configurados no Replit estarão disponíveis nesses provedores.
