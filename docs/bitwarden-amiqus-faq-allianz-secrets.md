# Bitwarden entry: `amiqus-faq-allianz-secrets`

Copy each **name** and its value from your local `.env` into a Bitwarden secure note (do not commit values to Git).

Haris will load these into **AWS Secrets Manager** for the ECS task.

## Required

- `PORT` = `3000`
- `NODE_ENV` = `production`
- `OPENAI_API_KEY`
- `AMIQUS_API_KEY`
- `AMIQUS_WEBHOOK_SECRET`
- `AMIQUS_DBS_STEP_TYPE` = `check.criminal_record`
- `AMIQUS_CRIMINAL_RECORD_REGION` = `england`
- `AMIQUS_CRIMINAL_RECORD_TYPE` = `standard`
- `DOCUSEAL_API_KEY`
- `DOCUSEAL_URL`
- `HSPSLA_TEMPLATE_ID`
- `TENANTS_TEMPLATE_ID`
- `PARTNER_BACKEND_URL`

## Optional

- `AMIQUS_ENABLE_CRIMINAL_RECORD_STEP` = `auto`
- `FAQ_CHAT_MODEL`
- `FAQ_EMBEDDING_MODEL`

## AWS deploy (separate — Haris / `rubab-dev` in Bitwarden)

Use existing **rubab-dev** vault entry for AWS access keys when running `scripts/ecr-push.sh` locally.
