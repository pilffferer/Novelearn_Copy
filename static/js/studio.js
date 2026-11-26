document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const landing = document.body.classList.contains('studio-home');
    const openChapters = Number(document.body.dataset.openChapters);
    const accountId = document.body.dataset.accountId;
    const deviceStorageKey = 'novelearn.studio.project.v2';
    const storageKey = accountId ? deviceStorageKey + '.account.' + accountId : deviceStorageKey;
    const demo = '# Твоя первая сцена\nlabel start:\n    scene cozy_room\n    show cat\n\n    cat "Начнём нашу историю?"\n\n    return';
    const chapters = [
        {title: 'Сцена', result: 'Имя и первая реплика'},
        {title: 'Выбор', result: 'Два пути для читателя'},
        {title: 'Условие', result: 'Разные последствия выбора'},
        {title: 'Сборка', result: 'Сцена с текстом автора'},
    ];

    function sceneStarter(lesson, source) {
        const name = source.match(/^define cat = Character\("(?:[^"\\]|\\.)*"\)$/m)?.[0] ||
            'define cat = Character("Имя")';
        const firstReply = source.match(/^    cat[ \t]+"(?:[^"\\]|\\.)*"[ \t]*$/m)?.[0]?.trimEnd();
        const demoReply = lesson === '1.1' && firstReply === '    cat "Начнём нашу историю?"';
        const reply = firstReply && !demoReply ? firstReply : '    cat "фраза"';
        const intro = [name, '', 'label start:'];
        if (lesson === '1.1') return [...intro, reply, ''].join('\n');
        if (lesson === '1.2') return [...intro, '    # Фон комнаты', '    # Персонаж', reply, '    return'].join('\n');
        return [...intro, reply, '    return'].join('\n');
    }

    function refreshStarter(lesson, draft) {
        if (lesson !== '1.1' && lesson !== '1.3') return draft;
        const starter = sceneStarter(lesson, lesson === '1.3' ? draft.starter : '');
        if (starter === draft.starter) return draft;
        if (draft.source === draft.starter) return {starter, source: starter, complete: false};
        return {...draft, starter, complete: lesson === '1.1' && draft.complete};
    }

    const isFrame = frame => frame && typeof frame.text === 'string' && typeof frame.speaker === 'string';
    const isPreview = value => value && Array.isArray(value.frames) && value.frames.length && value.frames.every(isFrame) &&
        Array.isArray(value.choices) && value.choices.every(choice =>
            choice && typeof choice.text === 'string' && Array.isArray(choice.frames) &&
            choice.frames.length && choice.frames.every(isFrame));
    const steps = ['1.1','1.2','1.3','2.1','3.1','3.2','3.3','4.1','4.2','4.3','4.4'];
    const chapterEnds = [0, 3, 4, 7, 11];
    function readDrafts() {
        const raw = localStorage.getItem(storageKey) || $('account-drafts')?.textContent;
        let saved;
        try {
            saved = JSON.parse(raw);
        } catch {
            return {};
        }
        return Object.fromEntries(steps.flatMap(lesson => {
            const draft = saved?.[lesson];
            return typeof draft?.source === 'string' && typeof draft.starter === 'string' ?
                [[lesson, refreshStarter(lesson, draft)]] : [];
        }));
    }

    let drafts = {};
    let legacySource = '';
    try {
        drafts = readDrafts();
        const legacy = JSON.parse(localStorage.getItem('novelearn.studio.project.v1')) ||
            JSON.parse(localStorage.getItem('novelearn.studio.scene.v1'));
        if (typeof legacy?.source === 'string') legacySource = legacy.source;
    } catch {
        if ($('save-status')) $('save-status').textContent = 'Не удалось открыть черновик';
    }

    if ($('profile-project')) {
        if (Object.keys(drafts).length) {
            $('profile-project-empty').hidden = true;
            $('profile-project-existing').hidden = false;
            $('profile-resume').href = $('profile-resume').dataset.deviceUrl;
        }
        document.querySelectorAll('[data-profile-dialog]').forEach(button => {
            button.addEventListener('click', () => $(button.dataset.profileDialog).showModal());
        });
        document.querySelector('dialog[data-show-dialog]')?.showModal();
        return;
    }

    const studioUrl = new URL($('back-to-studio').href);
    if (accountId) studioUrl.searchParams.set('project', 'account');
    const chapterUrl = (number, lesson) => {
        const url = new URL(studioUrl);
        url.searchParams.set('chapter', number);
        if (lesson) url.searchParams.set('lesson', lesson);
        return url;
    };
    const completedSteps = () => {
        const firstIncomplete = steps.findIndex(lesson => drafts[lesson]?.complete !== true);
        return firstIncomplete === -1 ? steps.length : firstIncomplete;
    };
    const completedChapters = chapterEnds.findLastIndex(end => end <= completedSteps());
    const requested = Number(new URLSearchParams(location.search).get('chapter'));
    const nextChapter = Math.min(completedChapters + 1, openChapters);
    const availableChapter = Number.isInteger(requested) && requested >= 1 && requested <= nextChapter;
    const chapter = landing ? 1 : availableChapter ? requested : 0;
    const chapterStart = chapterEnds[chapter - 1];
    const chapterEnd = chapterEnds[chapter];
    const requestedStep = steps.indexOf(new URLSearchParams(location.search).get('lesson'));
    const stepIndex = requestedStep >= chapterStart && requestedStep < chapterEnd &&
        requestedStep <= completedSteps() ? requestedStep :
        Math.max(chapterStart, Math.min(completedSteps(), chapterEnd - 1));
    const step = steps[stepIndex];
    if (!landing && chapter && requestedStep >= 0 && requestedStep !== stepIndex) {
        const activeUrl = chapterUrl(chapter, step);
        activeUrl.hash = location.hash;
        history.replaceState(null, '', activeUrl);
    }
    const needsPaths = ['2.1', '3.1', '3.3', '4.4'].includes(step);
    const newDraft = !landing && chapter && !drafts[step];
    if (newDraft) {
        const previousSource = drafts[steps[stepIndex - 1]]?.source || '';
        const starter = chapter === 1 ? sceneStarter(step, previousSource) : previousSource;
        drafts[step] = {starter, source: starter, complete: false};
    }
    const draft = drafts[step];
    const lessonCompleted = () => draft?.complete === true;
    const resetSource = landing ? demo : draft?.starter;

    function showProgress() {
        const done = Math.min(completedSteps(), chapterEnd);
        $('progress').textContent = done === chapterEnd
            ? 'Глава пройдена'
            : 'Заданий пройдено: ' + (done - chapterStart) + ' из ' + (chapterEnd - chapterStart);
    }

    if (!landing) {
        document.querySelectorAll('[data-step]').forEach(row => {
            const id = row.dataset.step;
            const index = steps.indexOf(id);
            const number = Number(id[0]);
            const open = number <= openChapters;
            row.querySelector('.course-task-state').textContent = !open ? 'Закрыто' : index < completedSteps() ? 'Готово' :
                index === completedSteps() && drafts[id] ? 'В процессе' : 'Не начато';
            const link = row.querySelector('a');
            if (open && index <= completedSteps()) link.href = chapterUrl(number, id);
            else link.setAttribute('aria-disabled', 'true');
        });
        if (!chapter) {
            if (legacySource && legacySource !== demo) {
                const download = $('download-legacy');
                download.href = URL.createObjectURL(new Blob([legacySource], {type: 'text/plain;charset=utf-8'}));
                download.hidden = false;
            }
            if (completedChapters >= openChapters && openChapters < chapters.length) {
                document.querySelector('.course-intro').textContent = 'Глава ' + openChapters + ' пройдена. Следующие главы пока закрыты.';
            } else if (completedSteps() === steps.length) {
                document.querySelector('.course-intro').textContent = 'Новелла готова';
            }
            return;
        }
        showProgress();
        document.querySelector('[data-lesson-guide="' + step + '"]').hidden = false;
    }

    if (landing) {
        chapters.forEach(({title, result}, index) => {
            const item = document.createElement('li');
            const number = index + 1;
            const name = document.createElement('strong');
            name.textContent = title;
            const order = document.createElement('span');
            order.className = 'chapter-order';
            order.textContent = String(number).padStart(2, '0');
            const description = document.createElement('span');
            description.className = 'muted chapter-result';
            description.textContent = result;
            item.append(order, name, description);

            const available = number <= nextChapter;
            const action = document.createElement(available ? 'a' : 'span');
            if (available) {
                action.href = chapterUrl(number);
                action.className = 'chapter-action';
                action.textContent = index < completedChapters ? 'Повторить' : 'Открыть главу';
            } else {
                action.textContent = 'Закрыта';
                action.className = 'muted';
            }
            item.append(action);
            $('chapter-list').append(item);
        });
    }

    if (landing) {
        const resume = $('resume-project');
        resume.href = chapterUrl(nextChapter);
        if (completedChapters >= openChapters) {
            $('resume-title').textContent = openChapters === chapters.length ? 'Твоя новелла готова' : 'Глава ' + openChapters + ' пройдена';
            resume.textContent = 'Открыть проект';
        } else if (drafts['1.1'] || legacySource) {
            $('resume-title').textContent = 'Продолжите в главе → ' + chapters[nextChapter - 1].title;
            resume.textContent = 'Продолжить новеллу';
        }
    } else {
        $('project-overview').hidden = true;
        $('chapter-work').hidden = false;
        $('project-name').hidden = false;
        $('page-title').textContent = 'Глава ' + chapter + '. ' + chapters[chapter - 1].title;
        $('chapter-number').textContent = 'Глава ' + chapter;
        const currentTask = document.querySelector('[data-step="' + step + '"] span').textContent;
        $('chapter-subtitle').textContent = step === '1.1' ?
            '1.1 Реплика. Дай персонажу имя и одну реплику.' : currentTask;
        document.title = $('page-title').textContent + ' | NoveLearn';
    }

    CodeMirror.defineMode('studio-scene', () => ({
        token(stream) {
            if (stream.eatSpace()) return null;
            if (stream.match(/^#.*/)) return 'comment';
            if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
            if (stream.match(/^(?:define|default|Character|label|scene|show|menu|if|else|return|True|False)\b/)) return 'keyword';
            stream.next();
            return null;
        },
    }));

    const editor = CodeMirror.fromTextArea($('source'), {
        mode: 'studio-scene', lineNumbers: true, indentUnit: 4, tabSize: 4,
        lineWrapping: true,
        extraKeys: {
            Tab: cm => cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    '),
            'Shift-Tab': 'indentLess',
        },
    });
    editor.getInputField().setAttribute('aria-label', 'Код новеллы');
    editor.setValue(landing ? demo : draft.source);

    let revision = 0;
    let saveTimer;
    let dirty = false;
    let checked = null;
    let checkedRequirements = null;
    let playing = null;
    let errorLine = null;
    let frameIndex = 0;
    let selectedChoice = null;
    let finished = false;
    const knock = new Audio($('chapter-work').dataset.soundUrl);
    const pathsPlayed = new Set();
    let scenePlayed = false;
    const mobile = matchMedia('(max-width:700px)');
    const tabs = Array.from(document.querySelectorAll('[data-tab]'));
    const criteria = Array.from(document.querySelectorAll('[data-lesson-criteria="' + step + '"]'));
    if (!landing) {
        if (!criteria.length) criteria.push(document.querySelector('[data-criterion="task"]'));
        criteria.forEach(item => { item.hidden = false; });
        criteria.push(document.querySelector('[data-criterion="preview"]'));
        $('preview-criterion').textContent = needsPaths ? 'Посмотрены оба варианта' : 'Сцена просмотрена';
    }

    function feedback(title, message, kind = '') {
        $('feedback-panel').hidden = !title;
        $('feedback-panel').className = 'feedback ' + kind;
        $('feedback-title').textContent = title;
        $('feedback-text').textContent = message;
        $('error-line').hidden = errorLine === null;
        if ($('error-help')) $('error-help').hidden = errorLine === null;
        $('tab-errors').textContent = kind === 'error' ? 'Ошибки · 1' : 'Ошибки';
    }

    function save() {
        clearTimeout(saveTimer);
        if (!dirty) return true;
        try {
            drafts = {...readDrafts(), [step]: draft};
            localStorage.setItem(storageKey, JSON.stringify(drafts));
            dirty = false;
            $('save-status').textContent = 'Сохранено в браузере';
            $('autosave').textContent = '';
            return true;
        } catch {
            $('save-status').textContent = 'Не удалось сохранить';
            $('autosave').textContent = 'Скопируйте код перед выходом.';
            return false;
        }
    }

    function clearError() {
        if (errorLine !== null) {
            editor.removeLineClass(errorLine, 'background', 'studio-error-line');
            errorLine = null;
        }
    }

    function updateComplete() {
        if (landing) return;
        const seen = needsPaths ? pathsPlayed.size >= 2 : scenePlayed;
        const alreadyDone = lessonCompleted();
        document.querySelector('.chapter-status').hidden = !alreadyDone && !checked && !checkedRequirements;
        const next = steps[stepIndex + 1];
        const canContinue = alreadyDone && next && Number(next[0]) <= openChapters;
        $('complete').disabled = !alreadyDone;
        $('next-chapter').hidden = !canContinue;
        $('next-chapter').textContent = stepIndex + 1 === chapterEnd ? 'Следующая глава →' : 'Следующее задание →';
        $('complete').classList.toggle('primary', !canContinue);
        $('complete').classList.toggle('secondary', Boolean(canContinue));
        const requirements = {...checkedRequirements, task: checked?.chapter_complete, preview: checked?.chapter_complete && seen};
        criteria.forEach(item => {
            const done = alreadyDone || Boolean(requirements[item.dataset.criterion]);
            item.classList.toggle('done', done);
            item.querySelector('span').textContent = done ? '✓' : '○';
            item.setAttribute('aria-label', item.querySelector('p').textContent + (done ? '. Выполнено.' : '. Не выполнено.'));
        });
        $('completion-hint').textContent = alreadyDone ? 'Задание засчитано.' :
            !checked ? (checkedRequirements ? 'Исправьте ошибку в коде.' : 'Сначала проверьте код.') :
            !checked.chapter_complete ? '' :
            !seen ? (!needsPaths ? 'Досмотрите сцену в превью.' :
                'Пройдено вариантов: ' + pathsPlayed.size + ' из 2.') : '';
    }

    function setPreviewEnabled(enabled) {
        $('run').disabled = !enabled;
    }

    function resetFeedback() {
        $('reset-code').disabled = editor.getValue() === resetSource;
        feedback('', '');
    }

    editor.on('change', () => {
        if (!landing) {
            draft.source = editor.getValue();
            draft.complete = false;
            draft.preview = null;
            showProgress();
        }
        revision++;
        checked = null;
        checkedRequirements = null;
        scenePlayed = false;
        pathsPlayed.clear();
        clearError();
        updateComplete();
        setPreviewEnabled(false);
        resetFeedback();
        if (playing) $('preview-status').textContent = 'Последняя рабочая версия';
        if (landing) return;
        $('account-save-result').textContent = '';
        dirty = true;
        $('autosave').textContent = 'Сохранение…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
    });

    function csrfToken() {
        const cookie = document.cookie.split('; ').find(value => value.startsWith('csrftoken='));
        return cookie ? decodeURIComponent(cookie.slice(10)) : '';
    }

    const saveButtons = Array.from(document.querySelectorAll('[data-account-save]'));
    function reportAccountSave(message) {
        $('save-status').textContent = message;
        $('account-save-result').textContent = message;
    }

    async function saveToAccount() {
        const version = revision;
        save();
        saveButtons.forEach(button => { button.disabled = true; });
        reportAccountSave('Сохраняем в аккаунт…');
        try {
            const project = Object.fromEntries(Object.entries({...drafts, ...readDrafts(), [step]: draft}).map(([id, entry]) =>
                [id, {source: entry.source, starter: entry.starter, complete: entry.complete}]));
            const response = await fetch($('chapter-work').dataset.saveUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrfToken()},
                body: JSON.stringify(project),
            });
            const result = await response.json();
            reportAccountSave(!response.ok ? result.error || 'Не удалось сохранить в аккаунт' :
                version === revision ? 'Сохранено в аккаунте' : 'Последние правки сохранены в браузере');
        } catch {
            reportAccountSave('Не удалось сохранить в аккаунт');
        } finally {
            saveButtons.forEach(button => { button.disabled = false; });
        }
    }

    saveButtons.forEach(button => button.addEventListener('click', saveToAccount));

    $('check').addEventListener('click', async () => {
        const version = revision;
        const token = csrfToken();
        clearError();
        checked = null;
        checkedRequirements = null;
        scenePlayed = false;
        pathsPlayed.clear();
        updateComplete();
        $('check').disabled = true;
        setPreviewEnabled(false);
        $('check').textContent = 'Проверка…';
        feedback('Проверка идёт', 'Проверяем команды и отступы.', 'checking');
        try {
            const response = await fetch($('chapter-work').dataset.checkUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-CSRFToken': token},
                body: JSON.stringify({source: editor.getValue(), chapter}),
            });
            const result = await response.json();
            if (revision !== version) return;
            if (!response.ok) {
                feedback('Проверка не выполнена', result.error || 'Попробуйте ещё раз.', 'error');
                return;
            }
            if (!landing) {
                checkedRequirements = result.lesson_requirements?.[step] || {};
                if (lessonCompleted() && !(result.ok && result.lessons?.[step])) {
                    draft.complete = false;
                    dirty = true;
                    save();
                    showProgress();
                }
                updateComplete();
            }
            if (!result.ok) {
                const error = result.errors[0];
                errorLine = Math.min(editor.lineCount(), error.line) - 1;
                editor.addLineClass(errorLine, 'background', 'studio-error-line');
                if ($('error-help')) {
                    const helpUrl = new URL($('error-help').href);
                    helpUrl.searchParams.set('q', error.title);
                    $('error-help').href = helpUrl.href;
                }
                feedback('Строка ' + error.line + '. ' + error.title, error.hint, 'error');
                return;
            }
            if (!landing) result.chapter_complete = Boolean(result.lessons?.[step]);
            checked = result;
            setPreviewEnabled(true);
            updateComplete();
            if (landing) {
                feedback('', '');
                playChecked();
                return;
            }
            if (lessonCompleted()) {
                feedback('Код проверен', 'Задание уже засчитано.', 'success');
            } else if (result.chapter_complete) {
                feedback('Сцена готова к запуску', 'Нажмите «Запустить превью», чтобы увидеть сцену.', 'success');
            } else {
                const details = {
                    '1.1': result.task.name ? 'Напиши свою реплику кота.' :
                        result.task.line ? 'Укажи имя кота.' : 'Укажи имя кота и напиши свою реплику.',
                    '1.2': 'В реплике пока нет комнаты с котом. Проверь команды перед ней.',
                    '1.3': checkedRequirements.cat ? 'Добавь другую реплику кота в этой же комнате.' :
                        'Восстанови фон комнаты и покажи кота перед первой репликой.',
                };
                feedback('Проверь условие задания', details[step] || document.querySelector('[data-practice="' + step + '"]').textContent);
            }
        } catch {
            if (revision === version) feedback('Проверка недоступна', 'Попробуйте ещё раз.', 'error');
        } finally {
            $('check').disabled = false;
            $('check').textContent = landing ? 'Начать сцену' : 'Проверить';
        }
    });

    function selectTab(name) {
        document.querySelector('.workspace').dataset.active = name;
        tabs.forEach(tab => {
            const active = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        if (name === 'code') editor.refresh();
    }

    function frames() {
        return selectedChoice === null ? playing.frames : playing.choices[selectedChoice].frames;
    }

    function recordPath(scene, choice) {
        if (scene !== checked || !scene.choices?.[choice] || !needsPaths) return;
        pathsPlayed.add(choice);
        if (pathsPlayed.size === 2 && checked.chapter_complete && saveStep()) {
            feedback('Оба пути проверены', 'Задание засчитано.', 'success');
        }
        updateComplete();
        $('preview-status').textContent = 'Проверено путей: ' + pathsPlayed.size + ' из 2';
    }

    function recordScene(scene) {
        if (landing || needsPaths || scene !== checked || scenePlayed) return;
        scenePlayed = true;
        if (checked.chapter_complete && saveStep()) {
            const chapterDone = stepIndex + 1 === chapterEnd;
            feedback(chapterDone ? 'Глава пройдена' : 'Задание засчитано', '', 'success');
        }
        updateComplete();
    }

    function renderFrame() {
        const frame = frames()[frameIndex];
        const stage = $('stage');
        const background = frame.background === 'cozy_room' ? stage.dataset.room : frame.background === 'street' ? stage.dataset.street : '';
        const art = $('scene-art');
        if (frame.sound && checked === playing) {
            knock.currentTime = 0;
            knock.play().catch(() => {});
        }
        art.style.backgroundImage = background ? 'url("' + background + '")' : 'none';
        art.classList.toggle('room-art', frame.background === 'cozy_room');
        art.classList.toggle('room-without-cat', frame.background === 'cozy_room' && frame.character !== 'cat');
        if ($('preview-placeholder')) $('preview-placeholder').hidden = true;
        $('dialog').hidden = false;
        $('speaker').textContent = frame.speaker;
        $('speaker').hidden = !frame.speaker;
        $('line').textContent = frame.text;
        $('choices').replaceChildren();
        $('dialog').scrollTop = 0;
        $('preview-status').textContent = playing === checked ? 'Превью новеллы' : 'Последняя рабочая версия';
        const atEnd = frameIndex === frames().length - 1;
        if (atEnd) {
            if (selectedChoice === null) recordScene(playing);
            else recordPath(playing, selectedChoice);
        }

        if (atEnd && selectedChoice === null && playing.choices?.length) {
            $('next').hidden = true;
            playing.choices.forEach((choice, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'secondary';
                button.textContent = choice.text;
                button.addEventListener('click', () => {
                    selectedChoice = index;
                    frameIndex = 0;
                    renderFrame();
                });
                $('choices').append(button);
            });
            return;
        }

        finished = atEnd;
        $('next').hidden = false;
        $('next').textContent = finished ? 'Начать сначала' : 'Дальше →';
    }

    function startPreview() {
        frameIndex = 0;
        selectedChoice = null;
        renderFrame();
    }

    function rememberPreview(scene) {
        if (landing) return;
        draft.preview = {frames: scene.frames, choices: scene.choices || []};
        dirty = true;
        save();
    }

    function playChecked() {
        if (!checked) return;
        playing = checked;
        startPreview();
        rememberPreview(playing);
        if (!landing && mobile.matches) {
            selectTab('preview');
            $('preview-panel').scrollIntoView({block: 'nearest'});
        }
    }

    $('run').addEventListener('click', playChecked);
    $('next').addEventListener('click', () => {
        if (finished) startPreview();
        else {
            frameIndex++;
            renderFrame();
        }
    });

    function saveStep() {
        if (lessonCompleted()) return true;
        draft.complete = true;
        dirty = true;
        if (save()) {
            showProgress();
            return true;
        }
        draft.complete = false;
        return false;
    }

    function finishChapter(destination) {
        if (lessonCompleted() && save()) location.assign(destination);
    }

    $('complete')?.addEventListener('click', () => finishChapter(studioUrl));
    $('next-chapter')?.addEventListener('click', () => {
        const next = steps[stepIndex + 1];
        if (next && Number(next[0]) <= openChapters) finishChapter(chapterUrl(Number(next[0]), next));
    });

    $('reset-code').addEventListener('click', () => {
        $('reset-dialog').returnValue = 'cancel';
        $('reset-dialog').showModal();
    });

    function showDemo() {
        playing = {
            frames: [{background: 'cozy_room', character: 'cat', speaker: 'Кот', text: 'Начнём нашу историю?'}],
        };
        startPreview();
        $('preview-status').textContent = 'Пример в браузере';
        $('next').hidden = true;
    }

    $('reset-dialog').addEventListener('close', () => {
        if ($('reset-dialog').returnValue !== 'reset') return;
        playing = null;
        editor.setValue(resetSource);
        if (landing) {
            showDemo();
        } else {
            draft.preview = null;
            $('dialog').hidden = true;
            $('preview-placeholder').hidden = false;
            $('scene-art').style.removeProperty('background-image');
            $('scene-art').classList.remove('room-art', 'room-without-cat');
            $('preview-status').textContent = 'Превью не запущено';
            if (save()) feedback('Код восстановлен', 'Проверьте его перед запуском.');
        }
        editor.focus();
    });

    $('error-line').addEventListener('click', () => {
        if (errorLine === null) return;
        selectTab('code');
        editor.focus();
        editor.setCursor(errorLine, 0);
    });

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(tab.dataset.tab));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const offset = event.key === 'ArrowRight' ? 1 : -1;
            const next = tabs[(index + offset + tabs.length) % tabs.length];
            selectTab(next.dataset.tab);
            next.focus();
        });
    });
    resetFeedback();
    updateComplete();
    if (landing) {
        showDemo();

        const startLinks = [$('resume-project'), $('chapter-list').querySelector('a')];
        startLinks.forEach(link => link.addEventListener('click', () => {
            const source = editor.getValue();
            if (legacySource || source === demo || source.length > 20000) return;
            try {
                const saved = readDrafts();
                if (!saved['1.1']) {
                    saved['1.1'] = {source: sceneStarter('1.1', source), starter: sceneStarter('1.1', ''), complete: false};
                    localStorage.setItem(storageKey, JSON.stringify(saved));
                }
            } catch {
                // Chapter one remains available if browser storage is blocked.
            }
        }));
        return;
    }

    if (newDraft) {
        dirty = true;
        save();
    }
    if (isPreview(draft.preview)) {
        playing = draft.preview;
        startPreview();
    }

    window.addEventListener('pagehide', save);
    window.addEventListener('pageshow', event => {
        if (event.persisted) location.reload();
    });
    $('back-to-studio').addEventListener('click', event => {
        if (!save()) event.preventDefault();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') save();
    });
});
