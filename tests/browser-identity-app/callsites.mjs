/* eslint-disable security/detect-non-literal-fs-filename -- Only byte-frozen local artifacts, checked by the caller, are read. No emitted code is executed. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { hash, files } from './evidence.mjs';

function visit(node, fn, ancestors = []) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  fn(node, ancestors);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) for (const item of child) visit(item,fn,[...ancestors,node]);
    else if (child && typeof child === 'object') visit(child,fn,[...ancestors,node]);
  }
}
const member = (node, name) => node?.type === 'MemberExpression' && !node.computed && node.property.name === name;
const call = (node, name) => node?.type === 'CallExpression' && member(node.callee,name);
const literal = (node, value) => node?.type === 'Literal' && node.value === value;
const isFetch = node => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'fetch';
function contains(node, predicate) { let found = false; visit(node,n=>{if(predicate(n)) found=true;}); return found; }
const location = node => ({ lineNumber: node.loc.start.line - 1, columnNumber: node.loc.start.column });
const property = (node,name,value) => node?.type === 'Property' && !node.computed && (node.key.name === name || literal(node.key,name)) && literal(node.value,value);

export function readCallsites(workerCode, entryCode) {
  const branches = new Map([['[SW] Supabase image fetch failed:',[]],['[SW] Fetch failed for:',[]]]);
  visit(parse(workerCode,{ecmaVersion:'latest',sourceType:'module',locations:true}), node=>{
    if (!call(node,'catch') || node.arguments.length !== 1 || !call(node.callee.object,'then')) return;
    const fetch = node.callee.object.callee.object;
    const handler = node.arguments[0];
    if (!isFetch(fetch) || fetch.arguments.length !== 1 || !member(fetch.arguments[0],'request') || handler.params?.length !== 1 || handler.body.type !== 'BlockStatement') return;
    if (!contains(handler.body,n=>n.type==='ThrowStatement' && n.argument?.type==='Identifier' && n.argument.name===handler.params[0].name)) return;
    for (const [warning,matches] of branches) {
      if (contains(handler.body,n=>call(n,'warn') && n.callee.object.type==='Identifier' && n.callee.object.name==='console' && literal(n.arguments[0],warning))) matches.push(location(fetch));
    }
  });
  for (const matches of branches.values()) assert.equal(matches.length,1,'UNIQUE_SW_FETCH_BRANCH');
  const warmers = [];
  visit(parse(entryCode,{ecmaVersion:'latest',sourceType:'module',locations:true}), (node,ancestors)=>{
    if (!call(node,'catch') || node.arguments.length!==1 || node.arguments[0].type!=='ArrowFunctionExpression' || node.arguments[0].params.length || !literal(node.arguments[0].body,null) || !call(node.callee.object,'then')) return;
    const then = node.callee.object;
    const fetch = then.callee.object;
    if (!isFetch(fetch) || fetch.arguments.length!==2 || !call(fetch.arguments[0],'toString') || fetch.arguments[0].arguments.length || fetch.arguments[1].type!=='ObjectExpression' || fetch.arguments[1].properties.length!==1 || !property(fetch.arguments[1].properties[0],'cache','reload')) return;
    const handler=then.arguments[0];
    if (then.arguments.length!==1 || handler?.params?.length!==1) return;
    const response=handler.params[0].name;
    const owner=ancestors.findLast(n=>['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(n.type) && n.async && contains(n.body,p=>call(p,'postMessage') && p.start<fetch.start && p.arguments.length===1 && p.arguments[0].type==='ObjectExpression' && p.arguments[0].properties.some(q=>property(q,'type','WARM_CACHE'))));
    if (!owner) return;
    const cacheBindings=[];
    visit(owner.body,n=>{
      const value=n.type==='VariableDeclarator' && n.init?.type==='AwaitExpression'?n.init.argument:null;
      if(n.id?.type==='Identifier' && call(value,'open') && value.callee.object.name==='caches' && n.start<fetch.start && literal(value.arguments[0],'warmed-routes'))cacheBindings.push(n.id.name);
    });
    if(cacheBindings.length!==1)return;
    const guardedPut = contains(handler.body,n=>{
      const condition=n.type==='IfStatement'?n.test:n.type==='LogicalExpression' && n.operator==='&&'?n.left:null;
      const consequent=n.type==='IfStatement'?n.consequent:n.right;
      return member(condition,'ok') && condition.object.name===response && contains(consequent,p=>call(p,'put') && p.callee.object.name===cacheBindings[0] && p.arguments.length===2 && p.arguments[1].type==='Identifier' && p.arguments[1].name===response);
    });
    if (!guardedPut) return;
    warmers.push(location(fetch));
  });
  assert.equal(warmers.length,1,'UNIQUE_WARM_CACHE_FETCH');
  return { logo:branches.get('[SW] Supabase image fetch failed:')[0],root:branches.get('[SW] Fetch failed for:')[0],warmer:warmers[0] };
}

export async function artifactCallsites(artifact, origin) {
  const entries=(await files(artifact.directory)).filter(name=>/^assets\/index-[\w-]+\.js$/.test(name));
  assert.equal(entries.length,1,'UNIQUE_ENTRY_ARTIFACT');
  const worker=await fs.readFile(path.join(artifact.directory,'sw.js'));
  const entry=await fs.readFile(path.join(artifact.directory,entries[0]));
  const index=await fs.readFile(path.join(artifact.directory,'index.html'));
  const result=readCallsites(worker.toString('utf8'),entry.toString('utf8'));
  const snapshot=artifact.snapshot;
  return { identityRevision:snapshot.identityRevision,storeName:snapshot.identity.storeName,logoURL:snapshot.identity.urls.header,localLogoURL:new URL(snapshot.localUrls.header,origin).href,
    logo:{bytes:snapshot.identity.assets.header.bytes,sha256:snapshot.identity.assets.header.sha256},index:{url:origin+'/index.html',bytes:index.length,sha256:hash(index)},
    worker:{sha256:hash(worker),logo:{url:origin+'/sw.js',...result.logo},root:{url:origin+'/sw.js',...result.root}},warmer:{url:origin+'/'+entries[0],sha256:hash(entry),...result.warmer} };
}
