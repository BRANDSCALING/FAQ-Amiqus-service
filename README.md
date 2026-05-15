# FAQ + Amiqus service

NestJS app split from **`backend/`** (Decision Intelligence / Alchemist). Own `package.json`, build, and deploy (e.g. separate AWS App Runner service).

## What lives here

| Path | Purpose |
|------|---------|
| `src/compliance/` | Amiqus + DocuSeal APIs and webhooks |
| `faq-chatbot-knowledge/` | `questions.md`, `faq-meta.json`, Nest FAQ module (`module/`) |
| `public/faq-chat-test.html` | Same-origin smoke UI for `/faq-chat` |

## Commands

```bash
cd faq-amiqus-service
cp .env.example .env   # then fill keys
npm install
npm run start:dev     # default PORT from .env or 3000
```

- Swagger: `http://localhost:3000/api`
- FAQ test page: `http://localhost:3000/faq-chat-test.html`
- Smoke script: `npm run test:faq-smoke` (or `API_BASE=... node scripts/test-faq-chat.js`)

## Promote to its own Git repo

1. `git subtree split` or copy this folder to a new repository.
2. Point CI / App Runner at **`faq-amiqus-service/`** as the project root (`npm ci && npm run build && npm run start:prod`).

The **`backend/`** tree in the parent repo is now **DI agent only** (chat, credits, Munawar integration).
