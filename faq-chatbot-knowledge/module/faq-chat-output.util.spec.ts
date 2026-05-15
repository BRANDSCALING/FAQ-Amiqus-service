import {
  dedupeCitationIds,
  applyRetrievalCitationFallback,
  wantsComplianceCertificateChecklist,
} from './faq-chat-output.util';

describe('dedupeCitationIds', () => {
  it('removes duplicates and blanks', () => {
    expect(
      dedupeCitationIds([
        'ucws-section-5',
        'ucws-section-5',
        '  ',
        'ucws-section-6',
        'ucws-section-5',
      ]),
    ).toEqual(['ucws-section-5', 'ucws-section-6']);
  });
});

describe('applyRetrievalCitationFallback', () => {
  it('fills from retrieval when in-scope and empty cites', () => {
    expect(
      applyRetrievalCitationFallback(
        false,
        [],
        ['ucws-section-7', 'ucws-section-3'],
        2,
        true,
      ),
    ).toEqual(['ucws-section-7', 'ucws-section-3']);
  });

  it('does not override when cites present', () => {
    expect(
      applyRetrievalCitationFallback(
        false,
        ['ucws-section-2'],
        ['ucws-section-7'],
        2,
        true,
      ),
    ).toEqual(['ucws-section-2']);
  });

  it('no-op when disabled', () => {
    expect(
      applyRetrievalCitationFallback(false, [], ['ucws-section-1'], 2, false),
    ).toEqual([]);
  });

  it('no-op when out of scope', () => {
    expect(
      applyRetrievalCitationFallback(true, [], ['ucws-section-1'], 2, true),
    ).toEqual([]);
  });
});

describe('wantsComplianceCertificateChecklist', () => {
  it('matches O1-style prompt', () => {
    expect(
      wantsComplianceCertificateChecklist(
        'Give me the full compliance certificate checklist from the document only — no extras.',
      ),
    ).toBe(true);
  });

  it('does not match generic compliance question without list intent', () => {
    expect(wantsComplianceCertificateChecklist('What compliance applies to my property?')).toBe(
      false,
    );
  });
});
