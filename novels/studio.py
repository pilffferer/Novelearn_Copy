"""Safe, versioned scene language for the first studio chapter; never executes Python."""
import json
import re

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST

from .models import UserNovel
from .studio_chapters import STRING, VARIABLE, validate_project
from .studio_course import COURSE
from .studio_tasks import check_lessons, check_task, scene_requirements


OPEN_CHAPTERS = 1
PROJECT_TITLE = 'Моя первая новелла'
STUDIO_LESSONS = {lesson['id'] for group in COURSE for lesson in group['lessons']}


def saved_studio_project(user):
    projects = UserNovel.objects.filter(owner=user, title=PROJECT_TITLE).order_by('-pk')
    return next((project for project in projects if isinstance(project.scenes, dict) and
                 isinstance(project.scenes.get('studio_drafts'), dict)), None)


@require_POST
def save_studio_project(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Войдите в аккаунт, чтобы сохранить новеллу.'}, status=403)
    if request.content_type != 'application/json':
        return JsonResponse({'error': 'Ожидается JSON.'}, status=415)
    if len(request.body) > 2_000_000:
        return JsonResponse({'error': 'Черновик слишком большой.'}, status=413)
    try:
        drafts = json.loads(request.body)
    except (ValueError, UnicodeError):
        return JsonResponse({'error': 'Не удалось прочитать черновик.'}, status=400)
    if not isinstance(drafts, dict) or not drafts or not drafts.keys() <= STUDIO_LESSONS:
        return JsonResponse({'error': 'Нет черновика для сохранения.'}, status=400)
    saved = {}
    for lesson, draft in drafts.items():
        if not isinstance(draft, dict) or any(
            not isinstance(draft.get(field), str) or len(draft[field]) > 20_000
            or any(0xD800 <= ord(char) <= 0xDFFF for char in draft[field])
            for field in ('source', 'starter')
        ):
            return JsonResponse({'error': 'Не удалось сохранить код задания.'}, status=400)
        saved[lesson] = {
            'source': draft['source'], 'starter': draft['starter'], 'complete': draft.get('complete') is True,
        }
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        project = saved_studio_project(request.user) or UserNovel(owner=request.user, title=PROJECT_TITLE)
        project.scenes = {'studio_drafts': saved}
        project.save()
    return JsonResponse({'ok': True})


def studio_commands(request):
    query = request.GET.get('q', '').strip()[:120]
    needle = query.casefold()
    error_commands = {
        'нет начала сцены': 'label',
        'неверный отступ': 'label',
        'неверная запись команды': 'cat',
        'ошибка в реплике': 'cat',
        'пустая реплика': 'cat',
        'нет реплики': 'cat',
        'нет завершения сцены': 'return',
        'команда после завершения': 'return',
        'не указан фон': 'scene',
        'фон ещё не задан': 'scene',
        'неизвестный фон': 'scene',
        'не указан персонаж': 'show',
        'персонаж ещё не показан': 'show',
        'неизвестный персонаж': 'show',
    }
    related = {command for message, command in error_commands.items() if needle and needle in message}
    groups = []
    for group in COURSE:
        commands = [(name, description) for name, description in group['commands']
                    if needle in f'{name} {description}'.casefold() or name.split()[0] in related]
        if commands:
            groups.append({**group, 'commands': commands})
    return render(request, 'studio_commands.html', {'groups': groups, 'query': query})


@ensure_csrf_cookie
@never_cache
def studio(request):
    chapter = request.GET.get('chapter')
    if chapter is not None and chapter not in {str(number) for number in range(1, OPEN_CHAPTERS + 1)}:
        return redirect('studio')
    context = {'course': COURSE, 'open_chapters': OPEN_CHAPTERS}
    if request.GET.get('project') == 'account' and request.user.is_authenticated:
        project = saved_studio_project(request.user)
        if project:
            context.update(account_drafts=project.scenes['studio_drafts'], account_id=request.user.pk)
    return render(request, 'studio.html', context)


@ensure_csrf_cookie
@never_cache
def studio_home(request):
    return render(request, 'studio.html', {'landing': True, 'open_chapters': OPEN_CHAPTERS})


def validate_scene(source):
    errors, frames = [], []
    started = finished = False
    background = character = None
    character_name = variable = coins = None
    opening = pending_sound = used_coins = False

    def error(line, title, hint):
        errors.append({'line': line, 'title': title, 'hint': hint})

    source = source.replace('\r\n', '\n')
    splash = re.search(r'^label splashscreen:\n    (' + STRING + r')\n    return[ \t]*$', source, re.M)
    if splash and not re.search(r'^label start:', source[:splash.start()], re.M):
        try:
            caption = json.loads(splash[1])
        except ValueError:
            caption = ''
        if caption.strip() and caption.isprintable():
            frames.append({'background': None, 'character': None, 'speaker': '',
                           'text': caption, 'opening': True})
            opening = True
            source = source[:splash.start()] + '\n' * splash[0].count('\n') + source[splash.end():]
    lines = source.splitlines()
    for number, raw in enumerate(lines, 1):
        command = raw.strip()
        if not command or command.startswith('#'):
            continue
        if not started:
            number_default = re.fullmatch(r'default coins = ([0-9]{1,3})', raw)
            if number_default:
                coins = str(int(number_default[1]))
                continue
            declaration = re.fullmatch(r'define cat = Character\((' + STRING + r')\)', raw)
            if declaration:
                try:
                    name = json.loads(declaration[1]).strip()
                except ValueError:
                    name = ''
                if character_name is not None or not (1 <= len(name) <= 40) or not name.isprintable():
                    error(number, 'Проверьте имя персонажа', 'Укажите одно имя до 40 символов в двойных кавычках.')
                else:
                    character_name = name
                continue
            default = re.fullmatch(r'default (' + VARIABLE + r') = False', raw)
            if default:
                if variable is not None:
                    error(number, 'Повторное объявление', 'Оставьте одну строку default перед label start:.')
                else:
                    variable = default[1]
                continue
            if raw != 'label start:':
                error(number, 'Нет начала сцены', 'Начните код со строки label start: без отступа.')
                break
            started = True
            continue
        if finished:
            error(number, 'Команда после завершения', 'Перенесите эту строку выше return.')
            continue
        if raw[:len(raw) - len(raw.lstrip())] != '    ':
            error(number, 'Неверный отступ', 'Используйте Tab для отступа в начале строки.')
            continue
        if command == 'return':
            finished = True
        elif command == 'play sound "audio/knock.wav"':
            pending_sound = True
        elif re.fullmatch(r'scene\s+\w+', command):
            value = command.split()[1]
            if value not in ('cozy_room', 'street'):
                error(number, 'Неизвестный фон', 'Доступны scene cozy_room и scene street.')
            else:
                background = value
                character = None
        elif command == 'show':
            error(number, 'Не указан персонаж', 'Напишите show cat.')
        elif command == 'scene':
            error(number, 'Не указан фон', 'Напишите scene cozy_room.')
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
                if not phrase.strip() or any(0xD800 <= ord(c) <= 0xDFFF for c in phrase):
                    error(number, 'Пустая реплика', 'Напишите текст внутри двойных кавычек.')
                elif not background and not character_name:
                    error(number, 'Фон ещё не задан', 'Добавьте scene cozy_room перед репликой.')
                elif match[1] == 'cat' and character != 'cat' and not character_name:
                    error(number, 'Персонаж ещё не показан', 'Добавьте show cat перед репликой кота.')
                else:
                    if coins is not None and '[coins]' in phrase:
                        used_coins = True
                        phrase = phrase.replace('[coins]', coins)
                    frames.append({'background': background, 'character': character,
                                   'speaker': (character_name or 'Кот') if match[1] == 'cat' else '',
                                   'text': phrase, 'sound': pending_sound})
                    pending_sound = False
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
        error(1, 'Проект пуст', 'Начните со строки label start:.')
    if started:
        if not frames and not errors:
            error(last, 'Нет реплики', 'Добавьте cat "Привет!" с отступом внутри сцены.')
        if not finished:
            error(last, 'Нет завершения сцены', 'Напишите return на новой строке с таким же отступом, как у реплики.')
    return {
        'ok': not errors, 'errors': errors, 'frames': frames if not errors else [],
        'language_version': 1, 'chapter_complete': not errors and any(f['speaker'] for f in frames),
        'character_name': character_name, 'variable': variable, 'used_coins': used_coins,
        'opening': opening, 'lesson_requirements': scene_requirements(frames, character_name, finished),
    }


@require_POST
def check_scene(request):
    if request.content_type != 'application/json':
        return JsonResponse({'error': 'Ожидается JSON.'}, status=415)
    if len(request.body) > 90000:
        return JsonResponse({'error': 'Слишком большой запрос.'}, status=413)
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeError):
        return JsonResponse({'error': 'Не удалось прочитать код.'}, status=400)
    source = payload.get('source') if isinstance(payload, dict) else None
    if not isinstance(source, str) or len(source) > 20000:
        return JsonResponse({'error': 'Код должен быть текстом длиной до 20 000 символов.'}, status=400)
    chapter = payload.get('chapter', 1)
    if type(chapter) is not int or chapter not in range(1, 5):
        return JsonResponse({'error': 'Неизвестная глава.'}, status=400)
    if chapter == 1 and '    menu:' not in source.splitlines():
        result = validate_scene(source)
    else:
        result = validate_project(source, chapter, validate_scene)
    if result['ok']:
        result['task'] = check_task(chapter, result)
        result['chapter_complete'] = all(result['task'].values())
        result['lessons'] = check_lessons(chapter, result)
    return JsonResponse(result)
