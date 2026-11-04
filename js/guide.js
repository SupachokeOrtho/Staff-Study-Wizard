// Read-only learning content stays outside the study draft and export pipeline.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function validGuide(guide) {
  const strings = (object, keys) => object && keys.every(key => typeof object[key] === 'string');
  const textList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  const refs = value => Array.isArray(value) && value.every(item => strings(item, ['document']) && Array.isArray(item.pages) && item.pages.every(Number.isInteger));
  return guide?.version === 1 && strings(guide, ['pageNote', 'exampleNote', 'scopeNote']) &&
    Array.isArray(guide.documents) && guide.documents.every(source => strings(source, ['id', 'title', 'shortTitle', 'file', 'scope']) && Number.isInteger(source.pages)) &&
    Array.isArray(guide.steps) && guide.steps.every(step =>
      strings(step, ['id', 'title', 'overview']) && textList(step.cautions) && textList(step.checklist) &&
      Array.isArray(step.principles) && step.principles.every(section => strings(section, ['title']) && textList(section.points) && refs(section.refs)) &&
      Array.isArray(step.writing) && step.writing.every(field => strings(field, ['label', 'instruction', 'example'])) &&
      Array.isArray(step.sourceExamples) && step.sourceExamples.every(example => strings(example, ['title', 'text']) && refs(example.refs))
    );
}

export async function loadGuide(fetcher = fetch) {
  try {
    const response = await fetcher('data/staff-study-guide.json');
    if (!response.ok) return null;
    const guide = await response.json();
    if (!validGuide(guide)) return null;
    return guide;
  } catch {
    // Unavailable help must not prevent editing or exporting the user's study.
    return null;
  }
}

function documentPath(document) {
  // Reference links are bundled static files, never arbitrary remote URLs.
  return /^references\/[a-z0-9-]+\.pdf$/.test(document?.file || '') ? document.file : '';
}

function references(refs, guide) {
  return `<div class="guide-citations">${refs.map(reference => {
    const source = guide.documents.find(document => document.id === reference.document);
    const file = documentPath(source);
    if (!file) return '';
    return `<span class="guide-source">${escape(source.shortTitle)} · หน้า PDF ${reference.pages.map(page => Number.isInteger(page) && page >= 1 && page <= source.pages ? `<a href="${file}#page=${page}" target="_blank" rel="noopener noreferrer" aria-label="เปิด ${escape(source.title)} หน้า PDF ${page} ในแท็บใหม่">${page}</a>` : '').filter(Boolean).join(', ')}</span>`;
  }).join('')}</div>`;
}

export function renderGuide(stepId, guide, opened = new Set()) {
  const step = guide?.steps.find(item => item.id === stepId);
  if (!step) return '<p class="guide-unavailable no-print" role="status">คำแนะนำอ้างอิงยังโหลดไม่ได้ สามารถกรอกงานต่อได้ และรีเฟรชเพื่อโหลดคำแนะนำอีกครั้ง</p>';
  const list = items => `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`;
  const details = (key, title, body) => `<details data-guide-toggle="${escape(`${stepId}:${key}`)}" ${opened.has(`${stepId}:${key}`) ? 'open' : ''}><summary>${escape(title)}</summary><div class="guide-section-body">${body}</div></details>`;
  const principles = step.principles.map((section, index) => details(`principle-${index}`, section.title, list(section.points) + references(section.refs, guide))).join('');
  const writing = `<p class="guide-example-note">${escape(guide.exampleNote)}</p><dl class="guide-fields">${step.writing.map(item => `<div><dt>${escape(item.label)}</dt><dd><p>${escape(item.instruction)}</p><div class="guide-example"><span>ตัวอย่างสมมติ</span><p>${escape(item.example)}</p></div></dd></div>`).join('')}</dl>`;
  const examples = step.sourceExamples.map(item => `<article class="guide-source-example"><h4>${escape(item.title)}</h4><span class="guide-example-label">สรุปตัวอย่างจากเอกสาร</span><p>${escape(item.text)}</p>${references(item.refs, guide)}</article>`).join('');
  const library = `<p>${escape(guide.pageNote)}</p><div class="guide-document-list">${guide.documents.map(document => {
    const file = documentPath(document);
    if (!file) return '';
    return `<article><h4>${escape(document.title)}</h4><p>${escape(document.scope)}</p><div class="guide-document-actions"><span>${document.pages} หน้า</span><a href="${file}" target="_blank" rel="noopener noreferrer">เปิดต้นฉบับ ↗</a><a href="${file}" download>ดาวน์โหลด PDF</a></div></article>`;
  }).join('')}</div><p class="muted">ไฟล์ต้นฉบับรวมประมาณ 45 MB จะโหลดเมื่อเลือกเปิดหรือดาวน์โหลดเท่านั้น หากต้องอ่าน PDF แบบ offline ให้ดาวน์โหลดเก็บไว้ก่อน</p>`;
  return details('main', 'เปิดสรุปเอกสาร · วิธีเขียนและตัวอย่างขั้นนี้',
    `<div class="guide-heading"><span class="eyebrow">READ · UNDERSTAND · WRITE</span><h3>คู่มือประกอบ: ${escape(step.title)}</h3><p>${escape(step.overview)}</p></div><p class="guide-page-note">${escape(guide.pageNote)}</p>` +
    `<div class="guide-topics"><h4 class="guide-topics-heading">สรุปหลักการจากเอกสาร</h4>${principles}` +
    details('writing', `วิธีเขียนแต่ละช่อง พร้อมตัวอย่างสมมติ (${step.writing.length} หัวข้อ)`, writing) +
    details('source-examples', 'ตัวอย่างที่ใช้สอนในสไลด์', examples) +
    details('cautions', 'ข้อควรระวังในการเขียน', list(step.cautions)) +
    details('checklist', 'ตรวจตัวเองก่อนทำขั้นต่อไป', list(step.checklist)) +
    details('library', 'เอกสารต้นฉบับทั้ง 3 ฉบับ และขอบเขตของสรุป', `<p>${escape(guide.scopeNote)}</p>${library}`) +
    '</div><p class="guide-footer">ใช้เพื่อประกอบการเขียนเท่านั้น การเปิดคู่มือไม่เปลี่ยนคำตอบและไม่เพิ่มตัวอย่างลงในเอกสารส่งออก</p>'
  );
}
