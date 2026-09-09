import assert from 'node:assert/strict';
import test from 'node:test';
import { readCallsites } from './callsites.mjs';

const branch = text => `fetch(e.request).then(r=>r).catch(err=>{console.warn('${text}',err); if(cached)return cached; throw err;});`;
const sw = branch('[SW] Supabase image fetch failed:') + '\n' + branch('[SW] Fetch failed for:');
const entry = `async function warm(){ reg.active.postMessage({type:'WARM_CACHE',urls}); const cache=await caches.open('warmed-routes'); await Promise.all(urls.map(url=>{const parsed=new URL(url,window.location.origin); return fetch(parsed.toString(),{cache:'reload'}).then(res=>{if(res.ok)cache.put(url,res)}).catch(()=>null)})); }`;
test('AST derives the fetch callsites from structural chains, including changed whitespace', () => {
  const result = readCallsites(sw,entry);
  assert.deepEqual(result.logo,{lineNumber:0,columnNumber:0});
  assert.deepEqual(result.root,{lineNumber:1,columnNumber:0});
  assert.deepEqual(result.warmer,{lineNumber:0,columnNumber:entry.indexOf('fetch(')});
  assert.equal(readCallsites('\n  '+sw,entry).logo.lineNumber,1);
  assert.equal(readCallsites('\n  '+sw,entry).logo.columnNumber,2);
  assert.equal(readCallsites(sw,entry.replace('if(res.ok)cache.put(url,res)','res.ok&&cache.put(url,res)')).warmer.columnNumber,entry.indexOf('fetch('));
});
for(const [name,worker,client] of [
  ['duplicate worker branch',sw+'\n'+branch('[SW] Fetch failed for:'),entry],
  ['warning outside catch',sw.replace('.catch(err=>{console.warn','; console.warn'),entry],
  ['wrong fetch argument',sw.replace('e.request','e.other'),entry],
  ['wrong catch return',sw,entry.replace('()=>null','()=>true')],
  ['wrong reload',sw,entry.replace("cache:'reload'","cache:'force-cache'")],
  ['missing ok guard',sw,entry.replace('if(res.ok)','if(res)')],
  ['missing cache.put',sw,entry.replace('cache.put','cache.delete')],
  ['unrelated put',sw,entry.replace('cache.put','unrelated.put')],
  ['missing warm message',sw,entry.replace('WARM_CACHE','OTHER')],
  ['duplicate warm behavior',sw,entry+entry.replace('function warm','function warm2')],
]) test('AST rejects '+name,()=>assert.throws(()=>readCallsites(worker,client)));
