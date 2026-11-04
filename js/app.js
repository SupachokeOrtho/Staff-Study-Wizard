import { STORAGE_KEY, freshDraft, loadDraft, saveDraft } from './storage.js';
import { uid, newSolution, passedSolutions, sfaResult, weightInfo, ranking, recommended, statementText, validateStep } from './model.js';
import { generateConclusion, generateDocument, downloadText } from './export.js';
import { loadGuide, renderGuide } from './guide.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let rules, template, draft, storageBlocked = false, storageWarning = '', lastSavedRaw = null;
let guide;
const guideOpened = new Set();

function getValue(path) { return path.split('.').reduce((value, key) => value?.[key], draft); }
function setValue(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((object, key) => object[key], draft)[last] = value;
}

function persist() {
  const status = $('#save-status');
  if (storageBlocked) {
    status.textContent = 'ยังไม่ได้บันทึก — กรุณาส่งออกงาน';
    status.classList.add('warning');
    return;
  }
  // Avoid silent overwrites when another tab has edited this project.
  try {
    if (localStorage.getItem(STORAGE_KEY) !== lastSavedRaw) {
      storageBlocked = true;
      storageWarning = 'ข้อมูลถูกเปลี่ยนจากแท็บอื่น หยุดบันทึกเพื่อป้องกันการเขียนทับ โปรดส่งออกงานในแท็บนี้ แล้วรีเฟรชเพื่ออ่านข้อมูลล่าสุด';
      showErrors([storageWarning]);
      persist();
      return;
    }
  } catch { /* saveDraft reports storage access failure below */ }
  const saved = saveDraft(draft);
  if (saved) lastSavedRaw = JSON.stringify(draft);
  status.textContent = saved ? '✓ บันทึกอัตโนมัติแล้ว' : 'บันทึกไม่ได้ — พื้นที่จัดเก็บไม่พร้อม กรุณาส่งออกงาน';
  status.classList.toggle('warning', !saved);
}

function field(path, definition) {
  const value = getValue(path) ?? '';
  const id = `field-${path.replaceAll('.', '-')}`;
  const attributes = `id="${escape(id)}" data-path="${escape(path)}" ${definition.required ? 'required' : ''}`;
  let control;
  if (definition.type === 'select') {
    control = `<select ${attributes}><option value="">— เลือก —</option>${definition.options.map(option => {
      const key = typeof option === 'string' ? option : option.value;
      const label = typeof option === 'string' ? option : option.label;
      return `<option value="${escape(key)}" ${value === key ? 'selected' : ''}>${escape(label)}</option>`;
    }).join('')}</select>`;
  } else if (definition.type && definition.type !== 'textarea') {
    control = `<input ${attributes} type="${definition.type}" value="${escape(value)}" placeholder="${escape(definition.placeholder || '')}" ${definition.type === 'number' ? `min="${definition.min ?? 0}" step="${definition.step ?? 'any'}" ${definition.max ? `max="${definition.max}"` : ''}` : ''}>`;
  } else {
    control = `<textarea ${attributes} rows="${definition.rows || 3}" placeholder="${escape(definition.placeholder || '')}">${escape(value)}</textarea>`;
  }
  return `<label class="field" for="${escape(id)}"><span class="field-label">${escape(definition.label)}${definition.required ? '<span class="required" aria-label="จำเป็น">*</span>' : ''}</span>${control}${definition.help ? `<small>${escape(definition.help)}</small>` : ''}</label>`;
}

function fields(prefix, definitions) { return definitions.map(definition => field(`${prefix}.${definition.key}`, definition)).join(''); }
function card(title, body, tag = '') { return `<section class="card"><div class="card-title"><h3>${escape(title)}</h3>${tag ? `<span class="section-tag">${escape(tag)}</span>` : ''}</div>${body}</section>`; }
function note(body) { return `<div class="note">${body}</div>`; }
function addButton(list, label) { return `<button class="button add-button" type="button" data-add="${list}">＋ ${escape(label)}</button>`; }
function listCards(list, definitions, title) {
  return draft[list].map((item, index) => `<section class="card"><div class="card-title"><h3>${escape(title)} ${index + 1}</h3><button class="delete-button" type="button" data-delete="${list}" data-index="${index}" aria-label="ลบ${escape(title)} ${index + 1}">ลบรายการ</button></div>${fields(`${list}.${index}`, definitions)}</section>`).join('') || `<p class="empty">ยังไม่มี${escape(title)} กดเพิ่มรายการเพื่อเริ่มต้น</p>`;
}

function statusBadge(status) { return `<span class="badge ${status}">${{ pass: 'ผ่าน', fail: 'ไม่ผ่าน', pending: 'ยังไม่ครบ' }[status]}</span>`; }
function sfaSummary() {
  const passed = passedSolutions(draft);
  return `<div class="table-wrap"><table><caption class="muted">สรุปผลการทดสอบ SFA</caption><thead><tr><th>วิธีการ</th><th>S</th><th>F</th><th>A</th><th>ผลรวม</th></tr></thead><tbody>${draft.solutions.map(solution => `<tr><td>${escape(solution.name)}</td>${['S', 'F', 'A'].map(key => `<td>${statusBadge(solution.sfa[key].status || 'pending')}</td>`).join('')}<td>${statusBadge(sfaResult(solution))}</td></tr>`).join('')}</tbody></table></div>${note(escape(passed.length === 1 ? rules.help.singlePass : passed.length > 1 ? `มีวิธีผ่าน SFA ${passed.length} วิธี ต้องเปรียบเทียบ Superior Solution ในขั้นถัดไป` : rules.help.noPass))}`;
}

function scoreOutput() {
  const info = weightInfo(draft.criteria, rules);
  const passed = passedSolutions(draft);
  const rows = ranking(draft, rules);
  const top = rows[0]?.score;
  return `<p class="${info.valid ? 'score-total' : 'muted'}" role="status">น้ำหนักรวม: ${Number(info.total.toFixed(6))} ${info.valid ? '✓ ถูกต้อง' : '— ต้องเท่ากับ 1.00 หรือ 100% และทุกเกณฑ์ต้องมากกว่า 0'}</p><p class="muted">คะแนน × น้ำหนักที่ปรับเป็นสัดส่วน = คะแนนถ่วงน้ำหนัก (รวมเต็ม 5)</p><div class="table-wrap"><table><thead><tr><th>วิธีการ / เกณฑ์</th>${draft.criteria.map(criterion => `<th>${escape(criterion.name || 'เกณฑ์ใหม่')}</th>`).join('')}<th>คะแนนรวม</th><th>อันดับ</th></tr></thead><tbody>${passed.map(solution => {
    const row = rows.find(entry => entry.solution.id === solution.id);
    const rank = row ? rows.filter(entry => entry.score > row.score + 1e-9).length + 1 : '—';
    return `<tr class="${row && Math.abs(row.score - top) < 1e-9 ? 'winner' : ''}"><td>${escape(solution.name)}</td>${draft.criteria.map(criterion => `<td>${info.valid && criterion.scores[solution.id] ? (Number(criterion.scores[solution.id]) * Number(criterion.weight) / info.unit).toFixed(3) : '—'}</td>`).join('')}<td class="score-total">${row ? row.score.toFixed(3) : '—'}</td><td>${rank}${rank === 1 ? ' ★' : ''}</td></tr>`;
  }).join('')}</tbody></table></div>${!rows.length ? '<p class="muted">กรอกน้ำหนักและคะแนนให้ครบก่อนจัดอันดับ</p>' : rows.filter(row => Math.abs(row.score - top) < 1e-9).length > 1 ? note('คะแนนสูงสุดเท่ากัน โปรดทบทวนเกณฑ์และเลือกวิธีที่เสนอในขั้นข้อยุติ') : ''}`;
}

function renderStep() {
  const step = draft.step;
  if (step < 4) {
    const key = rules.workflow[step].id;
    const section = rules.sections[key];
    let body = fields(key, section.fields);
    if (step === 0) {
      body = field('project.title', section.fields[0]) + `<div class="grid">${section.fields.slice(1, 4).map(definition => field(`project.${definition.key}`, definition)).join('')}</div>` + field('project.notes', section.fields[4]);
      return note('<strong>เริ่มจากปัญหา แล้วจึงพิจารณาวิธีแก้</strong>เครื่องมือนี้จะช่วยเรียบเรียงข้อมูลอย่างเป็นลำดับ ตั้งแต่สภาวะพึงประสงค์จนถึงข้อยุติ โดยคุณเป็นผู้วิเคราะห์และตัดสินใจ') + card(section.title, body, section.tag) + '<p class="muted">ช่องที่มี * เป็นข้อมูลจำเป็นสำหรับการไปขั้นถัดไป</p>';
    }
    const compare = step === 3 ? `<div class="comparison"><div><h3>สภาวะพึงประสงค์</h3><p>${escape(draft.desired.state)}</p></div><div><h3>สภาวะปัจจุบัน</h3><p>${escape(draft.current.state)}</p></div></div>` : '';
    return compare + card(section.title, body, section.tag);
  }
  if (step === 4) return listCards('effects', rules.effectFields, 'ผลกระทบ') + addButton('effects', 'เพิ่มผลกระทบ');
  if (step === 5) return note(escape(rules.help.root)) + listCards('causes', rules.causeFields, 'สาเหตุที่เป็นไปได้') + addButton('causes', 'เพิ่มสาเหตุ') + card('สาเหตุที่แท้จริง / Root Cause', fields('root', rules.rootFields));
  if (step === 6) return card('กิจ และมุ่งประสงค์', field('statement.task', { label: 'กิจ', required: true, help: rules.help.task }) + field('statement.purpose', { label: 'มุ่งประสงค์', required: true, help: rules.help.purpose })) + note(escape(rules.help.endStates)) + listCards('endStates', [{ key: 'text', label: 'เงื่อนไขความสำเร็จ', required: true }], 'END STATE') + addButton('endStates', 'เพิ่ม END STATE') + card('ข้อแถลงปัญหา', '<p class="muted">ข้อความอัตโนมัติ: ให้ [กิจ] เพื่อ [มุ่งประสงค์]</p><div id="statement-preview" class="generated"></div>' + field('statement.manual', { label: 'ประโยคสุดท้าย (แก้ไขได้)', help: 'เมื่อแก้ไขเอง ข้อความนี้จะถูกเก็บไว้จนกว่าจะเลือกใช้ข้อความอัตโนมัติ' }) + '<button type="button" class="button secondary" data-action="reset-statement">ใช้ข้อความอัตโนมัติ</button>');
  if (step === 7) return note(`<strong>วิธีการที่เหมาะสมควร</strong><ul>${rules.solutionReminder.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`) + listCards('solutions', rules.solutionFields, 'วิธีการ') + addButton('solutions', 'เพิ่มวิธีการแก้ปัญหา');
  if (step === 8) return note(`<strong>มุ่งประสงค์: ${escape(draft.statement.purpose)}</strong><ul>${draft.endStates.map(item => `<li>${escape(item.text)}</li>`).join('')}</ul>`) + draft.solutions.map((solution, index) => card(`${index + 1}. ${solution.name}`, `<p class="muted">${escape(solution.details)}</p>${Object.entries(rules.sfa).map(([key, section]) => `<div class="sfa-section"><h3><span class="sfa-letter">${key}</span>${escape(section.title)}</h3><p class="muted">${escape(section.help)}</p>${key === 'A' ? '<h4>Worthiness / ความคุ้มค่า และ Risk / ความเสี่ยง</h4>' : ''}${fields(`solutions.${index}.sfa.${key}`, section.fields)}</div>`).join('')}`)).join('') + card('ผลการทดสอบ', '<div id="sfa-summary"></div>');
  if (step === 9) {
    return note(`<strong>สร้างเกณฑ์จากผลลัพธ์และการใช้ทรัพยากร</strong>${rules.criterionCategories.map(category => `<p><b>${escape(category.label)}</b> — ${escape(category.help)}</p>`).join('')}มุ่งประสงค์: ${escape(draft.statement.purpose)}<ul>${draft.endStates.map(item => `<li>${escape(item.text)}</li>`).join('')}</ul>`) + draft.criteria.map((criterion, index) => `<section class="card"><div class="card-title"><h3>เกณฑ์ ${index + 1}</h3><button class="delete-button" type="button" data-delete="criteria" data-index="${index}" aria-label="ลบเกณฑ์ ${index + 1}">ลบรายการ</button></div>${fields(`criteria.${index}`, [{ key: 'name', label: 'ชื่อตัวเกณฑ์', type: 'text', required: true }, { key: 'category', label: 'ประเภท', type: 'select', options: rules.criterionCategories, required: true }, { key: 'definition', label: 'คำนิยาม', required: true }, { key: 'weight', label: 'น้ำหนัก', type: 'number', min: 0, required: true, help: 'ใช้สัดส่วนรวม 1.00 หรือตัวเลขเปอร์เซ็นต์รวม 100 ทุกเกณฑ์ต้องใช้หน่วยเดียวกัน' }])}<h4>คะแนนแต่ละวิธี (1–5; คะแนนมาก = ดีกว่า)</h4><p class="muted">สำหรับเวลาและต้นทุน ให้คะแนนสูงกับวิธีที่ใช้เวลาและต้นทุนน้อยกว่า</p><div class="grid">${passedSolutions(draft).map(solution => field(`criteria.${index}.scores.${solution.id}`, { label: solution.name, type: 'number', min: rules.validation.scoreMin, max: rules.validation.scoreMax, step: 1, required: true })).join('')}</div></section>`).join('') + addButton('criteria', 'เพิ่มเกณฑ์เปรียบเทียบ') + card('ผลการเปรียบเทียบ', '<div id="score-output"></div>');
  }
  if (step === 10) {
    const choice = recommended(draft, rules);
    return card('สรุปผลการพิจารณา', '<div id="conclusion-summary" class="generated"></div>') + card('วิธีการที่เสนอ และข้อยุติ', `<label class="field"><span class="field-label">วิธีการที่ได้รับการเสนอเป็นข้อยุติ</span><select id="recommendation" data-path="recommendation">${passedSolutions(draft).map(solution => `<option value="${escape(solution.id)}" ${solution.id === choice?.id ? 'selected' : ''}>${escape(solution.name)}</option>`).join('')}</select><small>ค่าเริ่มต้นคือวิธีที่ได้คะแนนสูงสุด สามารถทบทวนและเลือกวิธีที่ผ่าน SFA อื่นได้</small></label>` + field('conclusion', { label: 'ข้อยุติฉบับสุดท้าย (แก้ไขได้)', rows: 16, help: 'ข้อความที่แก้เองจะถูกเก็บไว้ เมื่อเปลี่ยนข้อมูลก่อนหน้า โปรดตรวจทานหรือสร้างข้อยุติใหม่' }) + '<button type="button" class="button secondary" data-action="reset-conclusion">ใช้ข้อความสรุปอัตโนมัติ</button>');
  }
  return `<div class="actions no-print"><button class="button primary" type="button" data-action="download">↓ ดาวน์โหลด .txt</button><button class="button secondary" type="button" data-action="copy">คัดลอกทั้งหมด / Copy all</button><button class="button secondary" type="button" data-action="print">พิมพ์ / Print</button><button class="button secondary" type="button" data-action="edit">กลับไปแก้ไข</button></div><p id="export-status" class="status-message no-print" role="status"></p><pre id="preview" class="document"></pre>`;
}

function updateDerived() {
  $('#project-name').textContent = draft.project.title || 'งานพิจารณาใหม่';
  if ($('#statement-preview')) {
    $('#statement-preview').textContent = `ให้ ${draft.statement.task} เพื่อ ${draft.statement.purpose}`;
    if (draft.statement.manual === null) $('[data-path="statement.manual"]').value = statementText(draft);
  }
  if ($('#sfa-summary')) {
    $('#sfa-summary').innerHTML = sfaSummary();
    $('#next').textContent = passedSolutions(draft).length === 1 ? 'ไปยังข้อยุติ →' : 'ถัดไป →';
  }
  if ($('#score-output')) $('#score-output').innerHTML = scoreOutput();
  if ($('#conclusion-summary')) {
    $('#conclusion-summary').textContent = generateConclusion(draft, rules);
    if (draft.conclusion === null) $('[data-path="conclusion"]').value = generateConclusion(draft, rules);
  }
  if ($('#preview')) $('#preview').textContent = generateDocument(draft, rules);
}

function render(focus = false) {
  const step = draft.step;
  const definition = rules.workflow[step];
  const skipComparison = passedSolutions(draft).length <= 1;
  $('#steps').innerHTML = rules.workflow.map((item, index) => `<button type="button" class="step-link ${index === step ? 'active' : ''} ${index < draft.maxStep ? 'done' : ''}" data-step="${index}" ${index > draft.maxStep || (index === 9 && skipComparison) ? 'disabled' : ''} ${index === step ? 'aria-current="step"' : ''}><span class="step-number">${String(index + 1).padStart(2, '0')}</span><span class="step-label">${escape(item.title)}${index === 9 && skipComparison ? '<span class="skipped-note">ใช้เมื่อมีวิธีผ่าน SFA มากกว่า 1 วิธี</span>' : ''}</span></button>`).join('');
  $('#step-counter').textContent = `ขั้นที่ ${step + 1} / 12`;
  $('#progress-label').textContent = step === 11 ? 'พร้อมตรวจทานเอกสาร' : 'วิเคราะห์ → พิจารณา → เสนอข้อยุติ';
  $('#progress-fill').style.width = `${(step + 1) / 12 * 100}%`;
  $('#step-title').textContent = definition.title;
  $('#step-english').textContent = `${String(step + 1).padStart(2, '0')} / ${definition.english}`;
  $('#step-description').textContent = definition.description;
  if ($('#step-guide').dataset.step !== definition.id) {
    $('#step-guide').innerHTML = renderGuide(definition.id, guide, guideOpened);
    $('#step-guide').dataset.step = definition.id;
  }
  $('#step-content').innerHTML = renderStep();
  $('#previous').disabled = step === 0;
  $('#next').hidden = step === 11;
  $('#next').textContent = step === 0 ? 'เริ่มทำข้อพิจารณา →' : step === 10 ? 'ตรวจทานเอกสาร →' : 'ถัดไป →';
  $('#errors').hidden = true;
  updateDerived();
  if (storageBlocked) showErrors([storageWarning]);
  if (focus) { $('#main').focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }
}

function showErrors(errors) {
  $('#errors').hidden = false;
  $('#errors').innerHTML = `<strong>โปรดตรวจสอบก่อนดำเนินการต่อ</strong><ul>${errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul>`;
  $('#errors').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function navigate(target) {
  if (target < 0 || target > 11) return;
  if (target > draft.step) {
    for (let index = 0; index < target; index++) {
      const errors = validateStep(index, draft, rules);
      if (errors.length) {
        draft.step = index;
        render(true);
        showErrors(errors);
        persist();
        return;
      }
    }
  }
  if (target === 9 && passedSolutions(draft).length === 1) target = target > draft.step ? 10 : 8;
  draft.step = target;
  draft.maxStep = Math.max(draft.maxStep, target);
  persist();
  render(true);
}

function addItem(list) {
  const definitions = { effects: rules.effectFields, causes: rules.causeFields, endStates: [{ key: 'text' }] };
  let item;
  if (list === 'solutions') item = newSolution(rules);
  else if (list === 'criteria') item = { id: uid(), name: '', category: '', definition: '', weight: '', scores: {} };
  else item = { id: uid(), ...Object.fromEntries(definitions[list].map(definition => [definition.key, ''])) };
  draft[list].push(item);
  persist();
  render();
  $(`[data-path="${list}.${draft[list].length - 1}.${list === 'solutions' || list === 'criteria' ? 'name' : 'text'}"]`)?.focus();
}

async function handleAction(action) {
  if (action === 'reset-statement' || action === 'reset-conclusion') {
    const isStatement = action === 'reset-statement';
    const hasManual = isStatement ? draft.statement.manual !== null : draft.conclusion !== null;
    if (hasManual && !confirm('ข้อความที่แก้ไขเองจะถูกแทนที่ด้วยข้อความอัตโนมัติ ต้องการดำเนินการต่อหรือไม่?')) return;
    if (isStatement) draft.statement.manual = null;
    else draft.conclusion = null;
    persist();
    updateDerived();
  }
  if (action === 'edit') navigate(10);
  if (action === 'download') {
    downloadText(draft, rules);
    $('#export-status').textContent = 'สร้างไฟล์ข้อความ UTF-8 แล้ว โปรดเก็บไฟล์ในที่ปลอดภัย';
  }
  if (action === 'print') window.print();
  if (action === 'copy') {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(generateDocument(draft, rules));
      $('#export-status').textContent = 'คัดลอกข้อความทั้งหมดแล้ว';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($('#preview'));
      selection.removeAllRanges();
      selection.addRange(range);
      $('#export-status').textContent = 'เบราว์เซอร์ไม่อนุญาตการคัดลอกอัตโนมัติ เลือกข้อความให้แล้ว ใช้ Ctrl+C / ⌘C หรือดาวน์โหลด .txt';
    }
  }
}

function resetProject() {
  if (!confirm('ข้อมูลทั้งหมดของงานนี้จะถูกลบ ต้องการดำเนินการต่อหรือไม่?')) return;
  try { localStorage.removeItem(STORAGE_KEY); lastSavedRaw = null; } catch { /* keep in-memory workflow available */ }
  draft = freshDraft(template);
  storageBlocked = false;
  storageWarning = '';
  persist();
  render(true);
}

async function init() {
  try {
    [rules, template, guide] = await Promise.all([...['data/staff-study-rules.json', 'data/default-template.json'].map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cannot load ${url}`);
      return response.json();
    }), loadGuide()]);
    const loaded = loadDraft(template);
    draft = loaded.draft;
    storageBlocked = loaded.blocked;
    storageWarning = loaded.warning;
    try { lastSavedRaw = localStorage.getItem(STORAGE_KEY); } catch { /* handled by loaded warning */ }
    // A restored page must also respect prerequisites if data was edited outside the app.
    for (let index = 0; index < draft.step; index++) {
      if (validateStep(index, draft, rules).length) { draft.step = index; break; }
    }
    if (draft.step === 9 && passedSolutions(draft).length <= 1) draft.step = 8;
    $('#wizard-form').addEventListener('submit', event => event.preventDefault());
    $('#step-guide').addEventListener('toggle', event => {
      const key = event.target.dataset.guideToggle;
      if (!key) return;
      if (event.target.open) guideOpened.add(key);
      else guideOpened.delete(key);
    }, true);
    $('#wizard-form').addEventListener('input', event => {
      const path = event.target.dataset.path;
      if (!path) return;
      setValue(path, event.target.value);
      persist();
      updateDerived();
    });
    $('#steps').addEventListener('click', event => {
      const button = event.target.closest('[data-step]');
      if (button && !button.disabled) navigate(Number(button.dataset.step));
    });
    $('#step-content').addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.add) addItem(button.dataset.add);
      if (button.dataset.delete) {
        const list = button.dataset.delete;
        const index = Number(button.dataset.index);
        if (!confirm('ต้องการลบรายการนี้พร้อมข้อมูลที่เกี่ยวข้องหรือไม่?')) return;
        const [removed] = draft[list].splice(index, 1);
        if (list === 'solutions') {
          for (const criterion of draft.criteria) delete criterion.scores[removed.id];
          if (draft.recommendation === removed.id) draft.recommendation = '';
        }
        persist();
        render();
      }
      if (button.dataset.action) handleAction(button.dataset.action);
    });
    $('#next').addEventListener('click', () => navigate(draft.step + 1));
    $('#previous').addEventListener('click', () => navigate(draft.step - 1));
    $('#new-project').addEventListener('click', resetProject);
    $('#clear-data').addEventListener('click', resetProject);
    window.addEventListener('storage', event => {
      if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== lastSavedRaw) {
        storageBlocked = true;
        storageWarning = 'ข้อมูลถูกเปลี่ยนจากแท็บอื่น โปรดส่งออกงานในแท็บนี้ก่อนรีเฟรชเพื่ออ่านข้อมูลล่าสุด';
        showErrors([storageWarning]);
        persist();
      }
    });
    render();
    if (lastSavedRaw || storageBlocked) persist();
  } catch (error) {
    $('#step-content').textContent = 'ไม่สามารถโหลดเครื่องมือได้ กรุณาเปิดผ่านเว็บเซิร์ฟเวอร์ เช่น python3 -m http.server 8000 จากโฟลเดอร์โครงการ แล้วรีเฟรชหน้าอีกครั้ง';
    $('#next').disabled = true;
    $('#previous').disabled = true;
    console.error(error);
  }
}

init();
