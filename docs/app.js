import {checkDataset,LIMITS} from './checker.js';
import {inspectImage} from './images.js';
import {issueRows,trajectory,reportHTML} from './report.js';
import {SAMPLES} from './samples.js';

const $=id=>document.getElementById(id);
let selection=null,folder=[],report=null,controller=null;
const isImage=name=>/\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic)$/i.test(name);

function invalidate() {
  controller?.abort();controller=null;report=null;$('results').hidden=true;
  $('issues').replaceChildren();$('trajectory').replaceChildren();$('report-meta').textContent='';
  $('run').disabled=!selection;$('cancel').hidden=true;$('status').textContent='';
}
function describe() {
  $('selection-note').textContent=selection?'清单：'+selection.manifest.name+' · 已选择 '+selection.entries.length+' 个图像文件 · '+(selection.mode==='relative'?'按相对路径匹配':'按唯一文件名匹配，不能核验目录关系'):'尚未选择文件。也可以先运行下方合成样例。';
  $('run').disabled=!selection;
}
function useFolderManifest() {
  const path=$('manifest-choice').value,entry=folder.find(e=>e.path===path);
  if(!entry){selection=null;invalidate();describe();return;}
  const prefix=path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
  selection={manifest:entry.file,mode:'relative',entries:folder.filter(e=>e.path.startsWith(prefix)&&isImage(e.path)).map(e=>({path:e.path.slice(prefix.length),file:e.file}))};
  invalidate();describe();
}
function individualSelection() {
  folder=[];$('folder-input').value='';$('folder-choice').hidden=true;
  const manifest=$('manifest-input').files[0];
  selection=manifest?{manifest,mode:'filenames',entries:[...$('images-input').files].map(file=>({path:file.name,file}))}:null;
  invalidate();describe();
}
$('folder-input').addEventListener('change',event=>{
  invalidate();$('manifest-input').value='';$('images-input').value='';
  folder=[...event.target.files].map(file=>({file,path:file.webkitRelativePath.split('/').slice(1).join('/')}));
  const manifests=folder.filter(e=>e.path.toLowerCase().endsWith('.json'));
  $('manifest-choice').replaceChildren(...manifests.map(e=>{const option=document.createElement('option');option.value=e.path;option.textContent=e.path;return option;}));
  $('folder-choice').hidden=!manifests.length;useFolderManifest();
  if(!manifests.length)$('status').textContent='所选文件夹中没有 JSON 清单，请重新选择或使用单独选文件方式。';
});
$('manifest-choice').addEventListener('change',useFolderManifest);
$('manifest-input').addEventListener('change',individualSelection);
$('images-input').addEventListener('change',individualSelection);

function render() {
  $('results').hidden=false;const s=report.summary;
  for(const key of ['frames','errors','warnings','cameras'])$(key).textContent=s[key];
  $('report-meta').textContent='清单：'+report.manifest+' · '+(report.convention||'坐标约定待修正')+' · '+(report.units||'单位待修正')+' · 已解码 '+report.coverage.inspected_images+' 个唯一图像文件';
  $('severity').value='all';$('issues').innerHTML=issueRows(report);$('trajectory').innerHTML=trajectory(report.cameras);
}
async function run() {
  if(!selection)return;
  invalidate();const selected=selection,task=new AbortController();controller=task;
  $('run').disabled=true;$('cancel').hidden=false;$('status').textContent='正在本机读取清单…';
  try {
    if(selected.manifest.size>LIMITS.manifest)throw new Error('清单超过 5 MiB；本次未检查，请使用本地工具。');
    const bytes=await selected.manifest.arrayBuffer();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    const result=await checkDataset(text,selected.entries,{manifest:selected.manifest.name,mode:selected.mode,inspect:inspectImage,signal:task.signal,
      progress:(done,total)=>{if(controller===task)$('status').textContent='正在本机检查 '+done+' / '+total+' 帧…';}});
    if(controller!==task||task.signal.aborted)return;
    report=result;render();$('status').textContent='检查完成：'+report.summary.errors+' 个错误，'+report.summary.warnings+' 条警告。文件未上传。';
  }catch(error){if(controller===task && error.name!=='AbortError')$('status').textContent=error instanceof TypeError?'无法读取 UTF-8 清单或当前浏览器不支持所需接口，请使用本地工具。':error.message;}
  finally {if(controller===task){controller=null;$('run').disabled=!selection;$('cancel').hidden=true;}}
}
$('run').addEventListener('click',run);
$('cancel').addEventListener('click',()=>{invalidate();$('status').textContent='已取消，没有生成报告。';});
$('clear').addEventListener('click',()=>{selection=null;folder=[];invalidate();for(const id of ['folder-input','manifest-input','images-input'])$(id).value='';$('manifest-choice').replaceChildren();$('folder-choice').hidden=true;describe();$('status').textContent='已清空本页的文件引用与报告。';});
$('severity').addEventListener('change',()=>{if(report)$('issues').innerHTML=issueRows(report,$('severity').value);});
function download(data,name,type) {
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('download-json').addEventListener('click',()=>{if(report)download(JSON.stringify(report,null,2),'multiview-report.json','application/json');});
$('download-html').addEventListener('click',()=>{if(report)download(reportHTML(report),'multiview-report.html','text/html;charset=utf-8');});
document.querySelectorAll('[data-sample]').forEach(button=>button.addEventListener('click',()=>{
  const sample=SAMPLES[button.dataset.sample];
  for(const id of ['folder-input','manifest-input','images-input'])$(id).value='';folder=[];$('folder-choice').hidden=true;
  selection={manifest:new File([JSON.stringify(sample.manifest)],'dataset.json',{type:'application/json'}),mode:'relative',entries:sample.images.map(image=>({path:image.path,file:new File([Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0))],image.path.split('/').at(-1),{type:'image/png'})}))};
  invalidate();describe();run();
}));
describe();
