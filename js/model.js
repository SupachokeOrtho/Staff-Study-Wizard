export const uid = () => crypto.randomUUID();
export const text = value => typeof value === 'string' ? value.trim() : '';
export const statementText = draft => draft.statement.manual ?? `ให้ ${draft.statement.task} เพื่อ ${draft.statement.purpose}`;
export const passesSFA = solution => ['S', 'F', 'A'].every(key => solution.sfa[key]?.status === 'pass') && solution.sfa.A.riskAccepted === 'yes';
export const passedSolutions = draft => draft.solutions.filter(passesSFA);
export function sfaResult(solution) {
  if (['S', 'F', 'A'].some(key => solution.sfa[key]?.status === 'fail') || solution.sfa.A.riskAccepted === 'no') return 'fail';
  return passesSFA(solution) ? 'pass' : 'pending';
}

export function weightInfo(criteria, rules) {
  const total = criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0);
  const unit = rules.validation.weightTotals.find(target => Math.abs(total - target) <= rules.validation.weightTolerance);
  const valid = !!criteria.length && !!unit && criteria.every(criterion => text(criterion.weight) && Number.isFinite(Number(criterion.weight)) && Number(criterion.weight) > 0);
  return { total, unit: unit || 100, valid };
}

export function ranking(draft, rules) {
  const info = weightInfo(draft.criteria, rules);
  const passed = passedSolutions(draft);
  const complete = info.valid && passed.every(solution => draft.criteria.every(criterion => validScore(criterion.scores[solution.id], rules)));
  if (!complete) return [];
  return passed.map(solution => ({ solution, score: draft.criteria.reduce((sum, criterion) => sum + Number(criterion.scores[solution.id]) * Number(criterion.weight) / info.unit, 0) })).sort((a, b) => b.score - a.score);
}

export function validScore(value, rules) {
  const number = Number(value);
  return text(value) !== '' && Number.isInteger(number) && number >= rules.validation.scoreMin && number <= rules.validation.scoreMax;
}

export function recommended(draft, rules) {
  const passed = passedSolutions(draft);
  return passed.find(solution => solution.id === draft.recommendation) || (passed.length === 1 ? passed[0] : ranking(draft, rules)[0]?.solution);
}

export function newSolution(rules) {
  return { id: uid(), name: '', details: '', resources: '', notes: '', sfa: Object.fromEntries(Object.entries(rules.sfa).map(([key, section]) => [key, Object.fromEntries(section.fields.map(field => [field.key, '']))])) };
}

export function validateStep(index, draft, rules) {
  const errors = [];
  const requireFields = (object, fields, prefix = '') => {
    for (const field of fields) {
      if (field.required && !text(object[field.key])) errors.push(`${prefix}${field.label}: กรุณากรอกข้อมูล`);
      if (text(object[field.key]) && field.options && !field.options.map(option => typeof option === 'string' ? option : option.value).includes(object[field.key])) errors.push(`${prefix}${field.label}: กรุณาเลือกค่าที่กำหนด`);
    }
  };
  const requireList = (key, fields, name, minimum) => {
    if (draft[key].length < minimum) errors.push(`กรุณาเพิ่ม${name}อย่างน้อย ${minimum} รายการ`);
    draft[key].forEach((item, i) => requireFields(item, fields, `${name} ${i + 1} — `));
  };
  if (index < 4) {
    const key = rules.workflow[index].id;
    requireFields(draft[key], rules.sections[key].fields);
  }
  if (index === 4) requireList('effects', rules.effectFields, 'ผลกระทบ', rules.validation.minimumEffects);
  if (index === 5) {
    requireList('causes', rules.causeFields, 'สาเหตุ', rules.validation.minimumCauses);
    requireFields(draft.root, rules.rootFields);
  }
  if (index === 6) {
    requireFields(draft.statement, [{ key: 'task', label: 'กิจ', required: true }, { key: 'purpose', label: 'มุ่งประสงค์', required: true }]);
    requireList('endStates', [{ key: 'text', label: 'END STATE', required: true }], 'END STATE', rules.validation.minimumEndStates);
    if (!text(statementText(draft))) errors.push('กรุณาระบุข้อแถลงปัญหา');
  }
  if (index === 7) requireList('solutions', rules.solutionFields, 'วิธีการ', rules.validation.minimumSolutions);
  if (index === 8) {
    for (const solution of draft.solutions) {
      for (const [key, section] of Object.entries(rules.sfa)) requireFields(solution.sfa[key], section.fields, `${solution.name} / ${key} — `);
      if (solution.sfa.A.status === 'pass' && solution.sfa.A.riskAccepted !== 'yes') errors.push(`${solution.name}: ผล A จะผ่านได้เมื่อความเสี่ยงคงเหลือยอมรับได้เท่านั้น`);
    }
    if (!passedSolutions(draft).length) errors.push(rules.help.noPass);
  }
  if (index === 9 && passedSolutions(draft).length > 1) {
    if (!weightInfo(draft.criteria, rules).valid) errors.push('น้ำหนักทุกเกณฑ์ต้องมากกว่า 0 และรวมเท่ากับ 1.00 หรือ 100% โดยใช้หน่วยเดียวกัน');
    for (const category of rules.criterionCategories) if (!draft.criteria.some(criterion => criterion.category === category.value)) errors.push(`กรุณามีเกณฑ์ ${category.label} อย่างน้อย 1 ข้อ`);
    for (const [i, criterion] of draft.criteria.entries()) {
      requireFields(criterion, [{ key: 'name', label: 'ชื่อเกณฑ์', required: true }, { key: 'definition', label: 'คำนิยาม', required: true }, { key: 'category', label: 'ประเภท', required: true, options: rules.criterionCategories }], `เกณฑ์ ${i + 1} — `);
      for (const solution of passedSolutions(draft)) if (!validScore(criterion.scores[solution.id], rules)) errors.push(`${criterion.name || `เกณฑ์ ${i + 1}`} / ${solution.name}: ให้คะแนนจำนวนเต็ม ${rules.validation.scoreMin}–${rules.validation.scoreMax}`);
    }
  }
  if (index === 10) {
    if (!recommended(draft, rules)) errors.push('ยังไม่มีวิธีที่เสนอเป็นข้อยุติ กรุณาทบทวน SFA และผลเปรียบเทียบ');
    if (draft.conclusion !== null && !text(draft.conclusion)) errors.push('กรุณากรอกข้อยุติ หรือใช้ข้อความสรุปอัตโนมัติ');
  }
  return errors;
}

// Navigation is free; these checks describe document readiness, not access.
export function reviewIssues(draft, rules) {
  return rules.workflow.slice(0, 11).map((step, index) => ({
    step: index,
    title: step.title,
    errors: validateStep(index, draft, rules)
  })).filter(result => result.errors.length);
}
