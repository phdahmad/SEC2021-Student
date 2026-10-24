"""Real-browser check (Chromium via Playwright) against a FAKE-data build made with
the full 600,000 iterations. Verifies sign-in, refusal, isolation, CSP cleanliness,
no horizontal scroll (scrollWidth equals the window width), and saves screenshots
(360 px and 1280 px, light and dark, Arabic and English).

Usage: python tests/browser-check.py <dist> <tokens.csv> <shots-dir>
"""
import csv, json, sys, threading, functools, http.server, os
from playwright.sync_api import sync_playwright

dist, tokens_csv, shots = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(shots, exist_ok=True)
rows = list(csv.DictReader(open(tokens_csv, encoding='utf-8-sig')))
A, B = rows[0], rows[1]

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
Handler = functools.partial(Quiet, directory=dist)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
results = []

def ok(cond, label):
    results.append((bool(cond), label)); print(('PASS ' if cond else 'FAIL ') + label)

def login(page, sid, code):
    page.fill('#sid', sid); page.fill('#code', code); page.click('#loginBtn')
    page.wait_for_selector('#loginBtn:not([disabled])', state='attached', timeout=30000)

with sync_playwright() as p:
    br = p.chromium.launch()
    for lang in ['ar', 'en']:
      for scheme in ['light', 'dark']:
        for w, h, tag0 in [(360, 780, 'mobile'), (1280, 860, 'desktop')]:
            tag = f'{lang}-{tag0}'
            # bypass_csp only so the test harness can measure the page; CSP itself is checked below
            ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2 if w < 500 else 1, bypass_csp=True)
            ctx.add_init_script(f"try {{ localStorage.setItem('sec2021_portal_lang', '{lang}') }} catch (e) {{}}")
            page = ctx.new_page()
            console = []
            page.on('console', lambda m: console.append(m.type + ': ' + m.text))
            page.goto(URL); page.wait_for_load_state('networkidle')
            page.screenshot(path=f'{shots}/{tag}-{scheme}-1-login.png', full_page=True)
            ok(page.evaluate('document.documentElement.dir') == ('rtl' if lang == 'ar' else 'ltr'), f'{tag}/{scheme}: page direction is set on <html>')
            ok(page.evaluate('document.documentElement.scrollWidth === window.innerWidth'), f'{tag}/{scheme}: no horizontal scroll (login)')
            if scheme == 'light' and tag0 == 'mobile':
                login(page, A['id'], 'AAAA-BBBB-CCCC')
                ok(page.is_visible('#loginError'), 'wrong code shows the error')
                page.screenshot(path=f'{shots}/{tag}-{scheme}-2-error.png', full_page=True)
                login(page, B['id'], A['token'])
                ok(page.is_visible('#loginError'), "another student's code is refused")
                txt = page.inner_text('#loginError')
                login(page, '900000999', A['token'])
                ok(page.is_visible('#loginError') and page.inner_text('#loginError') == txt, 'wrong ID gives the same message')
            login(page, A['id'], A['token'].lower())
            ok(page.is_visible('#homeView'), f'{tag}/{scheme}: student signs in (lower-case code accepted)')
            body = page.inner_text('body')
            ok(A['name'] in body and B['name'] not in body and B['id'] not in body, f'{tag}/{scheme}: only own name and ID shown')
            ok(page.evaluate('document.documentElement.scrollWidth === window.innerWidth'), f'{tag}/{scheme}: no horizontal scroll (home)')
            page.screenshot(path=f'{shots}/{tag}-{scheme}-3-home.png', full_page=True)
            page.click('.item-btn:has-text("%s")' % ('الاختبار النصفي' if lang == 'ar' else 'Midterm exam'))
            page.wait_for_selector('.page-thumb img')
            ok('16.5' in page.inner_text('.score-box') or '17' in page.inner_text('.score-box'), f'{tag}/{scheme}: raw and scaled marks shown')
            page.wait_for_timeout(300)
            ok(page.evaluate('document.documentElement.scrollWidth === window.innerWidth'), f'{tag}/{scheme}: no horizontal scroll (item)')
            page.screenshot(path=f'{shots}/{tag}-{scheme}-4-item.png', full_page=True)
            page.click('.page-thumb >> nth=0')
            page.wait_for_timeout(300)
            box = page.locator('#viewerStage').bounding_box()
            w0 = page.evaluate("document.getElementById('viewerImg').offsetWidth")
            page.mouse.dblclick(box['x'] + box['width'] / 2, box['y'] + box['height'] / 3)
            page.wait_for_timeout(300)
            w1 = page.evaluate("document.getElementById('viewerImg').offsetWidth")
            ok(w1 > w0 * 1.5, f'{tag}/{scheme}: double-click zooms ({w0}->{w1}px)')
            page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
            t0 = page.evaluate("document.getElementById('viewerStage').scrollTop")
            page.mouse.wheel(0, 400); page.wait_for_timeout(300)
            t1 = page.evaluate("document.getElementById('viewerStage').scrollTop")
            ok(t1 > t0, f'{tag}/{scheme}: zoomed page scrolls with the wheel ({t0}->{t1})')
            page.click('#viewerZoomOut'); page.click('#viewerZoomOut'); page.click('#viewerZoomOut'); page.wait_for_timeout(200)
            ok(page.evaluate("document.getElementById('viewerImg').offsetWidth") == w0, f'{tag}/{scheme}: zoom-out button returns to fitted width')
            page.click('#viewerZoomIn'); page.wait_for_timeout(200)
            page.screenshot(path=f'{shots}/{tag}-{scheme}-5-viewer.png')
            page.keyboard.press('Escape')
            page.go_back(); page.wait_for_timeout(200)
            ok(page.is_visible('#homeView'), f'{tag}/{scheme}: back button returns to the list')
            page.click('.item-btn:has-text("%s")' % ('نموذج تدريبي' if lang == 'ar' else 'Practice quiz'))
            page.wait_for_timeout(200)
            practice = 'للتدريب، لا تدخل في درجة المقرر' if lang == 'ar' else 'does not count towards your course grade'
            ok(practice in page.inner_text('#itemView'), f'{tag}/{scheme}: practice item says it does not count')
            page.screenshot(path=f'{shots}/{tag}-{scheme}-6-practice.png', full_page=True)
            page.go_back(); page.wait_for_timeout(200)
            page.click('#signOutBtn')
            ok(page.is_visible('#loginView') and A['name'] not in page.inner_text('body'), f'{tag}/{scheme}: sign out clears the page')
            # 404s are expected only from the deliberate wrong-code attempts above
            bad = [c for c in console if ('error' in c.lower() or 'content security' in c.lower()) and '404' not in c]
            ok(not bad, f'{tag}/{scheme}: no console/CSP errors {bad[:2]}')
            ctx.close()
    # Real CSP (no bypass): full sign-in and image display must produce no CSP violations.
    ctx = br.new_context(viewport={'width': 360, 'height': 780})
    page = ctx.new_page(); console = []
    page.on('console', lambda m: console.append(m.type + ': ' + m.text))
    page.goto(URL); login(page, A['id'], A['token'])
    page.click('.item-btn:has-text("الاختبار النصفي")'); page.wait_for_selector('.page-thumb img')
    page.click('.page-thumb >> nth=0'); page.wait_for_timeout(500)
    ok(page.is_visible('#viewerImg'), 'with real CSP: sign-in, item and viewer work')
    bad = [c for c in console if 'error' in c.lower() or 'content security' in c.lower()]
    ok(not bad, f'with real CSP: no violations {bad[:2]}')
    ctx.close()
    br.close()
srv.shutdown()
fails = [l for c, l in results if not c]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
sys.exit(1 if fails else 0)
