---
name: Autoridade de dados
description: Regra de projeto para separação de responsabilidades entre client e servidor.
---

**Regra:** O client serve para apresentar a interface e enviar ações ao backend. Dados persistentes, segredos, identidade/permissões, validações e decisões de negócio são responsabilidade do servidor. Estado transitório de formulário e interface pode existir no client, mas nunca é fonte de autoridade nem armazenamento persistente.

**Why:** o usuário reforçou que, por segurança, o client só deve comunicar com o backend e não deve ser confiado para regras ou dados de negócio.

**How to apply:** valide toda entrada e autorização no servidor, derive identidade/permissões da sessão, persista alterações no banco e retorne projeções com escopo de usuário. Nunca trate bloqueios, máscaras ou cálculos do client como controles de segurança; não use `localStorage` como fonte de dados da aplicação.
