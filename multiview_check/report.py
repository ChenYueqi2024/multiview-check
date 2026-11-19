import html
import json
from pathlib import Path


def trajectory(cameras):
    if not cameras:
        return '<p>没有通过位姿校验的相机可以绘制。</p>'
    xs = [c['center'][0] for c in cameras]
    zs = [c['center'][2] for c in cameras]
    scale = max(*(abs(v) for v in xs+zs), 1)
    xs, zs = [x/scale for x in xs], [z/scale for z in zs]
    span = max(max(xs)-min(xs), max(zs)-min(zs), 1/scale)
    midx, midz = (max(xs)+min(xs))/2, (max(zs)+min(zs))/2
    def xy(c):
        return 300+(c['center'][0]/scale-midx)/span*420, 210-(c['center'][2]/scale-midz)/span*320
    parts = ['<svg viewBox="0 0 600 420" role="img" aria-label="相机中心的 XZ 平面投影">',
             '<path d="M40 210H560M300 30V390" stroke="#d1dbe9"/>',
             '<text x="540" y="232">X</text><text x="310" y="35">Z</text>']
    points = ' '.join(f'{xy(c)[0]:.2f},{xy(c)[1]:.2f}' for c in cameras)
    parts.append(f'<polyline points="{points}" fill="none" stroke="#b7c8e4" stroke-width="2"/>')
    for camera in cameras:
        x,y = xy(camera)
        dx,dz = camera['forward'][0],camera['forward'][2]
        parts.append(f'<path d="M{x:.2f},{y:.2f}l{dx*24:.2f},{-dz*24:.2f}" stroke="#22846f" stroke-width="3"/>')
        parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="6" fill="#244dde"><title>{html.escape(camera["id"])}</title></circle>')
    parts.append('</svg>')
    return ''.join(parts)


def render_html(report):
    s = report['summary']
    rows = ''.join('<tr>'+''.join(f'<td>{html.escape(str(v))}</td>' for v in
        (i['severity'],i['code'],i['frame'] if i['frame'] is not None else 'dataset',i['message']))+'</tr>' for i in report['issues'])
    if not rows:
        rows = '<tr><td colspan="4">没有发现已实现规则范围内的问题。</td></tr>'
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>多视角数据体检 · 报告</title><style>
    *{{box-sizing:border-box}}body{{font:16px/1.8 "Segoe UI","Microsoft YaHei",sans-serif;color:#1e3048;background:#f3f7fb;margin:0}}main{{max-width:1100px;margin:auto;padding:44px 24px}}h1{{font-size:clamp(2rem,5vw,3rem);line-height:1.3}}h2{{font-size:1.4rem}}.eyebrow{{color:#147761;font-size:.8rem;letter-spacing:.12em}}.stats{{display:flex;gap:18px;flex-wrap:wrap;margin:28px 0}}.stats div{{background:#fff;border:1px solid #d6e3e9;padding:20px 28px;border-radius:12px;flex:1;min-width:130px}}strong{{font-size:2rem;display:block;color:#147761}}section{{background:white;border:1px solid #d6e3e9;border-radius:12px;padding:24px;margin:24px 0}}.table{{overflow:auto}}table{{border-collapse:collapse;width:100%;min-width:640px;text-align:left;font-size:.875rem}}td,th{{padding:14px 12px;border-bottom:1px solid #d6e3e9;vertical-align:top;overflow-wrap:anywhere}}svg{{width:100%;max-width:700px;background:#f6f9fd;border-radius:8px}}.note{{color:#596a7e;font-size:.875rem}}code{{overflow-wrap:anywhere}}a{{color:#244dde}}@media(max-width:500px){{main{{padding:28px 16px}}section{{padding:18px}}td,th{{padding:10px 8px}}}}
    </style></head><body><main><p class="eyebrow">MULTIVIEW CHECK / v0.1</p><h1>先检查数据，<br>再开始实验。</h1><p>清单：<code>{html.escape(report['manifest'])}</code> · 约定：<code>{html.escape(str(report['convention']))}</code> · 单位：{html.escape(str(report['units']))}</p><div class="stats"><div>帧数<strong>{s['frames']}</strong></div><div>错误<strong>{s['errors']}</strong></div><div>待核对警告<strong>{s['warnings']}</strong></div><div>可绘制相机<strong>{s['cameras']}</strong></div></div>
    <section><h2>检查记录</h2><p class="note">小屏幕可横向滚动查看完整表格。</p><div class="table"><table><thead><tr><th>级别</th><th>规则</th><th>帧</th><th>说明</th></tr></thead><tbody>{rows}</tbody></table></div></section>
    <section><h2>相机轨迹 · XZ 投影</h2>{trajectory(report['cameras'])}<p class="note">蓝点为通过位姿校验的相机中心，绿线为前向方向在 XZ 平面的投影；连线按清单顺序。坐标显示为示意缩放，不用于读出精确角度。只绘制通过位姿校验的记录，不代表对应图像或内参也已通过检查。</p></section>
    <p class="note">本工具检查数据自洽性，不能自动判定坐标约定是否符合采集实际，也不评判重建质量。警告需要人工核对；未实现模糊度、近重复、遮挡与语义检查。所有处理在本机进行，未上传原图。</p><a href="https://github.com/ChenYueqi2024/multiview-check">源码与格式说明</a></main></body></html>'''


def write_report(report, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    (output/'report.html').write_text(render_html(report),encoding='utf-8')
