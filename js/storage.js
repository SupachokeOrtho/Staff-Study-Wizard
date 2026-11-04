export const STORAGE_KEY = 'staff-study-wizard:v1';

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function freshDraft(template) {
  const draft = structuredClone(template);
  draft.project.date = localDate();
  return draft;
}

// Reject incompatible/corrupt saves without overwriting the stored recovery copy.
export function loadDraft(template, storage = localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { draft: freshDraft(template), warning: '', blocked: false };
    const data = JSON.parse(raw);
    const isText = value => typeof value === 'string';
    const nullableText = value => value === null || isText(value);
    const record = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!record(data) || data.version !== 1) throw new Error('version');
    for (const key of ['project', 'desired', 'current', 'problem', 'root', 'statement']) {
      if (!record(data[key])) throw new Error(key);
      for (const field of Object.keys(template[key])) {
        if (!(template[key][field] === null ? nullableText(data[key][field]) : isText(data[key][field]))) throw new Error(field);
      }
    }
    const checkList = (name, fields) => {
      if (!Array.isArray(data[name]) || data[name].some(item => !record(item) || !isText(item.id) || fields.some(field => !isText(item[field])))) throw new Error(name);
      if (new Set(data[name].map(item => item.id)).size !== data[name].length) throw new Error('duplicate ids');
    };
    checkList('effects', ['text', 'affected', 'severity', 'evidence']);
    checkList('causes', ['text', 'category', 'evidence', 'link']);
    checkList('endStates', ['text']);
    checkList('solutions', ['name', 'details', 'resources', 'notes']);
    for (const solution of data.solutions) {
      if (!record(solution.sfa)) throw new Error('sfa');
      for (const key of ['S', 'F', 'A']) {
        if (!record(solution.sfa[key]) || Object.values(solution.sfa[key]).some(value => !isText(value))) throw new Error('sfa fields');
      }
    }
    checkList('criteria', ['name', 'category', 'definition', 'weight']);
    for (const criterion of data.criteria) {
      if (!record(criterion.scores) || Object.values(criterion.scores).some(value => !isText(value))) throw new Error('scores');
    }
    if (!nullableText(data.conclusion) || !isText(data.recommendation)) throw new Error('conclusion');
    if (![data.step, data.maxStep].every(value => Number.isInteger(value) && value >= 0 && value <= 11) || data.step > data.maxStep) throw new Error('step');
    return { draft: data, warning: '', blocked: false };
  } catch {
    return { draft: freshDraft(template), warning: 'ไม่สามารถอ่านข้อมูลเดิมได้ หรือเบราว์เซอร์ไม่อนุญาตให้เข้าถึงพื้นที่จัดเก็บ ข้อมูลเดิมจะไม่ถูกเขียนทับ โปรดเก็บหน้าต่างเดิมไว้และส่งออกงานที่ต้องการก่อนเริ่มงานใหม่', blocked: true };
  }
}

export function saveDraft(draft, storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
