/* Proves the specific hole: a browser already signed in as one person, opening
   a recovery link whose token never resolves (stale, reused, or belonging to
   someone else). The old code accepted the CACHED session and would have
   rewritten that person's password. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/fruitly';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const srv=http.createServer((q,s)=>{const p=path.join(ROOT,decodeURIComponent(q.url.split('?')[0].split('#')[0]));
 if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(s);});
await new Promise(r=>srv.listen(8951,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ok=[],bad=[]; const t=(n,c,e='')=>(c?ok:bad).push(n+(e?' — '+e:''));

/* A signed-in session in localStorage, and an auth listener that NEVER fires —
   the token in the URL is not a live one. */
const MOCK = `(function(){
  window.__calls=[];
  var cached={ user:{id:'victim',email:'someone-else@x.com'} };
  window.supabase={createClient:function(){return{
    auth:{
      getSession:function(){return Promise.resolve({data:{session:cached}})},
      onAuthStateChange:function(fn){ return {data:{subscription:{unsubscribe:function(){}}}}; },
      updateUser:function(o){ window.__calls.push(['updateUser',o.password]);
        return Promise.resolve({data:{user:{id:'victim'}},error:null}); },
      resetPasswordForEmail:function(){return Promise.resolve({data:{},error:null})},
      signOut:function(){return Promise.resolve({})}
    },
    from:function(){return{select:function(){return this},eq:function(){return this},maybeSingle:function(){return this},then:function(r){return Promise.resolve({data:null,error:null}).then(r)}}},
    rpc:function(){return Promise.resolve({data:null,error:null})}
  }}};
})();`;

async function open(url) {
  const pg = await b.newPage();
  await pg.addInitScript(MOCK);
  await pg.goto(url);
  await pg.waitForTimeout(3800);   // longer than the 20 x 150ms poll
  return pg;
}

// A dead recovery token must NOT fall back to the signed-in session.
let pg = await open('http://localhost:8951/reset.html#access_token=stale&type=recovery');
t('dead recovery token does not reveal the form', await pg.locator('#reset-form').isHidden());
t('dead recovery token says so', (await pg.locator('body').innerText()).includes('won’t open'));
t('no password write is possible', !(await pg.evaluate(()=>window.__calls)).some(c=>c[0]==='updateUser'));
await pg.close();

// PKCE shape of the same thing: ?code= in the query string.
pg = await open('http://localhost:8951/reset.html?code=stale-pkce-code');
t('dead PKCE code does not reveal the form', await pg.locator('#reset-form').isHidden());
await pg.close();

// But an ordinary signed-in visit with no token is a legitimate password change.
pg = await open('http://localhost:8951/reset.html');
t('signed-in visit with no token still offers the form', !(await pg.locator('#reset-form').isHidden()));
await pg.close();

await b.close(); srv.close();
ok.forEach(n=>console.log('  PASS '+n));
bad.forEach(n=>console.log('  FAIL '+n));
console.log('\nreset guard: '+ok.length+' passed, '+bad.length+' failed');
process.exit(bad.length?1:0);
