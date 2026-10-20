'use strict';
// Public, credential-free diagnostic only. Runs once per process boot.
const http = require('node:http');
let status = {stage:'STARTING', credentials_used:false, publishing_enabled:false};
http.createServer((req,res)=>{
  if(req.method!=='GET'|| !['/','/healthz'].includes(req.url)) {
    res.writeHead(404);res.end();return;
  }
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(status));
}).listen(Number(process.env.PORT)||10000,'0.0.0.0');
async function probe(){
  let browser;
  const start=Date.now();
  try{
    const {chromium}=require('playwright');
    status={...status,stage:'BROWSER_STARTING'};
    browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
    const context=await browser.newContext();
    const hosts=new Set(['clipcreators.naver.com','clip.naver.com','nid.naver.com','ssl.pstatic.net','static-clipcreators.pstatic.net','ncpt.naver.com']);
    await context.route('**/*',route=>{
      try {const u=new URL(route.request().url());return u.protocol==='https:'&&hosts.has(u.hostname)?route.continue():route.abort();}
      catch{return route.abort();}
    });
    const page=await context.newPage();
    status={...status,stage:'NAVER_PAGE_LOADING'};
    await page.goto('https://clipcreators.naver.com/web/contents/clips',{waitUntil:'domcontentloaded',timeout:60000});
    await page.locator('input[type="password"]').waitFor({state:'visible',timeout:30000}).catch(()=>{});
    const site=new URL(page.url()).hostname;
    status={...status,stage:'COMPLETE',browser_started:true,site:hosts.has(site)?site:'OTHER_SITE',login_form_visible:await page.locator('input[type="password"]:visible').count()===1,duration_seconds:Math.round((Date.now()-start)/1000)};
  }catch{
    status={...status,stage:'FAILED',failure_stage:status.stage,duration_seconds:Math.round((Date.now()-start)/1000)};
  }finally{if(browser)await browser.close();console.log(JSON.stringify(status));}
}
probe();
