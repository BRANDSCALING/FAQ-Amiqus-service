/**
 * Smoke test FAQ chatbot endpoints.
 *
 *   cd faq-amiqus-service && API_BASE=http://localhost:3000 node scripts/test-faq-chat.js
 */
const API = process.env.API_BASE || 'http://localhost:3000';

async function askOnce(message) {
  const res = await fetch(`${API}/faq-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('POST /faq-chat failed', res.status, body);
    process.exit(1);
  }
  console.log(body.response || JSON.stringify(body));
}

async function main() {
  const fromEnv = process.env.FAQ_QUESTION?.trim();
  if (fromEnv) {
    await askOnce(fromEnv);
    return;
  }

  const args = process.argv.slice(2);
  const runSmoke =
    args.length === 0 ||
    (args.length === 1 && (args[0] === 'smoke' || args[0] === 'test'));
  if (!runSmoke) {
    await askOnce(args.join(' ').trim());
    return;
  }

  const metaRes = await fetch(`${API}/faq-chat/meta`);
  if (!metaRes.ok) {
    console.error('GET /faq-chat/meta failed', metaRes.status, await metaRes.text());
    process.exit(1);
  }
  const meta = await metaRes.json();
  console.log(
    'meta:',
    meta.chatbotTitle,
    '| v',
    meta.knowledgeVersion,
    '| faqs:',
    meta.faqCount,
    '| categories:',
    meta.categories.length,
  );

  const healthRes = await fetch(`${API}/faq-chat/health`);
  const health = healthRes.ok ? await healthRes.json() : {};
  console.log('health:', health.ok, '| path:', health.knowledgePath || '—');

  const inScope = await fetch(`${API}/faq-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'I forgot my password, what do I do?' }),
  });
  const inBody = await inScope.json();
  if (!inScope.ok) {
    console.error('POST /faq-chat (in-scope) failed', inScope.status, inBody);
    process.exit(1);
  }
  console.log('\nIn-scope reply:', (inBody.response || '').slice(0, 280));
  console.log('  cited:', (inBody.citedFaqIds || []).join(',') || '—', '| oos:', inBody.outOfScope, '| ms:', inBody.latencyMs);

  const outScope = await fetch(`${API}/faq-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Write me a python script to scrape google' }),
  });
  const outBody = await outScope.json();
  if (!outScope.ok) {
    console.error('POST /faq-chat (out-of-scope) failed', outScope.status, outBody);
    process.exit(1);
  }
  console.log('\nOut-of-scope reply:', (outBody.response || '').slice(0, 280));
  console.log('  cited:', (outBody.citedFaqIds || []).join(',') || '—', '| oos:', outBody.outOfScope, '| ms:', outBody.latencyMs);

  console.log('\nPASS: FAQ chat meta + health + in-scope + out-of-scope.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
