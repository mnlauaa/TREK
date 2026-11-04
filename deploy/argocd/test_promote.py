import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error
import promote

class PromotionTests(unittest.TestCase):
    def run_promotion(self, heads, existing=True):
        calls=[]
        def api(path, method='GET', body=None):
            calls.append((path,method,body))
            if path=='git/ref/heads/release':
                return {'object':{'sha':heads.pop(0)}}
            if path=='git/ref/heads/gitops':
                if not existing:
                    raise urllib.error.HTTPError('url',404,'missing',{},None)
                return {'object':{'sha':'b'*40}}
            return {'sha':'c'*40}
        with patch.dict(os.environ,{'SOURCE_SHA':'a'*40,'ARGOCD_WEBHOOK_SECRET':'test'}), \
             patch.object(promote,'api',side_effect=api), \
             patch.object(Path,'read_text',return_value='{}'), \
             patch.object(promote.urllib.request,'urlopen') as urlopen:
            urlopen.return_value.__enter__.return_value.status=200
            promote.main()
        return calls

    def test_stale_before_build_promotion_does_not_write(self):
        self.assertEqual(len(self.run_promotion(['d'*40])),1)

    def test_advance_after_commit_does_not_update_ref(self):
        calls=self.run_promotion(['a'*40,'d'*40])
        self.assertFalse(any(path.startswith('git/refs') for path,_,_ in calls))

    def test_existing_branch_update_never_forces(self):
        calls=self.run_promotion(['a'*40,'a'*40])
        writes=[c for c in calls if c[1]=='PATCH']
        self.assertEqual(writes,[('git/refs/heads/gitops','PATCH',{'sha':'c'*40,'force':False})])

    def test_new_branch_created_without_source_files(self):
        calls=self.run_promotion(['a'*40,'a'*40],False)
        tree=next(c[2]['tree'] for c in calls if c[0]=='git/trees')
        self.assertEqual([x['path'] for x in tree],['deploy/gitops/manifests.json'])
        self.assertTrue(any(c[0]=='git/refs' and c[1]=='POST' for c in calls))
