export const LIMITS = {manifest:5*1024*1024, image:64*1024*1024, total:256*1024*1024, files:500, frames:2000, pixels:24_000_000};
const finite = value => typeof value==='number' && Number.isFinite(value);
const matrix = (value,n) => Array.isArray(value) && value.length===n && value.every(row=>Array.isArray(row) && row.length===n && row.every(finite));
const imageName = name => /\.(png|jpe?g|webp)$/i.test(name);
const basename = name => name.split('/').at(-1);

export function relativePath(value) {
  if(typeof value!=='string' || !value || /[\0:]/.test(value))return null;
  const path=value.replaceAll('\\','/');
  if(path.startsWith('/') || path.split('/').includes('..'))return null;
  return path.split('/').filter(part=>part && part!=='.').join('/') || null;
}

export async function checkDataset(text, entries, {manifest='dataset.json', mode='relative', inspect, signal, progress=()=>{}}={}) {
  const report={schema_version:1,manifest:basename(manifest),convention:null,units:null,
    summary:{frames:0,errors:0,warnings:0,cameras:0},issues:[],cameras:[],
    coverage:{engine:'browser',selection_mode:mode,selected_images:entries.length,inspected_images:0,
      note:'Only selected PNG/JPEG/WebP files are inspected. Browser decoding differs from Pillow. Reports contain no source images.'}};
  const issue=(code,severity,frame,message)=>report.issues.push({code,severity,frame,message});
  const finish=()=>{report.summary.errors=report.issues.filter(i=>i.severity==='error').length;report.summary.warnings=report.issues.filter(i=>i.severity==='warning').length;report.summary.cameras=report.cameras.length;return report;};
  const abort=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
  let data;
  try {data=JSON.parse(text.replace(/^\uFEFF/,''));}catch {issue('manifest_read','error',null,'清单不是有效的 UTF-8 JSON。');return finish();}
  if(!data || Array.isArray(data) || typeof data!=='object' || data.schema_version!==1){issue('schema','error',null,'清单需要 schema_version: 1。');return finish();}
  const {convention,units,frames}=data;
  report.convention=typeof convention==='string'?convention:null;report.units=typeof units==='string'?units:null;
  if(!['camera_to_world','world_to_camera'].includes(convention))issue('convention','error',null,'请明确指定 camera_to_world 或 world_to_camera，不自动猜测。');
  if(units!=='m')issue('units','error',null,'平移单位需要为 m。');
  if(!Array.isArray(frames) || !frames.length){issue('frames','error',null,'frames 需要是非空数组。');return finish();}
  report.summary.frames=frames.length;
  if(frames.length>LIMITS.frames){issue('frame_limit','error',null,'浏览器版最多检查 2000 帧；超限未检查，请使用本地工具。');return finish();}
  if(entries.length>LIMITS.files || entries.reduce((sum,e)=>sum+e.file.size,0)>LIMITS.total){issue('selection_limit','error',null,'浏览器版最多选择 500 张图、合计 256 MiB；超限未检查。');return finish();}
  const byPath=new Map(),byName=new Map(),requested=new Map();
  for(const entry of entries){for(const [map,key] of [[byPath,entry.path],[byName,basename(entry.path)]])map.set(key,[...(map.get(key)||[]),entry]);}
  for(const frame of frames){const path=relativePath(frame?.image);if(path){const name=basename(path);if(!requested.has(name))requested.set(name,new Set());requested.get(name).add(path);}}
  const ids=new Set(),paths=new Set(),used=new Set(),digests=new Map(),timestamps=new Set(),cache=new Map();
  let lastTime=null,usedFallback=false;
  for(let index=0;index<frames.length;index++){
    abort();const frame=frames[index];let label=String(index);
    if(!frame || Array.isArray(frame) || typeof frame!=='object'){issue('frame_schema','error',label,'帧记录需要是对象。');continue;}
    if(typeof frame.id!=='string' || !frame.id)issue('frame_id','error',label,'id 需要是非空字符串。');
    else {label=frame.id;if(ids.has(label))issue('duplicate_id','error',label,'帧 id 重复。');ids.add(label);}
    const dimensions=[frame.width,frame.height],sizeOK=dimensions.every(n=>Number.isSafeInteger(n)&&n>0);
    if(!sizeOK)issue('dimensions','error',label,'width 和 height 需要是正整数。');
    const path=relativePath(frame.image);let actual=null;
    if(!path)issue('image_path','error',label,'图像路径需要位于清单目录内；不接受绝对路径、驱动器或 .. 。');
    else {
      if(paths.has(path))issue('duplicate_path','warning',label,'多个帧引用相同图像路径。');paths.add(path);
      let candidates=byPath.get(path)||[];
      if(!candidates.length && mode==='filenames'){
        candidates=byName.get(basename(path))||[];
        if(candidates.length && requested.get(basename(path)).size>1){issue('image_ambiguous','error',label,'清单中的不同路径具有相同文件名。请选择整个数据集文件夹。');candidates=null;}
        else if(candidates.length)usedFallback=true;
      }
      if(candidates?.length>1)issue('image_ambiguous','error',label,'选中的图像存在同名或同路径冲突，无法唯一匹配。');
      else if(candidates?.length===0)issue('image_missing','error',label,'选中的文件中缺少该图像。');
      else if(candidates?.length===1){
        const entry=candidates[0];used.add(entry);
        if(!cache.has(entry)){
          let result;
          if(entry.file.size>LIMITS.image)result={error:'image_size_limit',message:'图像超过 64 MiB，未解码。'};
          else if(!imageName(entry.path))result={error:'image_format',message:'浏览器版只支持 PNG、JPEG、WebP；该文件未解码。'};
          else {try {result=await inspect(entry.file);report.coverage.inspected_images++;}catch(error){if(error.name==='AbortError')throw error;result={error:error.code==='image_pixels'?'image_pixels':'image_decode',message:error.code==='image_pixels'?'图像超过 2400 万像素，未解码。':'浏览器无法完整解码该图像，或无法读取其尺寸。'};}}
          cache.set(entry,result);
        }
        abort();const result=cache.get(entry);
        if(result.error)issue(result.error,'error',label,result.message);
        else {
          actual=[result.width,result.height];
          if(digests.has(result.digest))issue('duplicate_content','warning',label,'图像字节内容与帧 '+digests.get(result.digest)+' 完全相同。');else digests.set(result.digest,label);
          if(sizeOK && actual.some((n,i)=>n!==dimensions[i]))issue('image_dimensions','error',label,'声明尺寸与文件中的图像尺寸不一致。');
        }
      }
    }
    const k=frame.K;
    if(!matrix(k,3))issue('intrinsics','error',label,'K 需要是数值有限的 3×3 矩阵。');
    else {
      if(k[0][0]<=0 || k[1][1]<=0 || Math.abs(k[1][0])>1e-6 || k[2].some((v,i)=>Math.abs(v-[0,0,1][i])>1e-6))issue('intrinsics','error',label,'焦距应为正，K 为上三角形式，末行为 [0,0,1]。');
      const size=actual||(sizeOK?dimensions:null);
      if(size && !(k[0][2]>=0&&k[0][2]<size[0]&&k[1][2]>=0&&k[1][2]<size[1]))issue('principal_point','warning',label,'主点在图像范围外，请核对裁剪、缩放与标定。');
    }
    const pose=frame.pose;
    if(!matrix(pose,4))issue('pose_shape','error',label,'pose 需要是数值有限的 4×4 矩阵。');
    else if(pose[3].some((v,i)=>Math.abs(v-[0,0,0,1][i])>1e-6))issue('pose_homogeneous','error',label,'齐次末行应为 [0,0,0,1]。');
    else {
      const r=pose.slice(0,3).map(row=>row.slice(0,3));let error=0;
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)error=Math.max(error,Math.abs(r.reduce((sum,row)=>sum+row[i]*row[j],0)-(i===j?1:0)));
      const det=r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);
      if(!finite(error)||!finite(det)||error>1e-3||Math.abs(det-1)>1e-3)issue('rotation','error',label,'旋转矩阵需正交且行列式为 +1（容差 1e-3）。');
      else if(['camera_to_world','world_to_camera'].includes(convention)&&units==='m'){
        const t=pose.slice(0,3).map(row=>row[3]);
        const center=convention==='camera_to_world'?t:[0,1,2].map(i=>-r.reduce((sum,row,k)=>sum+row[i]*t[k],0));
        const forward=convention==='camera_to_world'?r.map(row=>row[2]):r[2];
        if(center.every(finite))report.cameras.push({id:label,center,forward});else issue('camera_center','error',label,'相机中心计算超出有限数值范围。');
      }
    }
    if('timestamp' in frame){
      const time=frame.timestamp;
      if(!finite(time))issue('timestamp','error',label,'timestamp 需要是有限秒数。');
      else {if(timestamps.has(time))issue('duplicate_timestamp','warning',label,'时间戳重复。');if(lastTime!==null&&time<lastTime)issue('timestamp_order','warning',label,'时间戳在清单顺序中倒退。');timestamps.add(time);lastTime=time;}
    }
    progress(index+1,frames.length);
    if(index%20===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  abort();
  const extras=entries.filter(e=>imageName(e.path)&&!used.has(e)).length;
  if(extras)issue('unreferenced_images','warning',null,extras+' 个选中的图像文件未被清单引用。');
  if(usedFallback)issue('filename_matching','warning',null,'单独选图模式使用唯一文件名匹配，未核验原始目录关系。需要精确路径检查时请选择整个文件夹。');
  return finish();
}
