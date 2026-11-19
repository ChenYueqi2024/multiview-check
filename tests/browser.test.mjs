import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {checkDataset,relativePath,LIMITS} from '../docs/checker.js';
import {encodedSize} from '../docs/images.js';
import {reportHTML} from '../docs/report.js';
import {SAMPLES} from '../docs/samples.js';

const files=sample=>sample.images.map(i=>({path:i.path,file:new File([Buffer.from(i.base64,'base64')],i.path.split('/').at(-1))}));
const inspect=async file=>{const buffer=await file.arrayBuffer(),[width,height]=encodedSize(buffer);return {width,height,digest:createHash('sha256').update(Buffer.from(buffer)).digest('hex')};};
const run=(data,entries=files(SAMPLES.healthy),options={})=>checkDataset(JSON.stringify(data),entries,{inspect,...options});
const codes=report=>report.issues.map(i=>i.code);
const signatures=report=>report.issues.map(i=>[i.code,i.severity,i.frame]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));

test('relative selection matches the Python healthy and faulty fixture results',async()=>{
  const good=await run(SAMPLES.healthy.manifest);assert.deepEqual(good.summary,{frames:3,errors:0,warnings:0,cameras:3});
  const bad=await run(SAMPLES.broken.manifest,files(SAMPLES.broken));
  const python=JSON.parse(readFileSync(new URL('../docs/demo-report.json',import.meta.url)));
  assert.deepEqual(bad.summary,python.summary);assert.deepEqual(signatures(bad),signatures(python));assert.deepEqual(bad.cameras,python.cameras);
});
test('filename fallback is explicit and ambiguous basename matches fail',async()=>{
  const flat=files(SAMPLES.healthy).map(e=>({...e,path:e.file.name}));
  const good=await run(SAMPLES.healthy.manifest,flat,{mode:'filenames'});assert.equal(good.summary.errors,0);assert.ok(codes(good).includes('filename_matching'));
  const data=structuredClone(SAMPLES.healthy.manifest);data.frames[1].image='other/0.png';
  assert.equal(codes(await run(data,flat,{mode:'filenames'})).filter(c=>c==='image_ambiguous').length,2);
  assert.ok(codes(await run(SAMPLES.healthy.manifest,[...flat,flat[0]],{mode:'filenames'})).includes('image_ambiguous'));
});
test('invalid JSON, schema, matrices, paths and dimensions produce reports',async()=>{
  assert.equal((await checkDataset('{',[],{inspect})).issues[0].code,'manifest_read');
  for(const data of [null,[],{},true])assert.ok(codes(await run(data)).includes('schema'));
  for(const path of ['../a.png','/a.png','C:\\a.png','a\0.png'])assert.equal(relativePath(path),null);
  assert.equal(relativePath('./images\\0.png'),'images/0.png');
  const data=structuredClone(SAMPLES.healthy.manifest);Object.assign(data.frames[0],{image:'../x.png',width:true,K:[[1]],pose:[[1]]});
  const result=await run(data);for(const code of ['image_path','dimensions','intrinsics','pose_shape'])assert.ok(codes(result).includes(code));
});
test('world-to-camera conversion uses transposed rotation and reports reflected rotations',async()=>{
  const data=structuredClone(SAMPLES.healthy.manifest);data.convention='world_to_camera';
  data.frames[0].pose=[[0,0,1,2],[0,1,0,3],[-1,0,0,4],[0,0,0,1]];
  const camera=(await run(data)).cameras[0];assert.deepEqual(camera.center,[4,-3,-2]);assert.deepEqual(camera.forward,[-1,0,0]);
  data.frames[0].pose[0][2]=-1;assert.ok(codes(await run(data)).includes('rotation'));
});
test('image failures and limits cannot yield a clean result',async()=>{
  const bad=await run(SAMPLES.healthy.manifest,files(SAMPLES.healthy),{inspect:async()=>{throw new Error('bad image');}});assert.equal(codes(bad).filter(c=>c==='image_decode').length,3);
  const decoderError=await run(SAMPLES.healthy.manifest,files(SAMPLES.healthy),{inspect:async()=>{throw new DOMException('Decode failed','InvalidStateError');}});
  assert.equal(codes(decoderError).filter(c=>c==='image_decode').length,3);
  const huge=[{path:'images/0.png',file:{size:LIMITS.image+1}}];assert.ok(codes(await run(SAMPLES.healthy.manifest,huge)).includes('image_size_limit'));
  assert.ok(codes(await run(SAMPLES.healthy.manifest,Array.from({length:501},()=>huge[0]))).includes('selection_limit'));
  const data=structuredClone(SAMPLES.healthy.manifest);data.frames=Array.from({length:LIMITS.frames+1},()=>data.frames[0]);assert.ok(codes(await run(data)).includes('frame_limit'));
  assert.throws(()=>encodedSize(new ArrayBuffer(8)));
});
test('report HTML escapes untrusted IDs and filenames, and cancellation discards a scan',async()=>{
  const data=structuredClone(SAMPLES.healthy.manifest);data.frames[0].id='<img src=https://invalid.test/x onerror=alert(1)>';data.frames[0].image='missing.png';
  const html=reportHTML(await run(data));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('default-src'));
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>run(data,files(SAMPLES.healthy),{signal:controller.signal}),{name:'AbortError'});
});
