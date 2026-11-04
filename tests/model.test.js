import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newSolution, passesSFA, sfaResult, ranking, weightInfo, validateStep, statementText, recommended, reviewIssues } from '../js/model.js';
import { freshDraft, loadDraft, saveDraft, STORAGE_KEY } from '../js/storage.js';
import { generateDocument, exportFilename } from '../js/export.js';

const rules = JSON.parse(readFileSync(new URL('../data/staff-study-rules.json', import.meta.url)));
const template = JSON.parse(readFileSync(new URL('../data/default-template.json', import.meta.url)));
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const passing = name => {
  const solution = newSolution(rules);
  solution.name = name;
  solution.details = 'รายละเอียดวิธี';
  solution.resources = 'เจ้าหน้าที่ 2 นาย';
  for (const [key, section] of Object.entries(rules.sfa)) {
    for (const field of section.fields) solution.sfa[key][field.key] = field.type === 'select' ? (typeof field.options[0] === 'string' ? field.options[0] : field.options[0].value) : 'หลักฐานการประเมิน';
  }
  return solution;
};

test('all SFA dimensions must pass and residual risk must be accepted', () => {
  const solution = passing('วิธีหนึ่ง');
  assert.equal(passesSFA(solution), true);
  for (const key of ['S', 'F', 'A']) {
    solution.sfa[key].status = 'fail';
    assert.equal(sfaResult(solution), 'fail');
    solution.sfa[key].status = '';
    assert.equal(sfaResult(solution), 'pending');
    solution.sfa[key].status = 'pass';
  }
  solution.sfa.A.riskAccepted = 'no';
  assert.equal(passesSFA(solution), false);
  assert.equal(sfaResult(solution), 'fail');
});

test('weights support fractions and percentages with identical ranking; reject invalid totals', () => {
  const draft = freshDraft(template);
  draft.solutions = [passing('วิธี A'), passing('วิธี B'), passing('วิธีที่ไม่ผ่าน')];
  draft.solutions[2].sfa.F.status = 'fail';
  const [a, b] = draft.solutions;
  draft.criteria = [
    { id: 'c1', name: 'ผลลัพธ์', category: 'effectiveness', definition: 'ตรงตามเป้าหมาย', weight: '60', scores: { [a.id]: '5', [b.id]: '2' } },
    { id: 'c2', name: 'ต้นทุน', category: 'efficiency', definition: 'ต้นทุนน้อยได้คะแนนมาก', weight: '40', scores: { [a.id]: '1', [b.id]: '5' } }
  ];
  assert.deepEqual(validateStep(9, draft, rules), []);
  assert.equal(ranking(draft, rules)[0].solution.id, a.id);
  assert.equal(ranking(draft, rules)[0].score, 3.4);
  assert.equal(ranking(draft, rules).length, 2);
  draft.criteria[0].weight = '0.6';
  draft.criteria[1].weight = '0.4';
  assert.equal(ranking(draft, rules)[0].score, 3.4);
  draft.criteria[1].weight = '0.3';
  assert.equal(weightInfo(draft.criteria, rules).valid, false);
  assert.deepEqual(ranking(draft, rules), []);
  assert.ok(validateStep(9, draft, rules).length);
  draft.criteria[0].weight = '-1';
  draft.criteria[1].weight = '2';
  assert.equal(weightInfo(draft.criteria, rules).valid, false);
});

test('scores require explicit integers 1–5 and both criterion categories', () => {
  const draft = freshDraft(template);
  draft.solutions = [passing('A'), passing('B')];
  draft.criteria = [{ id: 'c', name: 'เกณฑ์', category: 'effectiveness', definition: 'คำนิยาม', weight: '100', scores: {} }];
  for (const value of ['', '0', '6', '2.5', 'NaN']) {
    for (const solution of draft.solutions) draft.criteria[0].scores[solution.id] = value;
    assert.ok(validateStep(9, draft, rules).length);
    assert.deepEqual(ranking(draft, rules), []);
  }
  for (const solution of draft.solutions) draft.criteria[0].scores[solution.id] = '5';
  assert.ok(validateStep(9, draft, rules).some(error => error.includes('Efficiency')));
});

test('single passing solution needs no comparison; zero passes remains an unresolved SFA issue', () => {
  const draft = freshDraft(template);
  draft.solutions = [passing('วิธีเดียว')];
  assert.deepEqual(validateStep(8, draft, rules), []);
  assert.deepEqual(validateStep(9, draft, rules), []);
  assert.equal(recommended(draft, rules).name, 'วิธีเดียว');
  draft.solutions[0].sfa.S.status = 'fail';
  assert.ok(validateStep(8, draft, rules).includes(rules.help.noPass));
});

test('autosave round-trip retains Thai, SFA, scores, and manual edits; corrupt data is preserved', () => {
  const storage = memory();
  const draft = freshDraft(template);
  draft.project.title = 'การจัดทำรายงานภาษาไทย';
  draft.solutions = [passing('วิธีแรก')];
  draft.criteria = [{ id: 'c', name: 'เกณฑ์', category: 'efficiency', definition: 'ประหยัด', weight: '1', scores: { [draft.solutions[0].id]: '4' } }];
  draft.conclusion = 'ข้อยุติที่แก้ไขเอง';
  draft.statement.manual = 'ให้ดำเนินการตามที่กำหนด';
  assert.equal(saveDraft(draft, storage), true);
  assert.deepEqual(loadDraft(template, storage).draft, draft);
  storage.setItem(STORAGE_KEY, '{corrupt');
  assert.equal(loadDraft(template, storage).blocked, true);
  assert.equal(storage.getItem(STORAGE_KEY), '{corrupt');
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Quota'); } };
  assert.equal(loadDraft(template, denied).blocked, true);
  assert.equal(saveDraft(draft, denied), false);
});

test('text output includes all sections, evidence, Thai and manual conclusion; filename is safe', () => {
  const draft = freshDraft(template);
  draft.project.title = 'รายงาน / ทดสอบ:*';
  draft.effects = [{ id: 'e', text: 'ผลกระทบ', affected: 'หน่วย', severity: 'สูง', evidence: 'หลักฐานสำคัญ' }];
  draft.solutions = [passing('วิธีไทย')];
  draft.statement.task = 'ลดขั้นตอน';
  draft.statement.purpose = 'ลดระยะเวลา';
  assert.equal(statementText(draft), 'ให้ ลดขั้นตอน เพื่อ ลดระยะเวลา');
  draft.statement.manual = 'ข้อแถลงแก้ไขเอง';
  draft.conclusion = 'ข้อยุติแก้ไขเอง';
  const output = generateDocument(draft, rules);
  for (const value of ['1. สภาวะพึงประสงค์', '10. ข้อยุติ', 'หลักฐานสำคัญ', 'ข้อแถลงแก้ไขเอง', 'ข้อยุติแก้ไขเอง', 'Residual Risk']) assert.ok(output.includes(value));
  assert.equal(exportFilename(draft, new Date(2026, 10, 4)), 'staff-study-รายงาน-ทดสอบ-2026-11-04.txt');
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(output)), output);
});

test('incomplete drafts remain reviewable and never claim a passing solution when none passes', () => {
  const draft = freshDraft(template);
  draft.step = 11;
  draft.maxStep = 11;
  const issues = reviewIssues(draft, rules);
  assert.ok(issues.some(issue => issue.step === 0 && issue.errors.some(error => error.includes('Project title'))));
  assert.ok(issues.some(issue => issue.step === 5 && issue.errors.some(error => error.includes('สาเหตุที่แท้จริง'))));
  const output = generateDocument(draft, rules);
  assert.ok(output.startsWith('ฉบับร่าง'));
  assert.ok(output.includes('ยังไม่มีวิธีผ่าน SFA'));
  assert.ok(!output.includes('มีวิธีผ่าน SFA เพียง 1 วิธี'));
  const storage = memory();
  saveDraft(draft, storage);
  assert.equal(loadDraft(template, storage).draft.step, 11);
});

test('fully completed studies export without the draft marker; later missing analysis restores it', () => {
  const draft = freshDraft(template);
  for (const key of ['project', 'desired', 'current', 'problem', 'root']) {
    for (const field of Object.keys(draft[key])) draft[key][field] ||= 'ข้อมูลที่ตรวจสอบแล้ว';
  }
  draft.effects = [{ id: 'e', text: 'ผลกระทบ', affected: 'หน่วย', severity: 'สูง', evidence: 'หลักฐาน' }];
  draft.causes = [{ id: 'c', text: 'สาเหตุ', category: 'ขั้นตอน', evidence: 'หลักฐาน', link: 'เหตุผล' }];
  draft.statement.task = 'ปรับกระบวนงาน';
  draft.statement.purpose = 'ส่งรายงานทัน';
  draft.endStates = [{ id: 'end', text: 'รายงานเสร็จภายใน 2 วัน' }];
  draft.solutions = [passing('วิธีที่ผ่านการพิจารณา')];
  assert.deepEqual(reviewIssues(draft, rules), []);
  assert.ok(!generateDocument(draft, rules).startsWith('ฉบับร่าง'));
  draft.root.text = '';
  assert.ok(generateDocument(draft, rules).startsWith('ฉบับร่าง'));
  assert.equal(reviewIssues(draft, rules).find(issue => issue.step === 5).errors.length, 1);
});
