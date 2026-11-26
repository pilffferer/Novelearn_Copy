"""Check the practical task separately from the preview's syntax."""
import unicodedata


SAMPLE_LINES = ('Начнём нашу историю?', 'Куда пойдём?', 'Я слышу шаги.', 'фраза')


def normalized(text):
    text = unicodedata.normalize('NFKC', text.casefold()).replace('ё', 'е')
    return ''.join(c for c in text if c.isalnum())


def own_text(text, samples=()):
    value = normalized(text)
    return bool(value) and not value.startswith('замени') and all(
        value != normalized(sample) for sample in samples
    )


def scene_requirements(frames, character_name, finished):
    replies = [frame for frame in frames if frame['speaker']]
    room = any(frame['background'] == 'cozy_room' for frame in replies)
    room_replies = [frame for frame in replies if frame['background'] == 'cozy_room' and frame['character'] == 'cat']
    lines = {normalized(frame['text']) or frame['text'].strip() for frame in room_replies}
    return {
        '1.1': {
            'name': bool(character_name and own_text(character_name, ('Имя',))),
            'line': bool(replies) and all(own_text(frame['text'], SAMPLE_LINES) for frame in replies),
            'return': finished,
        },
        '1.2': {
            'room': room,
            'cat': bool(room_replies),
        },
        '1.3': {
            'room': room,
            'cat': bool(room_replies),
            'second_line': len(lines) >= 2,
        },
    }


def check_task(chapter, result):
    frames = result['frames']
    choices = result.get('choices', [])
    branches = [choice['frames'] for choice in choices]

    def distinct(values, samples=()):
        return (
            len(values) == 2
            and all(own_text(value, samples) for value in values)
            and normalized(values[0]) != normalized(values[1])
        )

    if chapter == 1:
        return result['lesson_requirements']['1.1']
    if chapter == 2:
        return {
            'choices': distinct([choice['text'] for choice in choices], ('Остаться дома', 'Выйти на улицу')),
            'replies': distinct(
                [branch[0]['text'] for branch in branches], ('Мы остались дома.', 'Мы вышли на улицу.'),
            ),
        }
    if chapter == 3:
        return {
            'variable': bool(result['variable']) and result['assignments'],
            'condition': result['has_condition'],
            'outcomes': distinct(
                [branch[1]['text'] for branch in branches if len(branch) >= 2],
                ('За окном пошёл дождь.', 'Мы успели укрыться от дождя.'),
            ),
        }
    introduction = []
    for frame in frames:
        if frame['speaker']:
            break
        if not frame.get('opening'):
            introduction.append(frame['text'])
    return {'narration': bool(introduction) and all(
        own_text(text, ('Прошла ночь.',)) for text in introduction
    )}


def check_lessons(chapter, result):
    frames = result['frames']
    task = result['task']
    if chapter == 1:
        return {lesson: all(requirements.values()) for lesson, requirements in result['lesson_requirements'].items()}
    if chapter == 2:
        return {'2.1': all(task.values())}
    if chapter == 3:
        branches = [choice['frames'] for choice in result['choices']]
        return {
            '3.1': all(task.values()),
            '3.2': result['used_coins'],
            '3.3': all(len(branch) >= 3
                       and own_text(branch[-1]['text'], ('На улице стемнело.',))
                       and normalized(branch[-1]['text']) != normalized(branch[-2]['text'])
                       for branch in branches) and task['outcomes'],
        }
    return {
        '4.1': task['narration'],
        '4.2': any(frame.get('sound') for frame in frames),
        '4.3': result['opening'] and own_text(frames[0]['text'], ('Тайна старого дома',)),
        '4.4': task['narration'] and all(len(choice['frames']) >= 2 for choice in result['choices']),
    }
