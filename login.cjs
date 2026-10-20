'use strict';
// Fixed login/reuse test only. No upload, publication, arbitrary arguments,
// downloads, screenshots, tracing, cookie files or secret-bearing logging.
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const {chromium} = require('playwright');
const RELAY = 'https://script.google.com/macros/s/AKfycbyNnarZTyhzdoqG3Z66GS8yKsBoTFSKdZrYh9aCESyOFEkhpt5bS2aE9UiMj8C9PvFhsQ/exec';
const TARGET = 'https://clip.naver.com/@car_asset';
const CONTENTS = 'https://clipcreators.naver.com/web/contents/clips';
const HOSTS = new Set(['clipcreators.naver.com','clip.naver.com','nid.naver.com','ssl.pstatic.net','static-clipcreators.pstatic.net','ncpt.naver.com']);
const ACTIONS = new Set(['naver_health','naver_bootstrap_take','naver_session_save','naver_session_load']);
// Fixed, non-secret diagnostic labels only. Never log a dynamic URL or text.
const diagnostic={phase:'START',post_submit_site:'UNOBSERVED',password_field_visible:null,blocked_hosts:[],login_response_statuses:[],failure_count:0};
const publicBlockedHosts=new Set(['www.naver.com','auth.naver.com','apis.naver.com','api-gw.clip.naver.com','ntm.pstatic.net','wtm.pstatic.net','nam.veta.naver.com']);
async function call(action,fields={}) {
 if(!ACTIONS.has(action))throw Error('ACTION_DENIED');
 const token=process.env.NV_RELAY_TOKEN;
 if(!token||token.length<32)throw Error('UNAUTHORIZED');
 let response;
 try { response=await fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields,relay_token:token}),signal:AbortSignal.timeout(60000)}); }
 catch {throw Error('NETWORK_OR_JSON');}
 let result;
 try {result=await response.json();}catch{throw Error('RELAY_RESPONSE_INVALID');}
 if(result?.ok!==true)throw Error(['LOGIN_REQUIRED','UNAUTHORIZED','INVALID','TOO_LARGE'].includes(result?.code)?result.code:'RELAY_FAILED');
 return result;
}
async function context(browser, state) {
  const ctx=await browser.newContext(state?{storageState:state}:{});
  await ctx.route('**/*',route=>{
    try {
      const u=new URL(route.request().url());
      if(u.protocol==='https:'&&HOSTS.has(u.hostname))return route.continue();
      if(publicBlockedHosts.has(u.hostname)&&!diagnostic.blocked_hosts.includes(u.hostname))diagnostic.blocked_hosts.push(u.hostname);
      return route.abort();
    }
    catch {return route.abort();}
  });
  return ctx;
}
async function verifyChannel(page) {
  await page.goto(CONTENTS,{waitUntil:'domcontentloaded',timeout:45000});
  const link=page.getByRole('link',{name:'내 클립 바로가기',exact:true});
  try {await link.waitFor({state:'visible',timeout:15000});} catch {return false;}
  const href=await link.getAttribute('href');
  if (!href || new URL(href,CONTENTS).href.replace(/\/$/,'') !== TARGET) throw Error('WRONG_CHANNEL');
  return true;
}
async function login(page) {
  diagnostic.phase='LOGIN_FORM';
  page.on('response',response=>{
    try {if(new URL(response.url()).hostname==='nid.naver.com' && response.request().method()==='POST') {
      const s=response.status();if(!diagnostic.login_response_statuses.includes(s))diagnostic.login_response_statuses.push(s);
    }}catch{}
  });
  page.on('requestfailed',request=>{
    try {if(new URL(request.url()).hostname==='nid.naver.com')diagnostic.failure_count++;}catch{}
  });
  // Observe only field metadata while blank; never inspect filled page content.
  if (new URL(page.url()).hostname !== 'nid.naver.com') throw Error('LOGIN_PAGE_MISSING');
  const pw=page.locator('input[type="password"]:visible');
  if (await pw.count() !== 1) throw Error('LOGIN_FORM_UNSUPPORTED');
  const fields=await page.locator('input:visible').evaluateAll(es=>es.filter(e=>['text','email'].includes(e.type)).map(e=>({id:e.id,type:e.type,autocomplete:e.autocomplete})));
  const chosen=fields.find(e=>e.autocomplete==='username') || (fields.length===1?fields[0]:null);
  if (!chosen || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(chosen.id)) throw Error('LOGIN_FORM_UNSUPPORTED');
  const button=page.getByRole('button',{name:/^(로그인|Sign in)$/i});
  if (await button.count() !== 1) throw Error('LOGIN_FORM_UNSUPPORTED');
  const stay=page.locator('input#loginStay');
  if(await stay.count()===1&&!await stay.isChecked()) {
    // NAVER renders the input at 1x1 px beneath its visible associated label.
    // isVisible() alone does not mean the input can receive a pointer click.
    const label=page.locator('label[for="loginStay"]');
    if(await label.count()===1&&await label.isVisible())await label.click();
    else if(await stay.isVisible())await stay.check();
    else throw Error('LOGIN_FORM_UNSUPPORTED');
    if(!await stay.isChecked())throw Error('LOGIN_FORM_UNSUPPORTED');
  }
  diagnostic.phase='BOOTSTRAP_TAKE';
  let b=(await call('naver_bootstrap_take')).bootstrap;
  if (!b || typeof b.id!=='string' || typeof b.password!=='string') throw Error('BOOTSTRAP_INVALID');
  try {
    await page.locator('#'+chosen.id).fill(b.id);
    await pw.fill(b.password);
    await button.click({timeout:15000});
    diagnostic.phase='LOGIN_SUBMITTED';
  } finally {b.id='';b.password='';b=null;}
  // One submission only. Diagnose fixed, non-sensitive categories. Do not
  // print the page text, field values, URLs, phone details or challenge codes.
  const deadline=Date.now()+150000;
  let notified=false;
  let checkedActualChannel=false;
  const submitted=Date.now();
  while(Date.now()<deadline) {
    if(new URL(page.url()).hostname==='clipcreators.naver.com')break;
    const kind=await challengeKind(page);
    if(kind==='CAPTCHA_REQUIRED'||kind==='LOGIN_REJECTED'||kind==='IDENTITY_VERIFICATION_REQUIRED')throw Error(kind);
    if(kind==='TWO_FACTOR_REQUIRED'&&!notified) {
      console.log(JSON.stringify({ok:false,code:'AWAITING_PHONE_APPROVAL'}));notified=true;
    }
    diagnostic.password_field_visible=!!await page.locator('input[type="password"]:visible').count();
    const observedSite=new URL(page.url()).hostname;
    diagnostic.post_submit_site=HOSTS.has(observedSite)?observedSite:'OTHER_SITE';
    // Preserve a visible login/error/challenge form. The previous probe could
    // navigate away after 8s and lose the actual failure explanation.
    if(!checkedActualChannel&&kind==='LOGIN_NOT_COMPLETED'&&!diagnostic.password_field_visible&&Date.now()-submitted>=10000) {
      // A completed sign-in may leave an intermediate page. Let NAVER itself
      // authenticate a normal creator-page navigation, never infer from cookies.
      checkedActualChannel=true;
      const host=new URL(page.url()).hostname;
      diagnostic.post_submit_site=HOSTS.has(host)?host:'OTHER_SITE';
      diagnostic.password_field_visible=!!await page.locator('input[type="password"]:visible').count();
      if(await verifyChannel(page))return;
    }
    await page.waitForTimeout(3000);
  }
  if(new URL(page.url()).hostname!=='clipcreators.naver.com')throw Error(await challengeKind(page));
  if (!await verifyChannel(page)) throw Error('NEEDS_USER_AUTH');
}
async function challengeKind(page) {
  const visible=async re=>{
    const matches=page.getByText(re);
    const n=Math.min(await matches.count(),15);
    for(let i=0;i<n;i++)if(await matches.nth(i).isVisible())return true;
    return false;
  };
  // NAVER Help 5640/18956: "가입하지 않은 아이디이거나, 잘못된 비밀번호입니다."
  // Match "잘못된" before "비밀번호" as well as the older message order.
  if(await visible(/가입하지 않은 아이디|잘못된 비밀번호|아이디.*비밀번호.*(잘못|틀렸|확인)|incorrect.{0,25}password|check.{0,25}id.{0,25}password/i))return 'LOGIN_REJECTED';
  if(await visible(/자동입력 방지|자동 입력 방지|보안문자|보안 문자|captcha/i))return 'CAPTCHA_REQUIRED';
  const pwVisible=await page.locator('input[type="password"]:visible').count();
  if(!pwVisible&&await visible(/2단계 인증|two.step verification|네이버 앱.*인증|로그인.*승인/i))return 'TWO_FACTOR_REQUIRED';
  if(await visible(/보호조치|보호 조치|로그인이 제한|일시적으로.*제한|새로운 환경|해외.*차단|타지역.*차단/i))return 'IDENTITY_VERIFICATION_REQUIRED';
  if(!pwVisible&&await visible(/본인.*확인/i))return 'IDENTITY_VERIFICATION_REQUIRED';
  return 'LOGIN_NOT_COMPLETED';
}
let browser;
const safeCodes=new Set(['ACTION_DENIED','RELAY_RESPONSE_INVALID','LOGIN_REQUIRED','UNAUTHORIZED','INVALID','TOO_LARGE','NETWORK_OR_JSON','RELAY_FAILED','WRONG_CHANNEL','LOGIN_PAGE_MISSING','LOGIN_FORM_UNSUPPORTED','BOOTSTRAP_INVALID','NEEDS_USER_AUTH','SESSION_REUSE_FAILED','NO_LOGIN_COOKIES','CAPTCHA_REQUIRED','LOGIN_REJECTED','IDENTITY_VERIFICATION_REQUIRED','TWO_FACTOR_REQUIRED','LOGIN_NOT_COMPLETED']);
(async()=>{
  if(process.argv.length!==2) throw Error('ACTION_DENIED');
  await call('naver_health');
  diagnostic.phase='BROWSER_START';
  // Existing approved proxy only; never print or change it.
  const options={headless:true,args:['--disable-dev-shm-usage']};

  browser=await chromium.launch(options);
  let state;
  try {state=(await call('naver_session_load')).state;} catch(e) {if(e.message!=='LOGIN_REQUIRED')throw e;}
  let ctx=await context(browser,state), page=await ctx.newPage();
  let valid=await verifyChannel(page);
  if(!valid) await login(page);
  let raw=await ctx.storageState();
  diagnostic.phase='VERIFIED_CHANNEL';
  const authNames=new Set(['NID_AUT','NID_SES','NID_JKL']);
  state={cookies:raw.cookies.filter(c=>authNames.has(c.name)&&['.naver.com','naver.com','nid.naver.com','.nid.naver.com'].includes(c.domain)),origins:[]};
  raw=null;
  if(!state.cookies.some(c=>c.name==='NID_AUT')||!state.cookies.some(c=>c.name==='NID_SES'))throw Error('NO_LOGIN_COOKIES');
  await call('naver_session_save',{profile:'car_asset',state});
  await ctx.close(); ctx=null; page=null;state=null;
  state=(await call('naver_session_load')).state;
  ctx=await context(browser,state);state=null;
  page=await ctx.newPage();
  if(!await verifyChannel(page))throw Error('SESSION_REUSE_FAILED');
  const health=await call('naver_health');
  console.log(JSON.stringify({ok:true,code:'SESSION_REUSE_PASS',profile:'car_asset',bootstrap_remaining:health.bootstrap_ready,program_sha256:createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')}));
})().catch(e=>console.log(JSON.stringify({ok:false,code:safeCodes.has(e.message)?e.message:'LOGIN_TEST_FAILED',diagnostic})))
.finally(async()=>{if(browser)await browser.close().catch(()=>{});});
