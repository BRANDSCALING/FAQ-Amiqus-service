const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'dist', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const faqSrc = path.join(__dirname, '..', 'faq-chatbot-knowledge');
const faqDest = path.join(__dirname, '..', 'dist', 'faq-chatbot-knowledge');
const SKIP_TOP_LEVEL = new Set(['module', 'scripts']);

function copyFaqKnowledgeTree(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP_TOP_LEVEL.has(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      copyFaqKnowledgeTree(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

copyFaqKnowledgeTree(faqSrc, faqDest);
console.log('✅ Copied faq-chatbot-knowledge assets to dist/faq-chatbot-knowledge/');
