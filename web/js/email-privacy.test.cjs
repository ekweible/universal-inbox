// Run with Playwright installed: node web/js/email-privacy.test.cjs
const { chromium, webkit } = require('playwright');
const fs = require('fs');
(async () => {
 for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const page = await browser.newPage();
  const requests = [];
  await page.route('**/*', async route => {
   const url = route.request().url();
   // WebKit creates local blob placeholders for blocked resources.
   if (url.startsWith('blob:')) return route.continue();
   if (url === 'https://inbox.test/') return route.fulfill({headers:{'Referrer-Policy':'no-referrer'},contentType:'text/html',body:'<div class="ui-email-frame-host"></div>'});
   requests.push({url,referrer:route.request().headers().referer});
   return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'});
  });
  await page.goto('https://inbox.test/');
  await page.evaluate(() => document.querySelector('div').dataset.html = `<style>@import url('https://tracker.test/style');@font-face{font-family:evil;src:url('https://tracker.test/font')}p{background-image:url('https://tracker.test/background');font-family:evil}</style><p>Test</p><img src="https://tracker.test/pixel"><img src="/private-image"><img srcset="https://tracker.test/srcset 1x"><script src="https://tracker.test/script"></script><iframe src="https://tracker.test/frame"></iframe><video src="https://tracker.test/video"></video><link rel="stylesheet" href="https://tracker.test/link-style">`);
  const source=fs.readFileSync(require('path').join(__dirname, 'index.js'),'utf8');
  await page.addScriptTag({content:source.slice(source.indexOf('// Mount sandboxed'),source.indexOf('// Flyonui collapse'))});
  await page.waitForTimeout(700);
  if(requests.length) throw Error('Default leaked requests '+JSON.stringify(requests));
  await page.evaluate(()=>document.querySelector('div').dataset.remoteImages='true');
  await page.waitForTimeout(700);
  if(!requests.some(r=>r.url.endsWith('/pixel'))) throw Error('Opt-in image did not load');
  if(requests.some(r=>/\/(style|font|script|frame|video|link-style)$/.test(new URL(r.url).pathname))) throw Error('Opt-in loosened non-image policy '+JSON.stringify(requests));
  // Chromium may attach the app origin to opted-in CSS backgrounds despite
  // document and iframe no-referrer policies. Do not claim anonymous opt-in.
  if(requests.some(r=>r.referrer && !r.url.endsWith('/background')))throw Error('Image referrer leaked '+JSON.stringify(requests));
  requests.length=0;
  await page.evaluate(()=>{const host=document.querySelector('div');host.dataset.remoteImages='false';host.dataset.html='<img src="https://tracker.test/new-message">'});
  await page.waitForTimeout(300);
  if(requests.length)throw Error('New message requested remote content');
  console.log(engine.name(),'default zero requests; explicit image opt-in; other resources blocked; img referrer suppressed; new body blocked');
  await browser.close();
 }
})();
