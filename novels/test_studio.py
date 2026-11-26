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

    def test_preview_of_example_does_not_complete_exercise(self):
        client = Client(HTTP_HOST='127.0.0.1')
        for text in ['Начнем нашу историю!!!', 'Замените на свою реплику', 'фраза', 'Кот ищет потерянный ключ.']:
            with self.subTest(text=text):
                source = 'define cat = Character("Барсик")\n' + VALID.replace('Начнём нашу историю?', text)
                result = client.post('/studio/check/', {'source': source, 'chapter': 1},
                                     content_type='application/json').json()
                self.assertTrue(result['ok'])
                self.assertEqual(result['chapter_complete'], text.startswith('Кот ищет'))

        source = 'define cat = Character("Имя")\n' + VALID.replace('Начнём нашу историю?', 'Ключ на столе.')
        result = client.post('/studio/check/', {'source': source, 'chapter': 1}, content_type='application/json').json()
        self.assertFalse(result['lesson_requirements']['1.1']['name'])
        self.assertFalse(result['lessons']['1.1'])

    def test_both_choices_require_distinct_replies(self):
        client = Client(HTTP_HOST='127.0.0.1')
        menu = (
            '    menu:\n'
            '        "Открыть дверь":\n'
            '            $ stayed = True\n'
            '            "Кот нашёл ключ."\n'
            '        "Заглянуть в окно":\n'
            '            $ stayed = False\n'
            '            "Кот нашёл ключ!"\n'
        )
        source = VALID.replace('    return', menu + '    return')
        result = client.post('/studio/check/', {'source': source, 'chapter': 2},
                             content_type='application/json').json()
        self.assertTrue(result['ok'])
        self.assertFalse(result['task']['replies'])
        self.assertFalse(result['chapter_complete'])

    def test_room_lesson_requires_background_and_character_in_the_reply(self):
        client = Client(HTTP_HOST='127.0.0.1')
        room = 'define cat = Character("Барсик")\n' + VALID
        no_cat = room.replace('    show cat\n', '')
        no_setting = no_cat.replace('    scene cozy_room\n', '')
        for source, expected in ((no_setting, False), (no_cat, False), (room, True)):
            with self.subTest(source=source):
                result = client.post('/studio/check/', {
                    'source': source, 'chapter': 1,
                }, content_type='application/json').json()
                self.assertTrue(result['ok'])
                self.assertEqual(result['lessons']['1.2'], expected)

    def test_missing_return_retains_partial_requirements_without_enabling_preview(self):
        client = Client(HTTP_HOST='127.0.0.1')
        source = 'define cat = Character("Барсик")\nlabel start:\n    cat "Ключ на столе."'
        result = client.post('/studio/check/', {'source': source, 'chapter': 1},
                             content_type='application/json').json()
        self.assertFalse(result['ok'])
        self.assertEqual(result['frames'], [])
        self.assertEqual(result['lesson_requirements']['1.1'], {'name': True, 'line': True, 'return': False})

    def test_dialogue_lesson_requires_distinct_cat_replies_in_the_room(self):
        client = Client(HTTP_HOST='127.0.0.1')
        for second_line, removed, expected in (
            ('cat "Начнём нашу историю?"', '', False),
            ('cat "Начнем нашу историю!"', '', False),
            ('"Я слышу шаги."', '', False),
            ('cat "Я слышу шаги."', '    scene cozy_room\n    show cat\n', False),
            ('cat "Я слышу шаги."', '    show cat\n', False),
            ('scene street\n    cat "Я слышу шаги."', '', False),
            ('cat "Я слышу шаги."', '', True),
        ):
            with self.subTest(second_line=second_line, removed=removed):
                source = 'define cat = Character("Барсик")\n' + VALID.replace(removed, '').replace(
                    '    return', f'    {second_line}\n    return',
                )
                result = client.post('/studio/check/', {
                    'source': source, 'chapter': 1,
                }, content_type='application/json').json()
                self.assertTrue(result['ok'])
                self.assertEqual(result['lessons']['1.3'], expected)

    def test_closed_chapters_are_listed_but_cannot_be_opened(self):
        client = Client(HTTP_HOST='127.0.0.1')
        for chapter in range(2, 5):
            self.assertRedirects(client.get('/studio/', {'chapter': chapter}), '/studio/')
        self.assertContains(client.get('/studio/'), 'Глава 2 Выбор')

    def test_untitled_chapter_sequence(self):
        client = Client(HTTP_HOST='127.0.0.1')

        def check(source, chapter):
            return client.post('/studio/check/', {'source': source, 'chapter': chapter},
                               content_type='application/json').json()

        intro = 'define cat = Character("Барсик")\nlabel start:\n    cat "Вижу свет в окне."\n'
        self.assertTrue(check(intro + '    return', 1)['chapter_complete'])
        menu = ('    menu:\n'
                '        "Войти в дом":\n            cat "Здесь горит печь."\n'
                '        "Идти дальше":\n            cat "Покажу дорогу."\n')
        self.assertTrue(check(intro + menu + '    return', 2)['chapter_complete'])

        assigned = menu.replace('            cat "Здесь', '            $ ate = True\n            cat "Здесь')
        assigned = assigned.replace('            cat "Покажу', '            $ ate = False\n            cat "Покажу')
        condition = '    if ate:\n        cat "Есть тёплый хлеб."\n    else:\n        cat "Скоро рассвет."\n'
        source = 'default ate = False\n' + intro + assigned + condition + '    return'
        self.assertTrue(check(source, 3)['chapter_complete'])
        self.assertFalse(check(source.replace('            $ ate = False\n', ''), 3)['ok'])
        self.assertFalse(check(source, 4)['chapter_complete'])
        narrator = '    "В поле зажглись огни."\n'
        result = check(source.replace('    cat "Вижу', narrator + '    cat "Вижу'), 4)
        self.assertTrue(result['chapter_complete'])
        self.assertEqual([frame['speaker'] for frame in result['frames']], ['', 'Барсик'])

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
