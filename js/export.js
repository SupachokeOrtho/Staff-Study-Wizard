import { localDate } from './storage.js';
import { statementText, sfaResult, ranking, recommended, passedSolutions, reviewIssues } from './model.js';

const resultLabels = { pass: 'ผ่าน', fail: 'ไม่ผ่าน', pending: 'ยังประเมินไม่ครบ', yes: 'ยอมรับได้', no: 'ยอมรับไม่ได้' };
const valueText = value => resultLabels[value] || value || '—';
const fieldsText = (object, fields) => fields.map(field => `${field.label}: ${valueText(object[field.key])}`).join('\n');

export function comparisonText(draft, rules) {
  if (passedSolutions(draft).length === 0) return 'ยังไม่มีวิธีผ่าน SFA จึงยังเปรียบเทียบวิธีการไม่ได้';
  if (passedSolutions(draft).length === 1) return 'ไม่ต้องเปรียบเทียบ เนื่องจากมีวิธีผ่าน SFA เพียง 1 วิธี';
  const rows = ranking(draft, rules);
  return [
    ...draft.criteria.map((criterion, i) => `${i + 1}. ${criterion.name} (${rules.criterionCategories.find(category => category.value === criterion.category)?.label || ''})\nคำนิยาม: ${criterion.definition}\nน้ำหนัก: ${criterion.weight}\n${passedSolutions(draft).map(solution => `${solution.name}: คะแนน ${criterion.scores[solution.id] || '—'}`).join('\n')}`),
    'คะแนนถ่วงน้ำหนักรวม (ปรับน้ำหนักเป็นสัดส่วน; เต็ม 5):',
    ...rows.map((row, i) => `${i + 1}. ${row.solution.name}: ${row.score.toFixed(3)}`),
    rows.length > 1 && Math.abs(rows[0].score - rows[1].score) < 1e-9 ? 'มีคะแนนสูงสุดเท่ากัน โปรดใช้ดุลยพินิจประกอบข้อยุติ' : ''
  ].filter(Boolean).join('\n\n');
}

export function generateConclusion(draft, rules) {
  const choice = recommended(draft, rules);
  return [
    `ปัญหา: ${draft.problem.text}`,
    `ผลกระทบสำคัญ:\n${draft.effects.map((effect, i) => `${i + 1}. ${effect.text} — ${effect.affected} (ความรุนแรง: ${effect.severity})`).join('\n')}`,
    `สาเหตุที่แท้จริง: ${draft.root.text}\nเหตุผล: ${draft.root.reason}\nการลดผลกระทบ: ${draft.root.reduction}`,
    `กิจ: ${draft.statement.task}\nมุ่งประสงค์: ${draft.statement.purpose}\nข้อแถลงปัญหา: ${statementText(draft)}`,
    `END STATE:\n${draft.endStates.map((item, i) => `${i + 1}. ${item.text}`).join('\n')}`,
    `วิธีการที่พิจารณาและผล SFA:\n${draft.solutions.map((solution, i) => `${i + 1}. ${solution.name} — S: ${valueText(solution.sfa.S.status)} / F: ${valueText(solution.sfa.F.status)} / A: ${valueText(solution.sfa.A.status)} / ผลรวม: ${valueText(sfaResult(solution))}`).join('\n')}`,
    passedSolutions(draft).length > 1 ? `ผล Superior Solution:\n${comparisonText(draft, rules)}` : passedSolutions(draft).length === 1 ? rules.help.singlePass : rules.help.noPass,
    `วิธีการที่ได้รับการเสนอเป็นข้อยุติ: ${choice?.name || 'ยังไม่ได้เลือก'}\n${choice?.details || ''}`
  ].join('\n\n');
}

export function generateDocument(draft, rules) {
  const draftNotice = reviewIssues(draft, rules).length ? 'ฉบับร่าง — ข้อมูลหรือการพิจารณายังไม่ครบ โปรดตรวจทานก่อนใช้จริง\n\n' : '';
  return draftNotice + [
    'การพิจารณาของฝ่ายอำนวยการ',
    `เรื่อง: ${draft.project.title}\nผู้จัดทำ: ${draft.project.author}\nหน่วย: ${draft.project.unit}\nวันที่: ${draft.project.date}\nหมายเหตุ: ${draft.project.notes || '—'}`,
    `1. สภาวะพึงประสงค์\n${fieldsText(draft.desired, rules.sections.desired.fields)}`,
    `2. สภาวะปัจจุบัน\n${fieldsText(draft.current, rules.sections.current.fields)}`,
    `3. ปัญหา\n${fieldsText(draft.problem, rules.sections.problem.fields)}`,
    `4. ผลกระทบ\n${draft.effects.map((effect, i) => `4.${i + 1}\n${fieldsText(effect, rules.effectFields)}`).join('\n\n')}`,
    `5. สาเหตุของปัญหา\n${draft.causes.map((cause, i) => `5.${i + 1}\n${fieldsText(cause, rules.causeFields)}`).join('\n\n')}\n\nสาเหตุที่แท้จริง\n${fieldsText(draft.root, rules.rootFields)}`,
    `6. ข้อแถลงปัญหา\nกิจ: ${draft.statement.task}\nมุ่งประสงค์: ${draft.statement.purpose}\nEND STATE:\n${draft.endStates.map((item, i) => `${i + 1}. ${item.text}`).join('\n')}\n\nข้อแถลงปัญหา: ${statementText(draft)}`,
    `7. วิธีการแก้ปัญหา\n${draft.solutions.map((solution, i) => `7.${i + 1}\n${fieldsText(solution, rules.solutionFields)}`).join('\n\n')}`,
    `8. การทดสอบวิธีการแก้ปัญหา\n${Object.entries(rules.sfa).map(([key, section], i) => `8.${i + 1} ${section.title}\n${draft.solutions.map(solution => `${solution.name}\n${fieldsText(solution.sfa[key], section.fields)}`).join('\n\n')}`).join('\n\n')}\n\nสรุป SFA:\n${draft.solutions.map(solution => `${solution.name}: S ${valueText(solution.sfa.S.status)} / F ${valueText(solution.sfa.F.status)} / A ${valueText(solution.sfa.A.status)} — ผลรวม ${valueText(sfaResult(solution))}`).join('\n')}`,
    `9. การเปรียบเทียบวิธีการแก้ปัญหา\n${comparisonText(draft, rules)}`,
    `10. ข้อยุติ\n${draft.conclusion ?? generateConclusion(draft, rules)}`
  ].join('\n\n' + '─'.repeat(48) + '\n\n');
}

export function exportFilename(draft, now = new Date()) {
  const title = draft.project.title.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'untitled';
  return `staff-study-${title}-${localDate(now)}.txt`;
}

export function downloadText(draft, rules) {
  const blob = new Blob(['\uFEFF', generateDocument(draft, rules)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename(draft);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
