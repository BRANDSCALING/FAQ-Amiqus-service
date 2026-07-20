/**
 * Run eval cases from faq-chatbot-knowledge/eval-questions.json (LLM calls; costs tokens).
 *   cd faq-amiqus-service && API_BASE=http://localhost:3000 node faq-chatbot-knowledge/scripts/eval-faq-chat.js
 */
const fs = require('fs');
const path = require('path');

const API = process.env.API_BASE || 'http://localhost:3000';
const evalPath = path.join(__dirname, '..', 'eval-questions.json');

async function main() {
  if (!fs.existsSync(evalPath)) {
    console.error('Missing', evalPath);
    process.exit(1);
  }
  const { cases } = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
  let failed = 0;

  for (const c of cases) {
    const res = await fetch(`${API}/faq-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: c.message, clientRequestId: `eval-${c.id}` }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error(`FAIL ${c.id}: HTTP ${res.status}`, body);
      failed++;
      continue;
    }

    const reasons = [];
    if (body.outOfScope !== c.expectOutOfScope) {
      reasons.push(`outOfScope want ${c.expectOutOfScope} got ${body.outOfScope}`);
    }
    if (c.expectCitedIdContains) {
      const cited = body.citedFaqIds || [];
      const hit = cited.some((id) => String(id).includes(c.expectCitedIdContains));
      if (!hit) {
        console.warn(
          `WARN ${c.id}: citation *${c.expectCitedIdContains}* not in [${cited.join(',')}] (LLM may omit ids)`,
        );
      }
    }

    if (reasons.length === 0) {
      console.log(`OK   ${c.id}  latencyMs=${body.latencyMs} cited=[${(body.citedFaqIds || []).join(',')}]`);
    } else {
      console.log(`FAIL ${c.id}: ${reasons.join('; ')}`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n${failed}/${cases.length} failed`);
    process.exit(1);
  }
  console.log(`\nPASS ${cases.length}/${cases.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
