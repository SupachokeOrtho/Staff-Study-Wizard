import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadGuide, renderGuide } from '../js/guide.js';

const readJSON = file => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url)));
const guide = readJSON('staff-study-guide.json');
const rules = readJSON('staff-study-rules.json');

test('every workflow step has substantial writing guidance, examples, and traceable references', () => {
  assert.deepEqual(guide.steps.map(step => step.id), rules.workflow.map(step => step.id));
  const sourcesUsed = new Set();
  for (const step of guide.steps) {
    assert.ok(step.title && step.overview, step.id);
    assert.ok(step.principles.length >= 2, step.id);
    assert.ok(step.writing.length >= 3, step.id);
    assert.ok(step.sourceExamples.length >= 1, step.id);
    assert.ok(step.cautions.length >= 2 && step.checklist.length >= 3, step.id);
    for (const field of step.writing) assert.ok(field.label && field.instruction && field.example);
    for (const section of [...step.principles, ...step.sourceExamples]) {
      assert.ok(section.refs.length, `${step.id}: missing reference`);
      for (const reference of section.refs) {
        const source = guide.documents.find(document => document.id === reference.document);
        assert.ok(source, reference.document);
        assert.ok(reference.pages.length);
        for (const page of reference.pages) assert.ok(Number.isInteger(page) && page > 0 && page <= source.pages, `${step.id}: out-of-bounds citation`);
        sourcesUsed.add(source.id);
      }
    }
    const html = renderGuide(step.id, guide);
    assert.ok(html.includes('ตัวอย่างสมมติ'));
    assert.ok(html.includes('#page='));
    assert.ok(!html.includes('<input') && !html.includes('<textarea') && !html.includes('data-path='), 'Guidance cannot be mistaken for study fields');
  }
  assert.equal(sourcesUsed.size, 3);
});

test('bundled PDFs match the fingerprints recorded from the uploaded originals', () => {
  assert.equal(guide.documents.length, 3);
  assert.deepEqual(guide.documents.map(source => source.pages), [4, 153, 210]);
  for (const source of guide.documents) {
    assert.match(source.file, /^references\/[a-z0-9-]+\.pdf$/);
    const bytes = readFileSync(new URL(`../${source.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  }
});

test('guide renderer escapes content, only links local PDFs, and preserves opened sections', () => {
  const modified = structuredClone(guide);
  modified.steps[0].overview = '<img src=x onerror=alert(1)>';
  modified.documents[0].file = 'https://example.com/tracker.pdf';
  const opened = new Set(['project:main', 'project:writing']);
  const html = renderGuide('project', modified, opened);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('example.com'));
  assert.match(html, /data-guide-toggle="project:main" open/);
  assert.match(html, /data-guide-toggle="project:writing" open/);
  assert.equal(opened.size, 2);
});

test('missing guidance remains optional while HTTP, JSON, and schema errors are handled', async () => {
  assert.equal(await loadGuide(async () => { throw new Error('offline'); }), null);
  assert.equal(await loadGuide(async () => ({ ok: false })), null);
  assert.equal(await loadGuide(async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } })), null);
  assert.equal(await loadGuide(async () => ({ ok: true, json: async () => ({ version: 9 }) })), null);
  const incomplete = structuredClone(guide);
  delete incomplete.steps[0].writing;
  assert.equal(await loadGuide(async () => ({ ok: true, json: async () => incomplete })), null);
  assert.equal(await loadGuide(async () => ({ ok: true, json: async () => guide })), guide);
  assert.match(renderGuide('project', null), /สามารถกรอกงานต่อได้/);
  assert.match(renderGuide('missing-step', guide), /สามารถกรอกงานต่อได้/);
});
