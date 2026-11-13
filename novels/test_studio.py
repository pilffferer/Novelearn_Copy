import json
from django.test import SimpleTestCase, Client
from .studio import validate_scene

VALID = 'label start:\n    scene cozy_room\n    show cat\n    cat "Начнём нашу историю?"\n    return'


class StudioTests(SimpleTestCase):
    def test_mockup_example(self):
        result = validate_scene(VALID)
        self.assertTrue(result['ok'])
        self.assertTrue(result['chapter_complete'])
        self.assertEqual(result['frames'][0]['speaker'], 'Кот')

    def test_unknown_commands_are_errors(self):
        for command in ['python:','import os','sayy "Привет"','scene unknown','show unknown']:
            result = validate_scene('label start:\n    '+command+'\n    return')
            self.assertFalse(result['ok'], command)
            self.assertEqual(result['errors'][0]['line'], 2)
            self.assertEqual(result['frames'], [])

    def test_structure_and_order(self):
        for source in ['', 'scene cozy_room', VALID.replace('    show cat\n',''),
                       VALID.replace('    return',''), VALID+'\n    cat "Поздно"',
                       VALID.replace('    scene','  scene'), VALID.replace('    scene','    \tscene'), VALID.replace('cozy_room','street')]:
            self.assertFalse(validate_scene(source)['ok'], source)

    def test_literal_html_and_multiple_lines(self):
        source = VALID.replace('cat "Начнём нашу историю?"', 'cat "<img src=x onerror=alert(1)>"\n    cat "Вторая реплика"')
        result = validate_scene(source)
        self.assertTrue(result['ok'])
        self.assertEqual(len(result['frames']), 2)
        self.assertEqual(result['frames'][0]['text'], '<img src=x onerror=alert(1)>')

    def test_api_and_csrf(self):
        client = Client(enforce_csrf_checks=True, HTTP_HOST='127.0.0.1')
        self.assertEqual(client.get('/studio/').status_code, 200)
        self.assertEqual(client.get('/studio/check/').status_code, 405)
        data = json.dumps({'source': VALID})
        self.assertEqual(client.post('/studio/check/',data,content_type='application/json').status_code,403)
        token = client.cookies['csrftoken'].value
        response = client.post('/studio/check/',data,content_type='application/json',HTTP_X_CSRFTOKEN=token)
        self.assertTrue(response.json()['ok'])
        for data in ['{broken', '[]', '{"source": 1}', json.dumps({'source':'x'*20001})]:
            self.assertEqual(client.post('/studio/check/',data,content_type='application/json',HTTP_X_CSRFTOKEN=token).status_code,400)
