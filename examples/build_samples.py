"""Rebuild tiny, synthetic fixtures and a public report; no personal data."""
import copy
import base64
import json
import sys
import zipfile
from pathlib import Path
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from multiview_check.checker import check_dataset
from multiview_check.report import render_html


def build():
    healthy=ROOT/'examples/healthy'; broken=ROOT/'examples/broken'
    for folder in [healthy,broken]:
        (folder/'images').mkdir(parents=True,exist_ok=True)
    frames=[]
    for index in range(3):
        image=Image.new('RGB',(320,240),(205+index*12,225-index*20,245-index*15))
        draw=ImageDraw.Draw(image);draw.rectangle((50+index*25,70,130+index*25,160),fill='#244dde');draw.text((16,16),'SYNTHETIC VIEW '+str(index),fill='black')
        for folder in [healthy,broken]: image.save(folder/f'images/{index}.png')
        frames.append(dict(id=f'frame_{index}',image=f'images/{index}.png',width=320,height=240,
                           K=[[260,0,160],[0,260,120],[0,0,1]],pose=[[1,0,0,index-1],[0,1,0,0],[0,0,1,0],[0,0,0,1]],timestamp=float(index)))
    data=dict(schema_version=1,convention='camera_to_world',units='m',frames=frames)
    (healthy/'dataset.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
    bad=copy.deepcopy(data)
    bad['frames'][1]['pose'][0][0]=2
    bad['frames'][1]['width']=640
    bad['frames'][2]['image']='images/0.png'
    bad['frames'][2]['K'][0][2]=999
    bad['frames'][2]['timestamp']=-1
    missing=copy.deepcopy(frames[0]);missing['id']='missing';missing['image']='images/missing.png';missing['timestamp']=3
    bad['frames'].append(missing)
    (broken/'dataset.json').write_text(json.dumps(bad,indent=2),encoding='utf-8')
    report=check_dataset(broken/'dataset.json')
    (ROOT/'docs').mkdir(exist_ok=True)
    (ROOT/'docs/demo-report.html').write_text(render_html(report),encoding='utf-8')
    (ROOT/'docs/demo-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    with zipfile.ZipFile(ROOT/'docs/sample-data.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for folder in [healthy,broken]:
            for path in folder.rglob('*'):
                if path.is_file():archive.write(path,path.relative_to(ROOT/'examples'))
    print(report['summary'])
    samples={}
    for folder in [healthy,broken]:
        samples[folder.name]=dict(manifest=json.loads((folder/'dataset.json').read_text(encoding='utf-8')),
            images=[dict(path=path.relative_to(folder).as_posix(),base64=base64.b64encode(path.read_bytes()).decode('ascii'))
                    for path in sorted((folder/'images').glob('*.png'))])
    (ROOT/'docs/samples.js').write_text('export const SAMPLES = '+json.dumps(samples,separators=(',',':'))+';\n',encoding='utf-8')


if __name__=='__main__':build()
