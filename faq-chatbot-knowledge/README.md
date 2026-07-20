# UCWS Partner FAQ chatbot knowledge

Everything for the `/faq-chat` feature lives under **`faq-chatbot-knowledge/`** in this package: knowledge files, Nest module code, and helper scripts.

## Layout

| Path | Purpose |
|------|---------|
| **`faq-meta.json`** | `version`, `chatbotTitle`, `scopeDescription`. Bump `version` when content changes (cache invalidation). |
| **`questions.md`** | Source of truth: seven `**SECTION N: …**` blocks → one RAG chunk each (Q1–Q30). |
| **`eval-questions.json`** | Smoke cases for `npm run eval:faq`. |
| **`production-test-matrix.json`** | Retrieval + LLM matrix for `npm run test:faq-matrix`. |
| **`module/`** | NestJS FAQ module (controller, services, DTOs, specs). Wired from `src/app.module.ts`. |
| **`scripts/`** | `eval-faq-chat.js`, `faq-full-matrix.js` (invoked via `package.json` scripts). |

## Environment (see `../.env.example` in `faq-amiqus-service/`)

- `FAQ_KNOWLEDGE_PATH` — directory containing `faq-meta.json` + `questions.md`, or absolute path to `faq-meta.json`
- `FAQ_QUESTIONS_PATH` — override path to `questions.md` only
- `FAQ_EMBEDDING_MODEL` — OpenAI embedding model for LlamaIndex (default `text-embedding-3-small`; requires `OPENAI_API_KEY`)

## Retrieval

- With `OPENAI_API_KEY`, the service builds a **LlamaIndex** `VectorStoreIndex` over the seven section documents.
- Without a key, retrieval falls back to lexical overlap on the same sections.

## `faq-meta.json` shape

```json
{
  "version": "2",
  "chatbotTitle": "UCWS Partner FAQ",
  "scopeDescription": "One paragraph: what this bot may answer; out-of-scope behaviour."
}
```

After editing knowledge files, restart this service.

## Local test UI

With the service running (e.g. `cd faq-amiqus-service && PORT=3000 npm run start:dev`), open **`/faq-chat-test.html`** on the same host — e.g. [http://localhost:3000/faq-chat-test.html](http://localhost:3000/faq-chat-test.html). It calls `/faq-chat/meta`, `/faq-chat/health`, and `POST /faq-chat` on the same origin.
