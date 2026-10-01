// Opens the live site's main pages in a real browser, as a reader on a phone
// would, and fails if any of them breaks: a page that does not answer 200, a
// script error, an error in the console, or a request of the site's own that
// fails (a 404 like /_/auth/me's, which the server-side tests could not see).
// Run by .github/workflows/smoke.yml after each deploy:
//   SITE=https://rebbehub.org node scripts/smoke.cjs
// CommonJS, so it finds Playwright on NODE_PATH without being a dependency.
const { chromium, devices } = require('playwright');

const SITE = (process.env.SITE ?? 'https://rebbehub.org').replace(/\/$/, '');
const API = (process.env.API ?? 'https://api.rebbehub.org').replace(/\/$/, '');

/** The pages a reader meets first, and one of each kind under them. */
const PAGES = ['/', '/likkutei-sichos', '/likkutei-sichos?part=30', '/likkutei-sichos/30/1/1/3', '/search?q=%D7%97%D7%A0%D7%95%D7%9B%D7%94', '/daily', '/calendar', '/sets', '/suggestions', '/signin', '/status'];

async function main() {
  const browser = await chromium.launch();
  const failures = [];
  for (const path of PAGES) {
    const started = Date.now();
    // Once more when it broke: one slow answer on the way is not a broken page.
    let problems = await visit(browser, path);
    if (problems.length) problems = await visit(browser, path);
    console.log(`${problems.length ? '✗' : '✓'} ${path} (${Date.now() - started} ms)`);
    for (const problem of problems) console.log(`    ${problem}`);
    if (problems.length) failures.push(path);
  }
  await browser.close();
  if (failures.length) {
    console.log(`\n${failures.length} of ${PAGES.length} pages broke: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nAll ${PAGES.length} pages are well.`);
}

/** What went wrong opening one page, as a reader would. */
async function visit(browser, path) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`script error: ${error.message.slice(0, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/^Failed to load resource/.test(message.text())) problems.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    if ((url.startsWith(SITE) || url.startsWith(API)) && response.status() >= 400) problems.push(`${response.status()} ${url}`);
  });
  const answer = await page.goto(`${SITE}${path}`, { waitUntil: 'load', timeout: 45_000 }).catch((error) => {
    problems.push(`did not load: ${error.message.split('\n')[0]}`);
    return null;
  });
  if (answer && answer.status() !== 200) problems.push(`answered ${answer.status()}`);
  // What the page asks once it runs (the account, the player) has its moment to fail.
  await page.waitForTimeout(2_500);
  if (path === '/signin') {
    const me = await fetch(`${API}/v1/auth/me`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0 RebbeHub-smoke' } }).then((r) => r.json()).catch(() => null);
    if (me?.google && (await page.locator('a[href*="/_/auth/google/start"]').count()) === 0) problems.push('Google sign-in is on, but /signin does not offer it');
  }
  await context.close();
  return problems;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
