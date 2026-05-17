# FAQ + Amiqus service

NestJS app: UCWS FAQ chatbot (RAG) + Amiqus KYC / DocuSeal compliance.

## Local dev

```bash
cd faq-amiqus-service
cp .env.example .env   # fill keys
npm install
npm run start:dev
```

- **Entry (prod):** `dist/src/main.js` (`npm run start:prod`)
- **Source entry:** `src/main.ts`
- **Port:** `process.env.PORT` (default **3000**)
- **Health:** `GET /health`
- Swagger: `/api` · FAQ test UI: `/faq-chat-test.html`

## Docker (ECS)

```bash
docker build -t amiqus-faq-allianz .
docker run --rm -p 3000:3000 --env-file .env amiqus-faq-allianz
curl http://localhost:3000/health
```

## First push to ECR (manual)

After Haris provides AWS credentials:

```bash
chmod +x scripts/ecr-push.sh
./scripts/ecr-push.sh
```

Defaults: account `802749364652`, region `us-east-1`, repo `amiqus-faq-allianz`.

## GitHub Actions → ECS Express Mode

On push to **`feat/ecs-express-deployment`** (and manual dispatch): build image → push ECR → deploy ECS. Switch workflow to **`main`** after Haris sign-off.

**Repository variables** (Settings → Secrets and variables → Actions → Variables):

| Name | Example |
|------|---------|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCOUNT_ID` | `802749364652` |
| `ECR_REPOSITORY` | `amiqus-faq-allianz` |
| `ECS_SERVICE` | `amiqus-faq-allianz-service` |
| `ECS_CLUSTER` | *(from Haris)* |

**IAM:** OIDC role `github-actions-ecs-role` (Haris sets up). Task env vars (secrets) are configured on the ECS service / task definition, not in this repo.

**Required env vars on ECS task** (names only):  
`PORT`, `NODE_ENV`, `OPENAI_API_KEY`, `AMIQUS_API_KEY`, `AMIQUS_WEBHOOK_SECRET`, `AMIQUS_ENABLE_CRIMINAL_RECORD_STEP`, `AMIQUS_DBS_STEP_TYPE`, `AMIQUS_CRIMINAL_RECORD_REGION`, `AMIQUS_CRIMINAL_RECORD_TYPE`, `DOCUSEAL_API_KEY`, `DOCUSEAL_URL`, `HSPSLA_TEMPLATE_ID`, `TENANTS_TEMPLATE_ID`, `PARTNER_BACKEND_URL`

See `info.md` for the full deployment playbook.
