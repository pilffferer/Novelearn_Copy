"""Safe, versioned scene language for the first studio chapter; never executes Python."""
import json
import re

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST


@ensure_csrf_cookie
def studio(request):
    return render(request, 'studio.html')


def validate_scene(source):
    errors, frames = [], []
    started = finished = False
    background = character = None

    def error(line, title, hint):
        errors.append({'line': line, 'title': title, 'hint': hint})

    lines = source.splitlines()
    for number, raw in enumerate(lines, 1):
        command = raw.strip()
        if not command or command.startswith('#'):
            continue
        if not started:
            if raw != 'label start:':
                error(number, 'Нет начала сцены', 'Начните код со строки label start: без отступа.')
                break
            started = True
            continue
        if finished:
            error(number, 'Команда после завершения', 'Перенесите эту строку выше return.')
            continue
        if raw[:len(raw) - len(raw.lstrip())] != '    ':
            error(number, 'Неверный отступ', 'Используйте ровно четыре пробела перед командой.')
            continue
        if command == 'return':
            finished = True
        elif re.fullmatch(r'scene\s+\w+', command):
            value = command.split()[1]
            if value not in ('cozy_room', 'street'):
                error(number, 'Неизвестный фон', 'Доступны scene cozy_room и scene street.')
            else:
                background = value
                character = None
        elif re.fullmatch(r'show\s+\w+', command):
            if command.split()[1] != 'cat':
                error(number, 'Неизвестный персонаж', 'В первой главе доступен персонаж: show cat.')
            elif background != 'cozy_room':
                error(number, 'Кот доступен в комнате', 'Для готового персонажа используйте scene cozy_room перед show cat. Отдельный спрайт для улицы пока не подключён.')
            else:
                character = 'cat'
        else:
            match = re.fullmatch(r'(?:(cat|narrator)\s+)?("(?:[^"\\]|\\.)*")', command)
            if match:
                try:
                    phrase = json.loads(match[2])
                except (ValueError, TypeError):
                    error(number, 'Ошибка в реплике', 'Проверьте кавычки и экранирование символов.')
                    continue
                if not phrase.strip():
                    error(number, 'Пустая реплика', 'Напишите текст внутри двойных кавычек.')
                elif not background:
                    error(number, 'Фон ещё не задан', 'Добавьте scene cozy_room перед репликой.')
                elif match[1] == 'cat' and character != 'cat':
                    error(number, 'Персонаж ещё не показан', 'Добавьте show cat перед репликой кота.')
                else:
                    frames.append({'background': background, 'character': character,
                                   'speaker': 'Кот' if match[1] == 'cat' else '', 'text': phrase})
            else:
                name = command.split()[0][:24]
                if re.fullmatch(r'[A-Za-z_]+', name) and name not in ('scene', 'show', 'cat', 'narrator', 'return'):
                    error(number, 'Неизвестная команда',
                          f'Команды «{name}» нет. Для реплики используйте cat "Текст".')
                else:
                    error(number, 'Неверная запись команды',
                          'Проверьте запись по примеру в разборе. Реплика должна быть в двойных кавычках.')
    last = max(1, len(lines))
    if not started and not errors:
        error(1, 'Проект пуст', 'Начните с примера из панели «Что сделать».')
    if started:
        if not frames and not errors:
            error(last, 'Нет реплики', 'Добавьте cat "Привет!" после scene cozy_room и show cat.')
        if not finished:
            error(last, 'Нет завершения сцены', 'Добавьте return с отступом в четыре пробела.')
    return {'ok': not errors, 'errors': errors, 'frames': frames if not errors else [],
            'language_version': 1, 'chapter_complete': not errors and bool(frames) and any(f['character'] for f in frames)}


@require_POST
def check_scene(request):
    if request.content_type != 'application/json':
        return JsonResponse({'error': 'Ожидается JSON.'}, status=415)
    if len(request.body) > 100000:
        return JsonResponse({'error': 'Слишком большой запрос.'}, status=413)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeError):
        return JsonResponse({'error': 'Не удалось прочитать код.'}, status=400)
    source = payload.get('source') if isinstance(payload, dict) else None
    if not isinstance(source, str) or len(source) > 20000:
        return JsonResponse({'error': 'Код должен быть текстом длиной до 20 000 символов.'}, status=400)
    return JsonResponse(validate_scene(source))
