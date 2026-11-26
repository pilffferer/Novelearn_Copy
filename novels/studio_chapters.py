"""Parse the exercises' restricted Ren'Py syntax as data."""
import json
import re


STRING = r'"(?:[^"\\]|\\.)*"'
VARIABLE = r'(?:ate|stayed)'


class ChapterSyntaxError(Exception):
    def __init__(self, line, hint):
        self.line = line
        self.hint = hint


def validate_project(source, chapter, validate_scene):
    lines = source.splitlines()
    menu_line = next((i for i, line in enumerate(lines) if line == '    menu:'), None)
    if menu_line is None:
        return failure(len(lines), 'Добавьте menu: перед return.')

    intro = validate_scene('\n'.join([*lines[:menu_line], '    return']))
    if not intro['ok']:
        return intro
    if not intro['chapter_complete']:
        return failure(menu_line, 'Добавьте реплику персонажа перед выбором.')
    start = lines.index('label start:')
    if any(line.strip() == 'return' for line in lines[start + 1:menu_line]):
        return failure(menu_line + 1, 'Перенесите выбор выше return.')

    commands = iter(
        (i + 1, line)
        for i, line in enumerate(lines)
        if i > menu_line and line.strip() and not line.lstrip().startswith('#')
    )
    number, current = next(commands, (len(lines) + 1, ''))

    def read(pattern, hint):
        nonlocal number, current
        match = re.fullmatch(pattern, current)
        if match is None:
            raise ChapterSyntaxError(number, hint)
        number, current = next(commands, (len(lines) + 1, ''))
        return match

    def phrase(indent, suffix='', dialogue=False):
        line = number
        speaker = r'(?:(cat|narrator) )?' if dialogue else ''
        match = read(' ' * indent + speaker + f'({STRING})' + suffix,
                     'Проверьте кавычки и отступ по примеру.')
        try:
            value = json.loads(match[2] if dialogue else match[1])
            if value.strip() and not any(0xD800 <= ord(c) <= 0xDFFF for c in value):
                if dialogue:
                    name = (intro['character_name'] or 'Кот') if match[1] == 'cat' else ''
                    return {'speaker': name, 'text': value}
                return value
        except ValueError:
            pass
        raise ChapterSyntaxError(line, 'Введите непустой текст в двойных кавычках.')

    stage = dict(intro['frames'][-1], sound=False)
    for line in lines[:menu_line]:
        line = line.rstrip()
        match = re.fullmatch(r'    scene\s+(cozy_room|street)', line)
        if match:
            stage.update(background=match[1], character=None)
        if re.fullmatch(r'    show\s+cat', line):
            stage['character'] = 'cat'

    try:
        choices = []
        variable = intro['variable'] or 'stayed'
        assignments = []
        for flag in ('True', 'False'):
            name = phrase(8, ':')
            if choices and choices[0]['text'].strip() == name.strip():
                raise ChapterSyntaxError(menu_line + 1, 'Назовите варианты по-разному.')
            if current.startswith('            $'):
                read(r'            \$ ' + variable + ' = ' + flag, f'Здесь нужно $ {variable} = {flag}.')
                assignments.append(True)
            else:
                assignments.append(False)
            branch_stage = stage
            if current.startswith('            scene '):
                background = read(r'            scene (cozy_room|street)',
                                  'Выберите фон cozy_room или street.')[1]
                branch_stage = dict(stage, background=background, character=None)
            choices.append({'text': name, 'frames': [
                dict(branch_stage, **phrase(12, dialogue=True)),
            ]})

        has_condition = chapter >= 3 or current.startswith('    if ')
        if has_condition:
            read('    if ' + variable + ':', f'Добавьте условие if {variable}: после выбора.')
            choices[0]['frames'].append(dict(choices[0]['frames'][-1], **phrase(8, dialogue=True)))
            read(r'    else:', 'Добавьте else: для второго варианта.')
            choices[1]['frames'].append(dict(choices[1]['frames'][-1], **phrase(8, dialogue=True)))

        if has_condition and not all(assignments):
            raise ChapterSyntaxError(menu_line + 1, f'Запишите выбор в переменную {variable} в обоих вариантах.')

        if re.fullmatch(r'    ' + STRING, current):
            ending = phrase(4)
            for choice in choices:
                choice['frames'].append(dict(choice['frames'][-1], speaker='', text=ending))

        read(r'    return', 'Завершите историю командой return.')
        if current:
            raise ChapterSyntaxError(number, 'Перенесите команду выше return.')
    except ChapterSyntaxError as error:
        return failure(error.line, error.hint)

    return {
        'ok': True, 'errors': [], 'frames': intro['frames'], 'choices': choices,
        'language_version': 1, 'chapter_complete': True,
        'character_name': intro['character_name'], 'variable': intro['variable'],
        'assignments': all(assignments), 'has_condition': has_condition,
        'used_coins': intro['used_coins'], 'opening': intro['opening'],
        'lesson_requirements': intro['lesson_requirements'],
    }


def failure(line, hint):
    return {
        'ok': False, 'frames': [], 'chapter_complete': False,
        'errors': [{'line': max(1, line), 'title': 'Проверьте код главы', 'hint': hint}],
    }
