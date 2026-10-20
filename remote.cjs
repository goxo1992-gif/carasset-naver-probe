'use strict';
// Temporary user-operated browser. No input, screenshots or cookies are logged.
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {chromium}=require('playwright');
const ORIGIN='https://carasset-naver-probe.onrender.com';
const CONTENTS='https://clipcreators.naver.com/web/contents/clips';
const RELAY='https://script.google.com/macros/s/AKfycbyNnarZTyhzdoqG3Z66GS8yKsBoTFSKdZrYh9aCESyOFEkhpt5bS2aE9UiMj8C9PvFhsQ/exec';
const hosts=new Set(['clipcreators.naver.com','clip.naver.com','nid.naver.com','ssl.pstatic.net','static-clipcreators.pstatic.net','ncpt.naver.com']);
let session='',csrf='',until=0,browser,context,page,opening;
let report={stage:'WAITING_FOR_USER',publishing_enabled:false};
const network=[];
const imageHosts=new Set();
function publicHost(raw){try{const h=new URL(raw).hostname;return /^[a-z0-9.-]{1,150}$/.test(h)&&(/(^|\.)(naver\.com|pstatic\.net)$/.test(h))?h:'OTHER_EXTERNAL';}catch{return 'NON_NETWORK_IMAGE';}}
function recordNetwork(url,type,state){const host=publicHost(url);const item={host,type:['image','script','document','xhr','fetch'].includes(type)?type:'other',state};if(!network.some(x=>x.host===item.host&&x.type===item.type&&x.state===item.state)&&network.length<80)network.push(item);}
let serial=Promise.resolve();
function equal(a,b){const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&aa.length>0&&timingSafeEqual(aa,bb);}
function send(res,code,data,type='application/json; charset=utf-8'){
 res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"});res.end(typeof data==='string'?data:JSON.stringify(data));
}
async function body(req,max=4096){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw Error('TOO_LARGE');chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
async function relay(action,fields={}){
 const response=await fetch(RELAY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields,relay_token:process.env.NV_RELAY_TOKEN}),signal:AbortSignal.timeout(60000)});
 const data=await response.json();if(data?.ok!==true)throw Error('RELAY_FAILED');return data;
}
async function targetField(p,kind,text){
 if(!['id','password','captcha'].includes(kind)||typeof text!=='string'||!text||text.length>200)throw Error('INPUT_DENIED');
 if(new URL(p.url()).hostname!=='nid.naver.com')throw Error('LOGIN_PAGE_REQUIRED');
 let field;
 if(kind==='password')field=p.locator('input[type="password"]:visible');
 else{
  const info=await p.locator('input:visible').evaluateAll(es=>es.filter(e=>['text','email'].includes(e.type)).map(e=>({id:e.id,autocomplete:e.autocomplete})));
  const selected=kind==='captcha'?info.find(e=>/captcha|capcha|rcpt/i.test(e.id)):info.find(e=>e.autocomplete==='username')||(info.length===1?info[0]:null);
  if(!selected||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(selected.id))throw Error('LOGIN_FORM_UNSUPPORTED');
  field=p.locator('#'+selected.id);
 }
 if(await field.count()!==1)throw Error('LOGIN_FORM_UNSUPPORTED');
 return writeField(field,kind,text);
}
async function writeField(field,kind,text){
 await field.click();await field.fill('');
 // Generate ordinary keyboard events and explicitly target the intended field.
 // Never depend on the previous remote click/focus or print the supplied value.
 await field.pressSequentially(text,{delay:40});
 const accepted=await field.evaluate((e,value)=>e.value===value,text);
 if(!accepted)throw Error('INPUT_NOT_DELIVERED');
 return {ok:true,target:kind,accepted:true};
}
async function close(){if(browser)await browser.close().catch(()=>{});browser=context=page=null;opening=null;session='';csrf='';until=0;}
async function open(){
 if(page)return;
 if(opening)return opening;
 opening=(async()=>{
  browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1100,height:780}});
  await context.route('**/*',route=>{try{const u=new URL(route.request().url());if(u.protocol==='https:'&&(hosts.has(u.hostname)||(route.request().resourceType()==='image'&&imageHosts.has(u.hostname))))return route.continue();recordNetwork(u.href,route.request().resourceType(),'BLOCKED');return route.abort();}catch{return route.abort();}});
  page=await context.newPage();
  page.on('response',response=>{if(response.request().resourceType()==='image'||response.status()>=400)recordNetwork(response.url(),response.request().resourceType(),String(response.status()));});
  page.on('requestfailed',request=>recordNetwork(request.url(),request.resourceType(),'FAILED'));
  await page.goto(CONTENTS,{waitUntil:'domcontentloaded',timeout:60000});
 })();
 return opening;
}
const login=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>카에셋 임시 클라우드 화면 연결</title><style>body{font:18px sans-serif;max-width:700px;margin:50px auto;padding:20px}input,button{font:inherit;padding:12px}</style><h1>카에셋 임시 클라우드 화면</h1><p>Render 전용 연결 인증값으로 잠금을 엽니다. 이 칸에는 네이버 비밀번호를 넣지 마세요.</p><form method="post" action="/remote/auth"><label>연결 인증값 <input name="token" type="password" autocomplete="off" required></label><button>클라우드 화면 열기</button></form></html>`;
const panel=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>카에셋 네이버 클라우드 로그인</title><style>body{font:16px sans-serif;margin:12px}button,input{font:inherit;padding:9px;margin:4px}img{max-width:100%;border:1px solid #aaa;cursor:pointer}#note{white-space:pre-wrap}input{width:330px}</style><h2>Render 안에서 실행 중인 네이버 화면</h2><p>아래 화면을 클릭할 필요 없이 위 두 칸에서 아이디 전송, 비밀번호 전송을 누르세요. 각각 네이버의 해당 칸으로 직접 전달합니다. 이후 네이버 로그인 버튼 누르기를 누르세요. 연결은 20분 후 종료됩니다.</p><button onclick="key('Tab')">Tab</button><button onclick="key('Enter')">Enter</button><button onclick="key('Backspace')">지우기</button><button onclick="key('Control+A')">전체 선택</button><button onclick="act('scroll',{dy:500})">아래로</button><button onclick="act('scroll',{dy:-500})">위로</button><button onclick="save()">로그인 완료 · 카에셋 확인 및 저장</button><button onclick="finish()">화면 닫기</button><br><input id="text" autocomplete="off" placeholder="네이버 아이디"><button onclick="typeText('text')">아이디 전송</button><input id="password" type="password" autocomplete="off" placeholder="비밀번호 입력"><button onclick="typeText('password')">비밀번호 전송</button><p id="note">클라우드 브라우저를 준비하고 있습니다.</p><img id="screen" alt="클라우드 네이버 화면"><script>
const screen=document.getElementById('screen'),note=document.getElementById('note');let stopped=false,busy=false,lastUrl,actionQueue=Promise.resolve();
async function api(path,data){const r=await fetch('/remote/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Remote-CSRF':'__CSRF_NONCE__'},body:JSON.stringify(data||{})});if(!r.ok)throw Error('연결 만료 또는 작업 실패');return r.json();}
async function frame(){if(stopped||busy)return;busy=true;try{const r=await fetch('/remote/frame',{cache:'no-store'});if(!r.ok)throw Error();const next=URL.createObjectURL(await r.blob());screen.onload=()=>{if(lastUrl)URL.revokeObjectURL(lastUrl);lastUrl=next;};screen.src=next;if(note.textContent==='클라우드 브라우저를 준비하고 있습니다.')note.textContent='아래 화면은 내 PC가 아닌 Render 클라우드의 네이버 화면입니다.';}catch{if(note.textContent==='클라우드 브라우저를 준비하고 있습니다.')note.textContent='화면 준비 중이거나 연결이 만료됐습니다.';}finally{busy=false;}}
function act(action,data){const task=actionQueue.then(async()=>{try{const r=await api('action',{action,...data});if(r.accepted)note.textContent=r.target==='password'?'비밀번호가 네이버 비밀번호 칸에 전달됐습니다.':r.target==='captcha'?'직접 입력한 보안문자가 네이버 보안문자 칸에 전달됐습니다.':'아이디가 네이버 아이디 칸에 전달됐습니다.';await frame();}catch(e){note.textContent=e.message;}});actionQueue=task;return task;}
function key(value){return act('key',{value});}
async function typeText(id){const el=document.getElementById(id);let text=el.value;el.value='';try{await act('setfield',{kind:id==='password'?'password':id==='captcha'?'captcha':'id',text});}finally{text='';}}
screen.onclick=e=>{const b=screen.getBoundingClientRect();act('click',{x:Math.max(0,Math.min(1099,Math.floor((e.clientX-b.left-screen.clientLeft)*1100/screen.clientWidth))),y:Math.max(0,Math.min(779,Math.floor((e.clientY-b.top-screen.clientTop)*780/screen.clientHeight)))});};
async function save(){try{const r=await api('save');note.textContent=r.saved?'카에셋 계정과 새 브라우저 로그인 유지 확인 성공. 채팅에 로그인 완료라고 알려주세요.':'카에셋 로그인 확인 전입니다. 아래 화면에서 로그인을 완료해 주세요.';}catch{note.textContent='계정 확인 또는 저장이 실패했습니다. 채팅에 알려주세요.';}}
async function finish(){stopped=true;await api('close');screen.removeAttribute('src');note.textContent='연결 종료';}
const submit=document.createElement('button');submit.textContent='네이버 로그인 버튼 누르기';submit.onclick=()=>act('submitlogin',{});document.getElementById('password').insertAdjacentElement('afterend',submit);
const check=document.createElement('button');check.textContent='입력 전달 점검 · 비밀번호 불필요';check.onclick=async()=>{try{const r=await api('inputcheck');note.textContent=r.passed?'클라우드 입력 전달 점검 통과. 아이디·비밀번호를 각각 입력해 주세요.':'입력 전달 점검 실패';}catch{note.textContent='입력 전달 점검 실패';}};document.querySelector('h2').insertAdjacentElement('afterend',check);
const captchaBox=document.createElement('div');captchaBox.innerHTML='<label>화면에서 직접 읽은 보안문자 <input id="captcha" autocomplete="off" placeholder="보안문자 직접 입력"></label><button id="captchaSend">보안문자 전송</button><button id="imageCheck">이미지 로딩 진단</button><span id="imageHosts"></span>';note.insertAdjacentElement('beforebegin',captchaBox);document.getElementById('captchaSend').onclick=()=>typeText('captcha');document.getElementById('imageCheck').onclick=async()=>{try{const r=await api('diagnostics');note.textContent='이미지 로딩 진단 완료. 채팅에 진단 완료라고 알려주세요.';const parent=document.getElementById('imageHosts');parent.replaceChildren();for(const host of r.blocked_image_hosts||[]){const b=document.createElement('button');b.textContent='이미지 서버 확인: '+host;b.onclick=async()=>{if(confirm(host+'에서 네이버 페이지가 요청한 이미지만 불러오도록 허용할까요? 스크립트·다른 요청은 허용하지 않습니다.')){await api('imagehost',{host});note.textContent='선택한 이미지 서버만 허용하고 재요청했습니다.';await frame();}};parent.appendChild(b);}}catch{note.textContent='이미지 로딩 진단 실패';}};
setInterval(()=>{if(!document.hidden)frame();},3000);frame();
</script></html>`;
async function handle(req,res){
 const route=req.url.split('?')[0];if(!route.startsWith('/remote'))return false;
 try{
  // Native embedded browsers may omit/rewrite Origin. Auth requires the secret;
  // subsequent commands require a separate nonce readable only in this session's page.
  if(req.method==='POST'&&route!=='/remote/auth'&&!equal(req.headers['x-remote-csrf'],csrf)){send(res,403,{code:'CSRF_DENIED'});return true;}
  if(req.method==='POST'&&route==='/remote/auth'){
   const input=new URLSearchParams(await body(req));
   if(!equal(input.get('token'),process.env.NV_RELAY_TOKEN)){send(res,403,'연결 인증값을 확인하세요.','text/plain; charset=utf-8');return true;}
   await close();session=randomBytes(32).toString('hex');csrf=randomBytes(32).toString('hex');until=Date.now()+20*60000;
   res.writeHead(303,{'Location':'/remote/','Set-Cookie':'nv_remote='+session+'; Secure; HttpOnly; SameSite=Strict; Path=/remote; Max-Age=1200','Cache-Control':'no-store'});res.end();return true;
  }
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nv_remote='));
  if(!equal(cookie?.slice(10),session)||Date.now()>until){if(req.method==='GET'&&['/remote','/remote/'].includes(route))send(res,200,login,'text/html; charset=utf-8');else send(res,401,{code:'AUTH_REQUIRED'});return true;}
  if(req.method==='GET'&&['/remote','/remote/'].includes(route)){send(res,200,panel.replace('__CSRF_NONCE__',csrf),'text/html; charset=utf-8');return true;}
  // Serialize page operations so a frame cannot race account verification.
  const work=async()=>{
   if(route==='/remote/status'){send(res,200,report);return;}
   await open();
   if(req.method==='POST'&&route==='/remote/imagehost'){
    const data=JSON.parse(await body(req));
    const candidate=network.some(x=>x.host===data.host&&x.type==='image'&&x.state==='BLOCKED');
    if(!candidate||data.host==='OTHER_EXTERNAL'||!/(^|\.)(naver\.com|pstatic\.net)$/.test(data.host)||/^(ntm|wtm|nam\.veta)\./.test(data.host)||imageHosts.size>=2)throw Error('IMAGE_HOST_DENIED');
    imageHosts.add(data.host);
    for(const frame of page.frames())await frame.locator('img').evaluateAll((es,host)=>{for(const e of es){try{if(new URL(e.src).hostname===host&&(!e.complete||e.naturalWidth===0)){const src=e.src;e.removeAttribute('src');e.src=src;}}catch{}}},data.host).catch(()=>{});
    send(res,200,{ok:true});return;
   }
   if(req.method==='POST'&&route==='/remote/diagnostics'){
    const images=await page.locator('img').evaluateAll(es=>es.map(e=>({src:e.currentSrc||e.src,loaded:e.complete&&e.naturalWidth>0,visible:!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height),captcha:/captcha|capcha|rcpt|자동입력|보안문자/i.test([e.id,e.className,e.alt,e.src].join(' '))})));
    const fields=await page.locator('input:visible').evaluateAll(es=>es.map(e=>({id:e.id,type:e.type})));
    report={stage:'IMAGE_DIAGNOSTICS',publishing_enabled:false,site:publicHost(page.url()),network:network.slice(),images:images.slice(0,30).map(e=>({host:publicHost(e.src),loaded:e.loaded,visible:e.visible,captcha:e.captcha})),captcha_input_present:fields.some(e=>e.type!=='password'&&/captcha|capcha|rcpt/i.test(e.id))};
    send(res,200,{ok:true,blocked_image_hosts:network.filter(x=>x.type==='image'&&x.state==='BLOCKED'&&x.host!=='OTHER_EXTERNAL'&&!/^(ntm|wtm|nam\.veta)\./.test(x.host)).map(x=>x.host)});return;
   }
   if(req.method==='POST'&&route==='/remote/inputcheck'){
    const testContext=await browser.newContext();
    try{
     const test=await testContext.newPage();
     await test.setContent('<input id="syntheticId"><input id="syntheticPw" type="password"><script>window.syntheticKeys=0;document.addEventListener("keyup",()=>window.syntheticKeys++);<\/script>');
     await writeField(test.locator('#syntheticId'),'id','synthetic-id');
     await test.locator('#syntheticId').click();
     await writeField(test.locator('#syntheticPw'),'password','synthetic-password');
     const passed=await test.evaluate(()=>document.querySelector('#syntheticId').value==='synthetic-id'&&document.querySelector('#syntheticPw').value==='synthetic-password'&&window.syntheticKeys>0);
     report={stage:passed?'INPUT_DELIVERY_PASS':'INPUT_DELIVERY_FAILED',publishing_enabled:false};send(res,200,{passed});
    }finally{await testContext.close();}return;
   }
   if(req.method==='GET'&&route==='/remote/frame'){res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await page.screenshot({type:'jpeg',quality:65}));return;}
   if(req.method==='POST'&&route==='/remote/close'){await close();send(res,200,{closed:true});return;}
   if(req.method==='POST'&&route==='/remote/save'){
    if(await page.locator('input[type="password"]:visible').count()) {report={stage:'LOGIN_FORM_VISIBLE',publishing_enabled:false};send(res,200,{saved:false,code:'LOGIN_FORM_VISIBLE'});return;}
    await page.goto(CONTENTS,{waitUntil:'domcontentloaded',timeout:60000});
    const link=page.getByRole('link',{name:'내 클립 바로가기',exact:true});
    await link.waitFor({state:'visible',timeout:15000}).catch(()=>{});
    if(await link.count()!==1 || (await link.getAttribute('href'))?.replace(/\/$/,'')!=='https://clip.naver.com/@car_asset'){send(res,200,{saved:false});return;}
    const raw=await context.storageState();const names=new Set(['NID_AUT','NID_SES','NID_JKL']);
    const state={cookies:raw.cookies.filter(c=>names.has(c.name)&&['.naver.com','naver.com','nid.naver.com','.nid.naver.com'].includes(c.domain)),origins:[]};
    if(!state.cookies.some(c=>c.name==='NID_AUT')||!state.cookies.some(c=>c.name==='NID_SES'))throw Error('NO_SESSION');
    await relay('naver_session_save',{profile:'car_asset',state});
    const saved=(await relay('naver_session_load')).state;
    const fresh=await browser.newContext({storageState:saved});
    await fresh.route('**/*',route=>{try{const u=new URL(route.request().url());return u.protocol==='https:'&&hosts.has(u.hostname)?route.continue():route.abort();}catch{return route.abort();}});
    try{const test=await fresh.newPage();await test.goto(CONTENTS,{waitUntil:'domcontentloaded',timeout:60000});const target=test.getByRole('link',{name:'내 클립 바로가기',exact:true});await target.waitFor({state:'visible',timeout:15000});if((await target.getAttribute('href'))?.replace(/\/$/,'')!=='https://clip.naver.com/@car_asset')throw Error('WRONG_CHANNEL');}finally{await fresh.close();}
    report={stage:'SESSION_REUSE_PASS',profile:'car_asset',publishing_enabled:false};send(res,200,{saved:true});return;
   }
   if(req.method==='POST'&&route==='/remote/action'){
    let data=JSON.parse(await body(req));
    try{
     if(data.action==='setfield') {const result=await targetField(page,data.kind,data.text);send(res,200,result);return;}
     else if(data.action==='submitlogin') {
      if(new URL(page.url()).hostname!=='nid.naver.com')throw Error('LOGIN_PAGE_REQUIRED');
      const button=page.getByRole('button',{name:/^(로그인|Sign in)$/i});if(await button.count()!==1)throw Error('LOGIN_FORM_UNSUPPORTED');
      await button.click();report={stage:'LOGIN_SUBMITTED',publishing_enabled:false};send(res,200,{ok:true});return;
     }
     else if(data.action==='click'&&Number.isInteger(data.x)&&Number.isInteger(data.y)&&data.x>=0&&data.x<1100&&data.y>=0&&data.y<780)await page.mouse.click(data.x,data.y);
     else if(data.action==='key'&&['Tab','Enter','Backspace','Control+A'].includes(data.value))await page.keyboard.press(data.value);
     else if(data.action==='text'&&typeof data.text==='string'&&data.text.length<=200)await page.keyboard.insertText(data.text);
     else if(data.action==='scroll'&&[-500,500].includes(data.dy))await page.mouse.wheel(0,data.dy);
     else throw Error('ACTION_DENIED');
    }finally{data=null;}
    send(res,200,{ok:true});return;
   }
   send(res,404,{code:'NOT_FOUND'});
  };
  const task=serial.then(work);serial=task.catch(()=>{});await task;
 }catch{send(res,500,{code:'REMOTE_ACTION_FAILED'});}
 return true;
}
setInterval(()=>{if(until&&Date.now()>until)close();},30000).unref();
module.exports={handle,targetField};
