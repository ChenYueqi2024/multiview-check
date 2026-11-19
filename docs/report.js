export const escapeHTML = value => String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function trajectory(cameras) {
  if(!cameras.length)return '<p>没有通过位姿检查的相机可以绘制。</p>';
  const coords=cameras.flatMap(c=>[c.center[0],c.center[2]]),scale=coords.reduce((m,v)=>Math.max(m,Math.abs(v)),1);
  const xs=cameras.map(c=>c.center[0]/scale),zs=cameras.map(c=>c.center[2]/scale);
  const xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs),span=Math.max(xmax-xmin,zmax-zmin,1/scale);
  const xy=c=>[300+(c.center[0]/scale-(xmin+xmax)/2)/span*460,190-(c.center[2]/scale-(zmin+zmax)/2)/span*300];
  return '<svg viewBox="0 0 600 380" role="img" aria-label="通过位姿检查的相机中心 XZ 投影"><path d="M30 190H570M300 20V360" stroke="#cbdde3"/><text x="554" y="214">X</text><text x="310" y="32">Z</text><polyline points="'+cameras.map(c=>xy(c).join(',')).join(' ')+'" fill="none" stroke="#acbecb" stroke-width="2"/>'+cameras.map(c=>{const [x,y]=xy(c);return '<path d="M'+x+','+y+'l'+c.forward[0]*24+','+-c.forward[2]*24+'" stroke="#147761" stroke-width="3"/><circle cx="'+x+'" cy="'+y+'" r="6" fill="#244dde"><title>'+escapeHTML(c.id)+'</title></circle>';}).join('')+'</svg>';
}

export function issueRows(report,severity='all') {
  const issues=report.issues.filter(i=>severity==='all'||i.severity===severity);
  return issues.map(i=>'<tr><td><span class="severity '+i.severity+'">'+(i.severity==='error'?'错误':'警告')+'</span></td><td><code>'+escapeHTML(i.code)+'</code></td><td>'+escapeHTML(i.frame??'整个数据集')+'</td><td>'+escapeHTML(i.message)+'</td></tr>').join('') || '<tr><td colspan="4">'+(report.issues.length?'此筛选条件下没有记录。':'在已选择文件与已实现规则范围内，没有发现问题。')+'</td></tr>';
}

export function reportHTML(report) {
  const s=report.summary;
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>多视角数据体检 · 浏览器报告</title><style>body{font:16px/1.8 system-ui,sans-serif;background:#f3f7fb;color:#1e3048;margin:0}main{max-width:1100px;margin:auto;padding:32px 20px}section{background:white;border:1px solid #d6e3e9;border-radius:12px;padding:24px;margin:24px 0}.table{overflow:auto}table{border-collapse:collapse;min-width:680px;width:100%;text-align:left}td,th{border-bottom:1px solid #d6e3e9;padding:12px;vertical-align:top;overflow-wrap:anywhere}svg{width:100%;max-width:720px;background:#f4f8fa}.error{color:#a1392a}.warning{color:#8c6500}code,p{overflow-wrap:anywhere}.note{font-size:.875rem;color:#536b78}</style></head><body><main><p>YUEQI / MULTIVIEW CHECK · 浏览器版 v0.2</p><h1>数据体检报告</h1><p>清单：'+escapeHTML(report.manifest)+' · 坐标约定：'+escapeHTML(report.convention)+' · 单位：'+escapeHTML(report.units)+'</p><p>帧数 '+s.frames+' · 错误 '+s.errors+' · 警告 '+s.warnings+' · 可绘制相机 '+s.cameras+'</p><section><h2>检查记录</h2><div class="table"><table><thead><tr><th>级别</th><th>规则</th><th>帧</th><th>说明</th></tr></thead><tbody>'+issueRows(report)+'</tbody></table></div></section><section><h2>相机轨迹 · XZ 投影</h2>'+trajectory(report.cameras)+'<p class="note">连线按清单顺序，绿线为前向方向的投影。显示比例用于示意；位姿通过不代表图像、内参也通过。</p></section><p>检查范围：'+escapeHTML(report.coverage.selection_mode)+' · 已选文件 '+report.coverage.selected_images+' · 已解码唯一图像 '+report.coverage.inspected_images+'</p><p class="note">只检查本次选择的文件，不能检查未选择文件、符号链接或整个磁盘。浏览器解码与 Pillow 可能存在差异。上限为 500 个图像文件、总计 256 MiB、单图 64 MiB / 2400 万像素和 2000 帧；超限计为错误。缺图、未解码及路径歧义不是通过。此报告不含原图，但包含帧名；分享前请核对。工具检查数据自洽性，不评估重建质量。</p></main></body></html>';
}
