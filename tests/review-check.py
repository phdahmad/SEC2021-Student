"""Browser check of the teacher pages (fake data only), opened from file:// as the
teacher will open them: the hub (review/index.html) and the review pages.

Checks: the hub lists every batch and opens each; editing a mark changes the total
at once; Save writes <batch>.review.json and a regenerated page restores the edit;
a 10-item quiz works; no console errors; no horizontal scroll; light and dark.

Usage: python tests/review-check.py <data-folder> <shots-dir>
"""
import json, os, subprocess, sys
from playwright.sync_api import sync_playwright

data, shots = os.path.abspath(sys.argv[1]), sys.argv[2]
os.makedirs(shots, exist_ok=True)
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
url = lambda *p: 'file://' + os.path.join(data, *p)
results = []

def ok(cond, label):
    results.append((bool(cond), label)); print(('PASS ' if cond else 'FAIL ') + label)

def no_hscroll(page):
    return page.evaluate('document.documentElement.scrollWidth === window.innerWidth')

with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ['light', 'dark']:
        for w, h in [(1280, 860), (1440, 900)]:
            ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, accept_downloads=True)
            # Use the download fallback for saving (the native save dialog cannot be driven headless).
            ctx.add_init_script('delete window.showSaveFilePicker;')
            page = ctx.new_page(); console = []
            page.on('console', lambda m: console.append(m.type + ': ' + m.text))
            page.on('pageerror', lambda e: console.append('error: ' + str(e)))
            tag = f'{scheme}-{w}'

            # ---- hub ----
            page.goto(url('review', 'index.html'))
            cards = page.locator('.grid > li')
            ok(cards.count() == 2, f'{tag}: hub lists both batches ({cards.count()})')
            ok(no_hscroll(page), f'{tag}: hub has no horizontal scroll')
            ok('رُوجع' in page.inner_text('main'), f'{tag}: hub shows reviewed counts')
            page.screenshot(path=f'{shots}/hub-{tag}.png', full_page=True)
            for i in range(cards.count()):
                page.goto(url('review', 'index.html'))
                href = page.locator('.grid > li a.card').nth(i).get_attribute('href')
                page.locator('.grid > li a.card').nth(i).click()
                page.wait_for_selector('#students li')
                ok(page.url.split('#')[0].endswith(href.replace('../', '')), f'{tag}: hub card {i + 1} opens {href}')

            # ---- midterm review page ----
            page.goto(url('batches', 'MID', 'review.html'))
            page.wait_for_selector('#tot')
            ok(no_hscroll(page), f'{tag}: midterm review page has no horizontal scroll')
            ok(page.locator('#students li').count() == 8, f'{tag}: midterm lists 8 sheets')
            page.wait_for_timeout(300)
            page.screenshot(path=f'{shots}/review-mid-{tag}.png')
            if scheme == 'light' and w == 1280:
                page.locator('#students li button').nth(1).click(); page.wait_for_timeout(200)
                before = page.inner_text('#tot')
                inp = page.locator('.part input').first
                inp.fill('0'); inp.dispatch_event('input'); page.wait_for_timeout(100)
                after = page.inner_text('#tot')
                ok(before != after, f'editing a mark changes the total at once ({before} -> {after})')
                ok('معدَّل' in page.inner_text('#students'), 'the student is tagged as edited')
                page.locator('.seg').nth(17).locator('button[aria-pressed="false"]').first.click(); page.wait_for_timeout(100)
                ok(page.inner_text('#tot') != after, 'half-mark buttons on true/false change the total')
                page.screenshot(path=f'{shots}/review-mid-edited.png')
                page.evaluate("document.querySelector('#preview').scrollIntoView()"); page.wait_for_timeout(200)
                page.screenshot(path=f'{shots}/review-mid-preview.png')
                sid = page.evaluate('location.hash.slice(1)')
                total_edited = page.inner_text('#tot')
                with page.expect_download() as dl:
                    page.click('#saveBtn')
                target = os.path.join(data, 'batches', 'MID', 'MID.review.json')
                dl.value.save_as(target)
                saved = json.load(open(target, encoding='utf-8'))
                ok(saved['batch'] == 'MID' and sid in saved['students'], 'Save writes MID.review.json with the edits')
                r = subprocess.run(['node', 'tools/review-page.mjs', '--batch', 'MID', '--data', data], cwd=REPO, capture_output=True, text=True)
                ok(r.returncode == 0, 'review page regenerates with the saved review')
                ctx2 = br.new_context(viewport={'width': w, 'height': h})
                p2 = ctx2.new_page(); p2.goto(url('batches', 'MID', 'review.html') + '#' + sid); p2.wait_for_selector('#tot')
                ok(p2.inner_text('#tot') == total_edited, f'reopening restores the edits ({p2.inner_text("#tot")})')
                ctx2.close()

            # ---- quiz review page (10 multiple-choice items only) ----
            page.goto(url('batches', 'Q1', 'review.html'))
            page.wait_for_selector('#tot')
            ok(page.locator('table.obj tbody tr').count() == 10, f'{tag}: quiz shows 10 items')
            ok(page.locator('.part input').count() == 0, f'{tag}: quiz has no written parts')
            ok(no_hscroll(page), f'{tag}: quiz review page has no horizontal scroll')
            page.screenshot(path=f'{shots}/review-q1-{tag}.png')
            bad = [c for c in console if c.startswith('error')]
            ok(not bad, f'{tag}: no console errors {bad[:2]}')
            ctx.close()
    br.close()
fails = [l for c, l in results if not c]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
