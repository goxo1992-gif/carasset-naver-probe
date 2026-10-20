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
if(process.env.NV_LOGIN_TEST==='1' && process.env.NV_RELAY_TOKEN){
  const {spawn}=require('node:child_process');
  status={stage:'LOGIN_TEST_RUNNING',credentials_used:true,publishing_enabled:false};
  const child=spawn(process.execPath,['/app/login.cjs'],{stdio:['ignore','pipe','ignore']});
  const timer=setTimeout(()=>child.kill('SIGTERM'),260000);
  let output='';
  child.stdout.on('data',data=>{
    if(output.length<16384)output+=data.toString('utf8');
    for(const line of output.split('\n')){
      try{
        const result=JSON.parse(line);
        if(typeof result.ok==='boolean'&&typeof result.code==='string'&&/^[A-Z_]{1,50}$/.test(result.code)){
          status={stage:result.ok?'LOGIN_REUSE_PASSED':'LOGIN_TEST_STOPPED',code:result.code,credentials_used:true,publishing_enabled:false};
          // Fixed diagnostic vocabulary only; never forward raw errors or page data.
          const d=result.diagnostic;
          if(d){
            if(['START','BROWSER_START','LOGIN_FORM','BOOTSTRAP_TAKE','LOGIN_SUBMITTED','VERIFIED_CHANNEL'].includes(d.phase))status.phase=d.phase;
            if(['UNOBSERVED','OTHER_SITE','nid.naver.com','clipcreators.naver.com','clip.naver.com'].includes(d.post_submit_site))status.site=d.post_submit_site;
            if(typeof d.password_field_visible==='boolean')status.login_form_still_visible=d.password_field_visible;
            if(Array.isArray(d.login_response_statuses))status.login_response_statuses=d.login_response_statuses.filter(s=>Number.isInteger(s)&&s>=100&&s<=599).slice(0,10);
            if(Number.isInteger(d.failure_count))status.login_request_failure_count=Math.min(100,d.failure_count);
            const allowed=['www.naver.com','auth.naver.com','apis.naver.com','api-gw.clip.naver.com','ntm.pstatic.net','wtm.pstatic.net','nam.veta.naver.com'];
            if(Array.isArray(d.blocked_hosts))status.blocked_public_hosts=d.blocked_hosts.filter(h=>allowed.includes(h));
          }
        }
      }catch{}
    }
  });
  child.on('exit',()=>{clearTimeout(timer);output='';if(status.stage==='LOGIN_TEST_RUNNING')status={stage:'LOGIN_TEST_STOPPED',code:'RUNNER_STOPPED',publishing_enabled:false};console.log(JSON.stringify(status));});
}else probe();
