import copy
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from multiview_check.checker import check_dataset
from multiview_check.report import render_html
from multiview_check.__main__ import main


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        Image.new('RGB',(20,10),'blue').save(self.root/'a.png')
        self.frame=dict(id='one',image='a.png',width=20,height=10,K=[[15,0,10],[0,15,5],[0,0,1]],
                        pose=[[1,0,0,2],[0,1,0,3],[0,0,1,4],[0,0,0,1]],timestamp=0)
        self.data=dict(schema_version=1,convention='camera_to_world',units='m',frames=[self.frame])
        self.manifest=self.root/'dataset.json'
    def tearDown(self):self.tmp.cleanup()
    def run_check(self):
        self.manifest.write_text(json.dumps(self.data),encoding='utf-8');return check_dataset(self.manifest)
    def codes(self):return {x['code'] for x in self.run_check()['issues']}
    def test_healthy_and_coordinate_conversion(self):
        r=self.run_check();self.assertEqual(r['summary']['errors'],0);self.assertEqual(r['summary']['warnings'],0)
        self.assertEqual(r['cameras'][0]['center'],[2,3,4])
        # A nontrivial rotation exercises R transpose, not merely translation negation.
        self.data['convention']='world_to_camera'
        self.frame['pose']=[[0,0,1,2],[0,1,0,3],[-1,0,0,4],[0,0,0,1]]
        camera=self.run_check()['cameras'][0]
        self.assertEqual(camera['center'],[4,-3,-2]);self.assertEqual(camera['forward'],[-1,0,0])
    def test_missing_and_traversal(self):
        self.frame['image']='missing.png';self.assertIn('image_missing',self.codes())
        self.frame['image']='../outside.png';self.assertIn('image_path',self.codes())
        self.frame['image']='C:\\outside.png';self.assertIn('image_path',self.codes())
    def test_bad_rotation_and_nan(self):
        self.frame['pose'][0][0]=-1;self.assertIn('rotation',self.codes())
        self.frame['pose'][0][0]=float('nan');self.assertIn('pose_shape',self.codes())
    def test_size_k_corruption(self):
        self.frame['width']=30;self.frame['K'][0][2]=21
        self.assertTrue({'image_dimensions','principal_point'}<=self.codes())
        (self.root/'a.png').write_bytes(b'not an image');self.assertIn('image_decode',self.codes())
    def test_duplicate_and_timestamp(self):
        self.data['frames'].append(copy.deepcopy(self.frame))
        self.assertTrue({'duplicate_id','duplicate_path','duplicate_content','duplicate_timestamp'}<=self.codes())
    def test_malformed_documents_and_fields(self):
        for value in [[],None,{},dict(schema_version=True)]:
            self.manifest.write_text(json.dumps(value),encoding='utf-8');self.assertEqual(check_dataset(self.manifest)['summary']['errors'],1)
        self.data['frames']=[None];self.assertIn('frame_schema',self.codes())
        self.data['frames']=[self.frame];self.frame['K']=[[1]];self.assertIn('intrinsics',self.codes())
    def test_report_escapes_untrusted_fields(self):
        self.frame['id']='<script>alert(1)</script>';self.frame['image']='missing.png'
        output=render_html(self.run_check());self.assertNotIn('<script>',output);self.assertIn('&lt;script&gt;',output)
    def test_cli_exit_and_reports(self):
        self.run_check();out=self.root/'reports'
        self.assertEqual(main([str(self.manifest),'--output',str(out)]),0)
        self.assertTrue((out/'report.html').is_file())
        self.frame['image']='missing.png';self.run_check()
        self.assertEqual(main([str(self.manifest),'--output',str(out)]),1)
    def test_missing_manifest_is_reported(self):
        self.assertEqual(check_dataset(self.root/'missing.json')['issues'][0]['code'],'manifest_read')
    def test_invalid_path_and_extreme_numbers_still_report(self):
        self.frame['image']='bad\0.png';self.frame['K'][0][0]=10**400
        self.data['convention']=float('nan')
        report=self.run_check()
        self.assertTrue({'image_path','intrinsics','convention'} <= {x['code'] for x in report['issues']})
        json.dumps(report,allow_nan=False)
        self.data['convention']='camera_to_world';self.frame['pose'][0][3]=1e308
        self.assertNotIn('nan',render_html(self.run_check()).lower())


if __name__=='__main__':unittest.main()
