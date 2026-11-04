"""Browser integration checks; run the static server first. See README.md."""
import os
import re
import shutil
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8000')
OUTPUT = Path(__file__).resolve().parents[1] / 'test-results'
KEY = 'staff-study-wizard:v1'


class WizardBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        cls.browser = cls.playwright.chromium.launch(
            executable_path=executable, headless=True, args=['--no-sandbox'])
        OUTPUT.mkdir(exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        self.page = self.context.new_page()
        self.errors = []
        self.requests = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('request', lambda request: self.requests.append(request.url))
        self.page.goto(BASE_URL)
        expect(self.page.locator('#step-title')).to_have_text('ข้อมูลโครงการ')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'No uncaught application errors')

    def field(self, path):
        return self.page.locator(f'[data-path="{path}"]')

    def step(self, number):
        expect(self.page.locator('#step-counter')).to_have_text(f'ขั้นที่ {number} / 12')
        step_ids = ['project', 'desired', 'current', 'problem', 'effects', 'causes', 'statement', 'solutions', 'sfa', 'superior', 'conclusion', 'preview']
        expect(self.page.locator('#step-guide')).to_have_attribute('data-step', step_ids[number - 1])
        if getattr(self, 'expect_missing_guide', False):
            expect(self.page.locator('.guide-unavailable')).to_be_visible()
        else:
            expect(self.page.locator('#step-guide > details > summary')).to_contain_text('เปิดสรุปเอกสาร')

    def next(self, number):
        self.page.locator('#next').click()
        self.step(number)

    def fill_form(self, text='ข้อมูลภาษาไทยสำหรับทดสอบ'):
        controls = self.page.locator('#wizard-form input, #wizard-form textarea, #wizard-form select')
        for control in controls.all():
            tag = control.evaluate('(element) => element.tagName')
            if tag == 'SELECT':
                control.select_option(index=1)
            elif control.get_attribute('type') == 'date':
                control.fill('2026-11-04')
            elif control.get_attribute('type') == 'number':
                control.fill('3')
            else:
                control.fill(text)

    def fill_analysis(self, solution_count=2):
        self.fill_form()
        self.field('project.title').fill('การลดระยะเวลารายงาน')
        self.next(2)
        self.fill_form('สภาวะพึงประสงค์ตามนโยบาย: ส่งรายงานภายใน 2 วัน')
        self.next(3)
        self.fill_form('สภาวะปัจจุบันใช้เวลา 5 วัน จากข้อมูล 30 ครั้ง')
        self.next(4)
        self.fill_form('ระยะเวลาจัดทำรายงานเกินเป้าหมาย 3 วัน')
        self.next(5)
        self.page.locator('[data-add="effects"]').click()
        self.fill_form('รายงานล่าช้าส่งผลต่อการตัดสินใจ หลักฐานทะเบียนรับส่ง')
        self.next(6)
        self.page.locator('[data-add="causes"]').click()
        self.fill_form('ขั้นตอนตรวจสอบซ้ำซ้อน จากการสังเกตการทำงาน')
        self.next(7)
        self.field('statement.task').fill('ปรับปรุงขั้นตอนจัดทำรายงาน')
        self.field('statement.purpose').fill('ส่งรายงานภายใน 2 วัน')
        self.page.locator('[data-add="endStates"]').click()
        self.field('endStates.0.text').fill('รายงานร้อยละ 95 เสร็จภายใน 2 วัน')
        expect(self.page.locator('#statement-preview')).to_contain_text('ให้ ปรับปรุงขั้นตอน')
        self.field('statement.manual').fill('ให้ปรับปรุงขั้นตอน เพื่อส่งรายงานภายใน 2 วัน')
        self.next(8)
        for i in range(solution_count):
            self.page.locator('[data-add="solutions"]').click()
            self.field(f'solutions.{i}.name').fill(['ปรับกระบวนงาน', 'ใช้ระบบรายงาน'][i])
            self.field(f'solutions.{i}.details').fill('รายละเอียดทางเลือกที่แตกต่างกัน')
            self.field(f'solutions.{i}.resources').fill('เจ้าหน้าที่ 2 นาย งบประมาณตามแผน')
        self.next(9)
        self.fill_form('หลักฐานและเหตุผลประกอบการประเมิน')

    def test_full_flow_refresh_sfa_comparison_offline_and_export(self):
        self.assertTrue(self.page.locator('[data-step="7"]').is_disabled())
        self.page.locator('#next').click()
        self.step(1)
        expect(self.page.locator('#errors')).to_be_visible()
        self.fill_analysis()

        # All candidates evaluated, but none passing: no forward progression.
        for i in range(2):
            self.field(f'solutions.{i}.sfa.S.status').select_option('fail')
        self.page.locator('#next').click()
        self.step(9)
        expect(self.page.locator('#errors')).to_contain_text('ยังไม่มีวิธีผ่าน SFA')

        # Exactly one pass skips comparison in both navigation directions.
        self.field('solutions.0.sfa.S.status').select_option('pass')
        self.next(11)
        self.assertTrue(self.page.locator('[data-step="9"]').is_disabled())
        self.page.locator('#previous').click()
        self.step(9)
        self.field('solutions.1.sfa.S.status').select_option('pass')
        self.next(10)

        for index, category in enumerate(['effectiveness', 'efficiency']):
            self.page.locator('[data-add="criteria"]').click()
            self.field(f'criteria.{index}.name').fill(['ความสำเร็จตามเป้าหมาย', 'ความประหยัด'][index])
            self.field(f'criteria.{index}.category').select_option(category)
            self.field(f'criteria.{index}.definition').fill('คะแนนสูงหมายถึงผลที่ดีกว่า')
            self.field(f'criteria.{index}.weight').fill(['60', '30'][index])
        scores = self.page.locator('[data-path*=".scores."]')
        for control, value in zip(scores.all(), ['5', '2', '1', '5']):
            control.fill(value)
        self.page.locator('#next').click()
        self.step(10)
        expect(self.page.locator('#errors')).to_contain_text('น้ำหนัก')
        self.field('criteria.1.weight').fill('40')
        expect(self.page.locator('#score-output')).to_contain_text('3.400')
        expect(self.page.locator('#score-output .winner')).to_contain_text('ปรับกระบวนงาน')
        self.page.reload()
        self.step(10)
        expect(self.field('criteria.0.weight')).to_have_value('60')
        expect(self.page.locator('#score-output')).to_contain_text('3.400')
        self.assertTrue(all(url.startswith(BASE_URL) for url in self.requests))

        # All workflow resources are in memory. Editing/export require no network.
        self.context.set_offline(True)
        self.next(11)
        self.page.locator('[data-guide-toggle="conclusion:main"] > summary').click()
        self.page.locator('[data-guide-toggle="conclusion:principle-0"] > summary').click()
        expect(self.page.locator('#step-guide')).to_contain_text('โดยไม่เพิ่มการแถลง')
        self.page.locator('[data-guide-toggle="conclusion:main"] > summary').click()
        self.assertIn('สาเหตุที่แท้จริง', self.field('conclusion').input_value())
        self.field('conclusion').fill('ข้อยุติภาษาไทยที่แก้ไขเอง เสนอให้ปรับกระบวนงาน')
        self.next(12)
        expect(self.page.locator('#preview')).to_contain_text('ข้อยุติภาษาไทยที่แก้ไขเอง')
        self.page.locator('[data-guide-toggle="preview:main"] > summary').click()
        self.page.locator('[data-guide-toggle="preview:writing"] > summary').click()
        expect(self.page.locator('#step-guide .guide-example-note')).to_be_visible()
        self.assertTrue(self.page.locator('#next').is_hidden())
        with self.page.expect_download() as download_info:
            self.page.locator('[data-action="download"]').click()
        download = download_info.value
        self.assertRegex(download.suggested_filename, r'^staff-study-การลดระยะเวลารายงาน-\d{4}-\d{2}-\d{2}\.txt$')
        download.save_as(OUTPUT / download.suggested_filename)
        raw = Path(download.path()).read_bytes()
        self.assertTrue(raw.startswith(b'\xef\xbb\xbf'))
        document = raw.decode('utf-8-sig')
        for fragment in ['การพิจารณาของฝ่ายอำนวยการ', 'Residual Risk', '3.400', 'ข้อยุติภาษาไทยที่แก้ไขเอง', 'ให้ปรับปรุงขั้นตอน เพื่อส่งรายงานภายใน 2 วัน']:
            self.assertIn(fragment, document)
        self.assertNotIn('\ufffd', document)
        self.assertNotIn('ตัวอย่างสมมติ', document)
        self.assertNotIn('สรุปตัวอย่างจากเอกสาร', document)
        self.page.screenshot(path=str(OUTPUT / 'desktop-preview.png'), full_page=True)
        self.page.locator('[data-action="copy"]').click()
        expect(self.page.locator('#export-status')).to_have_text(re.compile('คัดลอก|Ctrl'))
        self.page.evaluate('window.__printed = false; window.print = () => { window.__printed = true; }')
        self.page.locator('[data-action="print"]').click()
        self.assertTrue(self.page.evaluate('window.__printed'))
        self.page.emulate_media(media='print')
        self.assertTrue(self.page.locator('.sidebar').is_hidden())
        self.assertTrue(self.page.locator('#step-guide').is_hidden())
        self.assertTrue(self.page.locator('#preview').is_visible())
        self.page.emulate_media(media='screen')
        self.page.locator('[data-action="edit"]').click()
        self.step(11)
        self.assertEqual(self.field('conclusion').input_value(), 'ข้อยุติภาษาไทยที่แก้ไขเอง เสนอให้ปรับกระบวนงาน')
        self.context.set_offline(False)
        self.page.reload()
        self.step(11)
        self.assertEqual(self.field('conclusion').input_value(), 'ข้อยุติภาษาไทยที่แก้ไขเอง เสนอให้ปรับกระบวนงาน')
        # Clearing earlier analysis must invalidate forward navigation.
        self.page.locator('[data-step="5"]').click()
        self.field('root.text').fill('')
        self.page.locator('[data-step="11"]').click()
        self.step(6)
        expect(self.page.locator('#errors')).to_contain_text('สาเหตุที่แท้จริง')

    def test_mobile_delete_confirmation_and_clear(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.field('project.title').fill('<img src=x onerror=alert(1)> ชื่อเรื่อง')
        self.assertEqual(self.page.locator('#project-name img').count(), 0)
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
        self.page.screenshot(path=str(OUTPUT / 'mobile-project.png'), full_page=True)
        self.page.once('dialog', lambda dialog: dialog.dismiss())
        self.page.locator('#clear-data').click()
        expect(self.field('project.title')).to_have_value('<img src=x onerror=alert(1)> ชื่อเรื่อง')
        self.page.once('dialog', lambda dialog: dialog.accept())
        self.page.locator('#new-project').click()
        expect(self.field('project.title')).to_have_value('')
        self.fill_analysis(solution_count=1)
        self.page.locator('#previous').click()
        self.step(8)
        self.page.once('dialog', lambda dialog: dialog.accept())
        self.page.locator('[data-delete="solutions"]').click()
        self.page.locator('#next').click()
        self.step(8)
        expect(self.page.locator('#errors')).to_contain_text('อย่างน้อย 1')
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))

    def test_unreadable_storage_is_not_silently_overwritten(self):
        self.page.evaluate('(key) => localStorage.setItem(key, "{corrupt")', KEY)
        self.page.reload()
        expect(self.page.locator('#errors')).to_contain_text('ไม่สามารถอ่านข้อมูลเดิมได้')
        self.field('project.title').fill('งานชั่วคราว')
        self.assertEqual(self.page.evaluate('(key) => localStorage.getItem(key)', KEY), '{corrupt')
        expect(self.page.locator('#save-status')).to_contain_text('ยังไม่ได้บันทึก')

    def test_second_tab_cannot_silently_overwrite_work(self):
        self.field('project.title').fill('งานในแท็บแรก')
        second = self.context.new_page()
        second.goto(BASE_URL)
        expect(second.locator('[data-path="project.title"]')).to_have_value('งานในแท็บแรก')
        second.locator('[data-path="project.title"]').fill('งานแก้ไขจากแท็บที่สอง')
        expect(self.page.locator('#errors')).to_contain_text('แท็บอื่น')
        self.field('project.title').fill('การแก้ไขที่ต้องส่งออกก่อน')
        stored = self.page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).project.title', KEY)
        self.assertEqual(stored, 'งานแก้ไขจากแท็บที่สอง')

    def test_guide_opens_without_editing_draft_and_pdf_sources_resolve(self):
        self.field('project.title').fill('ข้อมูลที่ต้องคงเดิม')
        original = self.page.evaluate('(key) => localStorage.getItem(key)', KEY)
        main = self.page.locator('[data-guide-toggle="project:main"]')
        main.locator(':scope > summary').focus()
        self.page.keyboard.press('Enter')
        expect(main).to_have_attribute('open', '')
        self.page.locator('[data-guide-toggle="project:principle-0"] > summary').click()
        expect(self.page.locator('#step-guide .guide-citations').first).to_be_visible()
        first_link = self.page.locator('#step-guide .guide-citations a').first
        expect(first_link).to_have_attribute('href', 'references/staff-study-lecture-1.pdf#page=24')
        expect(first_link).to_have_attribute('target', '_blank')
        self.page.locator('[data-guide-toggle="project:writing"] > summary').click()
        expect(self.page.locator('.guide-fields dt').first).to_have_text('ชื่อเรื่อง / Project title')
        expect(self.page.locator('.guide-example-note')).to_contain_text('ไม่ใช่ข้อมูลจริงจากสไลด์')
        self.page.screenshot(path=str(OUTPUT / 'desktop-writing-guide.png'))
        self.page.locator('[data-guide-toggle="project:source-examples"] > summary').click()
        expect(self.page.locator('.guide-source-example')).to_contain_text('อส. ๕๒')
        self.page.locator('[data-guide-toggle="project:library"] > summary').click()
        self.assertEqual(self.page.locator('.guide-document-list article').count(), 3)
        self.assertEqual(self.page.evaluate('(key) => localStorage.getItem(key)', KEY), original)
        self.assertFalse(any(url.endswith('.pdf') for url in self.requests), 'PDFs must not be prefetched')
        for link in self.page.locator('.guide-document-actions a[download]').all():
            response = self.context.request.get(BASE_URL + '/' + link.get_attribute('href'))
            self.assertEqual(response.status, 200)
            self.assertIn('application/pdf', response.headers.get('content-type', ''))
            self.assertTrue(response.body().startswith(b'%PDF-'))
            response.dispose()

        # Help remains available in memory and keeps its open state across steps.
        self.context.set_offline(True)
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
        self.page.screenshot(path=str(OUTPUT / 'mobile-writing-guide.png'), full_page=True)
        self.fill_form('ข้อมูลสมมติจากผู้ทดสอบ')
        self.next(2)
        self.page.locator('#previous').click()
        self.step(1)
        expect(self.page.locator('[data-guide-toggle="project:main"]')).to_have_attribute('open', '')
        expect(self.page.locator('[data-guide-toggle="project:writing"]')).to_have_attribute('open', '')

    def test_missing_guide_does_not_block_autosave(self):
        self.expect_missing_guide = True
        self.page.route('**/data/staff-study-guide.json', lambda route: route.fulfill(status=404, body='missing'))
        self.page.reload()
        expect(self.page.locator('.guide-unavailable')).to_contain_text('สามารถกรอกงานต่อได้')
        self.fill_form('ข้อมูลทดสอบเมื่อไม่มีคู่มือ')
        self.next(2)
        expect(self.page.locator('#save-status')).to_contain_text('บันทึกอัตโนมัติแล้ว')
        self.page.reload()
        self.step(2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
