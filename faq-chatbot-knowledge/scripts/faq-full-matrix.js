/**
 * Full pipeline: health + POST /faq-chat for llmChecks (OpenAI cost).
 * Retrieval: npm test -- --testPathPattern=faq-retrieval.service.spec
 *
 *   cd faq-amiqus-service && API_BASE=http://localhost:3000 node faq-chatbot-knowledge/scripts/faq-full-matrix.js
 *
 * FAQ_MATRIX_FAIL_ON_CITATION=1 — fail if citedAnyOf set and no overlap (model may omit cites).
 */
const fs = require('fs');
const path = require('path');

const API = process.env.API_BASE || 'http://localhost:3000';
const strictCitations = process.env.FAQ_MATRIX_FAIL_ON_CITATION === '1';
const matrixPath = path.join(__dirname, '..', 'production-test-matrix.json');

async function checkHealth() {
  const res = await fetch(`${API}/faq-chat/health`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || typeof body.faqCount !== 'number') {
    console.error('FAIL health', res.status, body);
    process.exit(1);
  }
  console.log(`OK   health faqCount=${body.faqCount} version=${body.knowledgeVersion}`);
}

function citationOk(c, body) {
  const want = c.citedAnyOf;
  if (!want?.length || body.outOfScope) return { ok: true, skip: true };
  const cited = new Set(body.citedFaqIds || []);
  const hit = want.some((id) => cited.has(id));
  return { ok: hit, skip: false };
}

async function main() {
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const cases = matrix.llmChecks || [];
  let failed = 0;
  let citationWarn = 0;

  await checkHealth();

  for (const c of cases) {
    const res = await fetch(`${API}/faq-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: c.message, clientRequestId: `matrix-${c.id}` }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error(`FAIL ${c.id} HTTP ${res.status}`, body);
      failed++;
      continue;
    }
    if (typeof c.expectOutOfScope === 'boolean' && body.outOfScope !== c.expectOutOfScope) {
      console.error(
        `FAIL ${c.id}: outOfScope want ${c.expectOutOfScope} got ${body.outOfScope} | ${(body.response || '').slice(0, 100)}`,
      );
      failed++;
      continue;
    }
    if (c.expectOutOfScope === false && (!body.response || body.response.length < 10)) {
      console.error(`FAIL ${c.id}: empty or too short in-scope response`);
      failed++;
      continue;
    }

    const cit = citationOk(c, body);
    if (!cit.skip && !cit.ok) {
      const msg = `WARN ${c.id}: citedFaqIds none of ${JSON.stringify(c.citedAnyOf)} got [${(body.citedFaqIds || []).join(',')}]`;
      if (strictCitations) {
        console.error(`FAIL ${msg.slice(5)}`);
        failed++;
      } else {
        console.error(msg);
        citationWarn++;
      }
    }

    const cat = c.category ? `${c.category} ` : '';
    console.log(
      `OK   ${c.id} ${cat}oos=${body.outOfScope} cache=${body.fromCache} cited=[${(body.citedFaqIds || []).join(',')}]`,
    );
  }

  if (citationWarn && !strictCitations) {
    console.error(`\n${citationWarn} citation warning(s); set FAQ_MATRIX_FAIL_ON_CITATION=1 to hard-fail`);
  }
  if (failed) {
    console.error(`\n${failed}/${cases.length} LLM matrix checks failed`);
    process.exit(1);
  }
  console.log(`\nPASS LLM matrix ${cases.length}/${cases.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
