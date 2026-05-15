/**
 * Structured output for FAQ chat (OpenAI gpt-4o / gpt-4o-mini).
 */
export const FAQ_CHAT_RESPONSE_JSON_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'faq_chat_response',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        response: {
          type: 'string',
          description: 'User-facing reply. Polite out-of-scope message if outOfScope is true.',
        },
        outOfScope: {
          type: 'boolean',
          description:
            'True only if none of the retrieved FAQ sections support a grounded answer. False if any retrieved section contains the answer (including checklists inside a section).',
        },
        citedFaqIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Unique section ids used for the answer. Empty only when outOfScope is true. When outOfScope is false, include at least one id from the retrieved sections.',
        },
      },
      required: ['response', 'outOfScope', 'citedFaqIds'],
      additionalProperties: false,
    },
  },
};

export function faqChatUsesStructuredOutput(model: string): boolean {
  return model === 'gpt-4o' || model === 'gpt-4o-mini';
}
