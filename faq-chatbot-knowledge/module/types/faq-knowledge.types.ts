export interface FaqEntry {
  id?: string;
  category?: string;
  question: string;
  answer: string;
}

export interface FaqKnowledgeFile {
  /** Bump when FAQs change (cache key + ops visibility). */
  version?: string;
  chatbotTitle: string;
  scopeDescription: string;
  faqs: FaqEntry[];
}
