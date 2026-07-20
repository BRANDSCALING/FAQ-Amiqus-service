// Standalone test for the template_id extractor logic.
// Mirrors src/compliance/compliance.service.ts extractDocuSealTemplateId,
// so we can verify it without spinning up Nest.

function extractDocuSealTemplateId(body) {
  if (typeof body.template_id === 'number') return body.template_id;
  const topTpl = body.template;
  if (topTpl && typeof topTpl.id === 'number') return topTpl.id;

  const sub = body.submission;
  if (sub) {
    if (typeof sub.template_id === 'number') return sub.template_id;
    const subTpl = sub.template;
    if (subTpl && typeof subTpl.id === 'number') return subTpl.id;
  }

  const data = body.data;
  if (data) {
    if (typeof data.template_id === 'number') return data.template_id;
    const dataTpl = data.template;
    if (dataTpl && typeof dataTpl.id === 'number') return dataTpl.id;
    const inner = data.submission;
    if (inner) {
      if (typeof inner.template_id === 'number') return inner.template_id;
      const innerTpl = inner.template;
      if (innerTpl && typeof innerTpl.id === 'number') return innerTpl.id;
    }
  }
  return undefined;
}

function extractDocuSealSubmissionId(body) {
  const sub = body.submission;
  if (sub && typeof sub.id === 'number') return sub.id;
  if (typeof body.submission_id === 'number') return body.submission_id;
  const data = body.data;
  if (data) {
    const inner = data.submission;
    if (inner && typeof inner.id === 'number') return inner.id;
    if (typeof data.submission_id === 'number') return data.submission_id;
  }
  return undefined;
}

const cases = [
  {
    name: 'real DocuSeal form.completed (data.template.id, data.submission.id)',
    body: {
      event_type: 'form.completed',
      timestamp: '2026-05-20T12:00:00Z',
      data: {
        id: 999,
        submission_id: 28,
        email: 'hsp@example.com',
        role: 'HSP',
        status: 'completed',
        submission: { id: 28, status: 'completed' },
        template: { id: 1, name: 'HSP SLA' },
      },
    },
    expectedTemplate: 1,
    expectedSubmission: 28,
  },
  {
    name: 'real DocuSeal submission.completed (data.template.id, data.id as submission)',
    body: {
      event_type: 'submission.completed',
      timestamp: '2026-05-20T12:00:00Z',
      data: {
        id: 29,
        status: 'completed',
        template: { id: 2, name: 'Tenants SLA' },
      },
    },
    expectedTemplate: 2,
    expectedSubmission: undefined, // no data.submission.id, no body.submission.id, no submission_id
  },
  {
    name: 'flat shape (template_id at root)',
    body: { event_type: 'submission.completed', template_id: 1, submission: { id: 10 } },
    expectedTemplate: 1,
    expectedSubmission: 10,
  },
  {
    name: 'nested template under body.submission',
    body: { event: 'submission.completed', submission: { id: 11, template: { id: 2 } } },
    expectedTemplate: 2,
    expectedSubmission: 11,
  },
  {
    name: 'nested template under data.submission',
    body: { event: 'submission.completed', data: { submission: { id: 12, template: { id: 1 } } } },
    expectedTemplate: 1,
    expectedSubmission: 12,
  },
  {
    name: 'missing template entirely',
    body: { event: 'submission.completed', data: { submission: { id: 13 } } },
    expectedTemplate: undefined,
    expectedSubmission: 13,
  },
];

let failed = 0;
for (const c of cases) {
  const t = extractDocuSealTemplateId(c.body);
  const s = extractDocuSealSubmissionId(c.body);
  const okT = t === c.expectedTemplate;
  const okS = s === c.expectedSubmission;
  const mark = okT && okS ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${c.name}  template=${t} (want ${c.expectedTemplate})  submission=${s} (want ${c.expectedSubmission})`);
  if (!okT || !okS) failed++;
}

if (failed === 0) {
  console.log(`\nAll ${cases.length} cases passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}
