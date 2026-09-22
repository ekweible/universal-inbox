// Run with Playwright installed: node web/js/email-frame.test.cjs
const {chromium, webkit}=require('playwright');
const fs=require('fs');
(async()=>{
for(const engine of [chromium,webkit]) {
for(const colorScheme of ['dark', 'light']) {
 const browser=await engine.launch({headless:true});
 const page=await browser.newPage({colorScheme,viewport:{width:390,height:844}});
 const source=fs.readFileSync(require('path').join(__dirname, 'index.js'),'utf8');
 const renderer=source.slice(source.indexOf('// Mount sandboxed'),source.indexOf('// Flyonui collapse'));
 await page.setContent(`<html data-theme="dark"><style>body{color:white;background:#111827}.ui-email-frame{width:100%;border:0;color-scheme:only light}</style><div class="ui-email-frame-host"></div></html>`);
 await page.evaluate(()=>document.querySelector('div').dataset.html=`<style>@media(prefers-color-scheme:dark){.text{color:white!important}}</style><div><table bgcolor="white"><tr><td class="text" style="color:#222">Nested white email</td></tr></table></div><p id="plain">Unstyled text</p><div style="background:#123;color:white" id="brand">Sender colors</div><script>parent.compromised=true<\/script>`);
 await page.addScriptTag({content:renderer});
 await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('#plain'));
 const result=await page.evaluate(()=>{
  const f=document.querySelector('iframe'),d=f.contentDocument,w=f.contentWindow;
  return {dark:w.matchMedia('(prefers-color-scheme:dark)').matches,text:w.getComputedStyle(d.querySelector('.text')).color,plain:w.getComputedStyle(d.querySelector('#plain')).color,brand:w.getComputedStyle(d.querySelector('#brand')).color,compromised:!!window.compromised,sandbox:f.getAttribute('sandbox')};
 });
 if(result.text!=='rgb(34, 34, 34)' || result.plain!=='rgb(15, 23, 42)' || result.brand!=='rgb(255, 255, 255)' || result.compromised)throw Error(JSON.stringify(result));
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
 await page.waitForTimeout(100);
 console.log(engine.name(),colorScheme,result);
 await browser.close();
}
}
})();
