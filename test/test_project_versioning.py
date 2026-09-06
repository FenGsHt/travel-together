import importlib
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(BACKEND_DIR))
app_module = importlib.import_module('app')


class ProjectVersioningApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        app_module.PROJECTS_FILE = Path(self.temp_dir.name) / 'projects.json'
        app_module.SITE_ACCESS_TOKEN = 'test-access-token'
        app_module.app.config.update(TESTING=True, SECRET_KEY='test-secret')
        app_module.save_projects([{
            'id': 'project-1',
            'name': '云南行',
            'revision': 1,
            'data': {'timeline': []},
        }])
        self.client = app_module.app.test_client()
        verified = self.client.post('/api/auth/verify', json={'token': 'test-access-token'})
        self.assertEqual(verified.status_code, 200)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_matching_revision_updates_project_and_increments_revision(self):
        response = self.client.put('/api/projects/project-1', json={
            'expectedRevision': 1,
            'data': {'timeline': [{'id': 'timeline-1', 'day': 1, 'time': '09:00'}]},
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['revision'], 2)

    def test_stale_revision_returns_latest_project_without_overwriting_it(self):
        first = self.client.put('/api/projects/project-1', json={
            'expectedRevision': 1,
            'data': {'timeline': [{'id': 'remote-edit', 'day': 1, 'time': '10:00'}]},
        })
        self.assertEqual(first.status_code, 200)

        stale = self.client.put('/api/projects/project-1', json={
            'expectedRevision': 1,
            'data': {'timeline': [{'id': 'local-edit', 'day': 1, 'time': '11:00'}]},
        })

        self.assertEqual(stale.status_code, 409)
        payload = stale.get_json()
        self.assertEqual(payload['error'], '编辑冲突')
        self.assertEqual(payload['project']['revision'], 2)
        self.assertEqual(payload['project']['data']['timeline'][0]['id'], 'remote-edit')


if __name__ == '__main__':
    unittest.main()
