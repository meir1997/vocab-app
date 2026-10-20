const {chromium}=require('playwright'),assert=require('assert');
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});const p=await b.newPage();await p.route('**/firebase-config.js',r=>r.fulfill({body:''}));await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname,'../index.html')).href);const result=await p.evaluate(async()=>{
 selectSyncAccount('alice');fb.user={uid:'alice',email:'a@test.invalid'};fb.ready=true;fb.generation=1;
 let writes=[],finishWrite;
 const reference={get:async()=>({exists:true,data:()=>({fw:{progress:{serverWord:{r:1,w:0,s:1,next:1}}},fwUpdatedAt:1})}),set:payload=>{writes.push(payload);return new Promise(resolve=>{finishWrite=resolve})}};
 fb.db={collection:()=>({doc:()=>reference})};
 progress.localWord={r:1,w:0,s:1,next:1};persist();
 const task=pushNow();await new Promise(r=>setTimeout(r,20));
 progress.laterWord={r:0,w:1,s:0,next:1};persist();finishWrite();await task;
 const raceProtected=dirty && readJSON('fw.pending',false) && !!writes[0].fw.progress.serverWord && !writes[0].fw.progress.laterWord;
 reference.set=async payload=>writes.push(payload);await pushNow();const acknowledged=!dirty && !!writes[1].fw.progress.laterWord;
 selectSyncAccount('bob');const isolated=!progress.localWord && !progress.serverWord;
 selectSyncAccount('alice');const recovered=!!progress.localWord && !!progress.laterWord;
 clearTimeout(fb.timer);return{raceProtected,acknowledged,isolated,recovered};
});assert.deepEqual(result,{raceProtected:true,acknowledged:true,isolated:true,recovered:true});await b.close();console.log('PASS reconnect remote merge, during-upload edits stay pending, next upload acknowledges, account isolation/recovery')})().catch(e=>{console.error(e);process.exit(1)});
