'use strict';
// Temporary user-operated browser. No input, screenshots or cookies are logged.
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {chromium}=require('playwright');
const ORIGIN='https://carasset-naver-probe.onrender.com';
const CONTENTS='https://clipcreators.naver.com/web/contents/clips';
const RELAY='https://script.google.com/macros/s/AKfycbyNnarZTyhzdoqG3Z66GS8yKsBoTFSKdZrYh9aCESyOFEkhpt5bS2aE9UiMj8C9PvFhsQ/exec';
const hosts=new Set(['clipcreators.naver.com','clip.naver.com','nid.naver.com','ssl.pstatic.net','static-clipcreators.pstatic.net','ncpt.naver.com']);
let session='',until=0,browser,context,page,opening;
let report={stage:'WAITING_FOR_USER',publishing_enabled:false};
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
async function close(){if(browser)await browser.close().catch(()=>{});browser=context=page=null;opening=null;session='';until=0;}
async function open(){
 if(page)return;
 if(opening)return opening;
 opening=(async()=>{
  browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1100,height:780}});
  await context.route('**/*',route=>{try{const u=new URL(route.request().url());return u.protocol==='https:'&&hosts.has(u.hostname)?route.continue():route.abort();}catch{return route.abort();}});
  page=await context.newPage();
  await page.goto(CONTENTS,{waitUntil:'domcontentloaded',timeout:60000});
 })();
 return opening;
}
const login=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>카에셋 임시 클라우드 화면 연결</title><style>body{font:18px sans-serif;max-width:700px;margin:50px auto;padding:20px}input,button{font:inherit;padding:12px}</style><h1>카에셋 임시 클라우드 화면</h1><p>Render 전용 연결 인증값으로 잠금을 엽니다. 이 칸에는 네이버 비밀번호를 넣지 마세요.</p><form method="post" action="/remote/auth"><label>연결 인증값 <input name="token" type="password" autocomplete="off" required></label><button>클라우드 화면 열기</button></form></html>`;
const panel=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>카에셋 네이버 클라우드 로그인</title><style>body{font:16px sans-serif;margin:12px}button,input{font:inherit;padding:9px;margin:4px}img{max-width:100%;border:1px solid #aaa;cursor:pointer}#note{white-space:pre-wrap}input{width:330px}</style><h2>Render 안에서 실행 중인 네이버 화면</h2><p>아래 화면의 입력칸을 클릭한 뒤 전송 칸에 입력하세요. 비밀번호는 ●●● 칸을 사용하세요. 창이 열려 있는 동안만 화면을 갱신합니다. 20분 후 연결은 종료됩니다.</p><button onclick="key('Tab')">Tab</button><button onclick="key('Enter')">Enter</button><button onclick="key('Backspace')">지우기</button><button onclick="key('Control+A')">전체 선택</button><button onclick="act('scroll',{dy:500})">아래로</button><button onclick="act('scroll',{dy:-500})">위로</button><button onclick="save()">로그인 완료 · 카에셋 확인 및 저장</button><button onclick="finish()">화면 닫기</button><br><input id="text" autocomplete="off" placeholder="아이디 등 입력할 내용"><button onclick="typeText('text')">내용 전송</button><input id="password" type="password" autocomplete="off" placeholder="비밀번호 입력"><button onclick="typeText('password')">비밀번호 전송</button><p id="note">클라우드 브라우저를 준비하고 있습니다.</p><img id="screen" alt="클라우드 네이버 화면"><script>
const screen=document.getElementById('screen'),note=document.getElementById('note');let stopped=false,busy=false,lastUrl;
async function api(path,data){const r=await fetch('/remote/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});if(!r.ok)throw Error('연결 만료 또는 작업 실패');return r.json();}
async function frame(){if(stopped||busy)return;busy=true;try{const r=await fetch('/remote/frame',{cache:'no-store'});if(!r.ok)throw Error();const next=URL.createObjectURL(await r.blob());screen.onload=()=>{if(lastUrl)URL.revokeObjectURL(lastUrl);lastUrl=next;};screen.src=next;note.textContent='아래 화면은 내 PC가 아닌 Render 클라우드의 네이버 화면입니다.';}catch{note.textContent='화면 준비 중이거나 연결이 만료됐습니다.';}finally{busy=false;}}
async function act(action,data){try{await api('action',{action,...data});await frame();}catch(e){note.textContent=e.message;}}
function key(value){return act('key',{value});}
async function typeText(id){const el=document.getElementById(id);let text=el.value;el.value='';try{await act('text',{text});}finally{text='';}}
screen.onclick=e=>{const b=screen.getBoundingClientRect();act('click',{x:Math.round((e.clientX-b.left)*1100/b.width),y:Math.round((e.clientY-b.top)*780/b.height)});};
async function save(){try{const r=await api('save');note.textContent=r.saved?'카에셋 계정과 새 브라우저 로그인 유지 확인 성공. 채팅에 로그인 완료라고 알려주세요.':'카에셋 로그인 확인 전입니다. 아래 화면에서 로그인을 완료해 주세요.';}catch{note.textContent='계정 확인 또는 저장이 실패했습니다. 채팅에 알려주세요.';}}
async function finish(){stopped=true;await api('close');screen.removeAttribute('src');note.textContent='연결 종료';}
setInterval(()=>{if(!document.hidden)frame();},3000);frame();
</script></html>`;
async function handle(req,res){
 const route=req.url.split('?')[0];if(!route.startsWith('/remote'))return false;
 try{
  if(req.method==='POST'&&req.headers.origin!==ORIGIN){send(res,403,{code:'ORIGIN_DENIED'});return true;}
  if(req.method==='POST'&&route==='/remote/auth'){
   const input=new URLSearchParams(await body(req));
   if(!equal(input.get('token'),process.env.NV_RELAY_TOKEN)){send(res,403,'연결 인증값을 확인하세요.','text/plain; charset=utf-8');return true;}
   await close();session=randomBytes(32).toString('hex');until=Date.now()+20*60000;
   res.writeHead(303,{'Location':'/remote/','Set-Cookie':'nv_remote='+session+'; Secure; HttpOnly; SameSite=Strict; Path=/remote; Max-Age=1200','Cache-Control':'no-store'});res.end();return true;
  }
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nv_remote='));
  if(!equal(cookie?.slice(10),session)||Date.now()>until){if(req.method==='GET'&&['/remote','/remote/'].includes(route))send(res,200,login,'text/html; charset=utf-8');else send(res,401,{code:'AUTH_REQUIRED'});return true;}
  if(req.method==='GET'&&['/remote','/remote/'].includes(route)){send(res,200,panel,'text/html; charset=utf-8');return true;}
  // Serialize page operations so a frame cannot race account verification.
  const work=async()=>{
   if(route==='/remote/status'){send(res,200,report);return;}
   await open();
   if(req.method==='GET'&&route==='/remote/frame'){res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await page.screenshot({type:'jpeg',quality:65}));return;}
   if(req.method==='POST'&&route==='/remote/close'){await close();send(res,200,{closed:true});return;}
   if(req.method==='POST'&&route==='/remote/save'){
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
     if(data.action==='click'&&Number.isInteger(data.x)&&Number.isInteger(data.y)&&data.x>=0&&data.x<1100&&data.y>=0&&data.y<780)await page.mouse.click(data.x,data.y);
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
module.exports={handle};
