document.addEventListener('DOMContentLoaded', function () {
    const $ = id => document.getElementById(id);
    const storageKey = 'novelearn.studio.scene.v1';
    let dirty = false, saveTimer, revision = 0, checkedSource = null, checkedFrames = [], playingFrames = [], frameIndex = 0, errorLine = null, lastError = null, checking = false, errorWidget = null;
    const lesson = $('lesson-details');
    const mobile = matchMedia('(max-width:700px)');
    lesson.open = !mobile.matches;
    function updateLessonLabel(){lesson.querySelector('.lesson-toggle').textContent=mobile.matches?(lesson.open?'−':'+'):(lesson.open?'Свернуть ↑':'Развернуть ↓');}
    lesson.addEventListener('toggle',updateLessonLabel);
    mobile.addEventListener('change',()=>{lesson.open=!mobile.matches;updateLessonLabel();editor.refresh();});
    updateLessonLabel();
    CodeMirror.defineMode('studio-scene', () => ({token(stream) {
        if (stream.eatSpace()) return null;
        if (stream.match(/^#.*/)) return 'comment';
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
        if (stream.match(/^(?:label|scene|show|return)\b/)) return 'keyword';
        stream.next(); return null;
    }}));
    const editor = CodeMirror.fromTextArea($('source'), {mode:'studio-scene',lineNumbers:true,indentUnit:4,tabSize:4,indentWithTabs:false,lineWrapping:true,extraKeys:{Tab:cm=>cm.replaceSelection('    ')}});
    editor.getInputField().setAttribute('aria-label','Код сцены');
    function feedback(title,text,kind='') {
        $('feedback-title').textContent=title; $('feedback-text').textContent=text;
        $('feedback-panel').className='feedback '+kind;
        $('tab-errors').textContent=kind==='error'?'Ошибки · 1':'Ошибки';
        $('error-help').hidden=kind!=='error'; $('error-line').hidden=kind!=='error'||!errorLine;
        $('error-context').hidden=kind!=='error'||!errorLine;
        $('error-context').textContent=kind==='error'&&errorLine?(editor.getValue().split('\n')[errorLine-1]||'').trim():'';
    }
    function save() {
        clearTimeout(saveTimer); if(!dirty)return;
        try {localStorage.setItem(storageKey,JSON.stringify({version:1,source:editor.getValue()}));dirty=false;$('save-status').textContent='Сохранено в браузере';$('autosave').textContent='Автосохранение включено';}
        catch(e){$('save-status').textContent='Не удалось сохранить';$('autosave').textContent='Скопируйте код перед закрытием страницы.';}
    }
    function clearMark(){if(errorLine!==null)editor.removeLineClass(errorLine-1,'background','studio-error-line');if(errorWidget){errorWidget.clear();errorWidget=null;}errorLine=null;}
    editor.on('change',()=>{
        revision++; checkedSource=null; checkedFrames=[]; $('run').disabled=true;clearMark();
        const value=editor.getValue();$('example-overlay').hidden=!!value;
        $('code-footer').textContent=value?value.split('\n').length+' строк · UTF-8':'Пустой проект · Начните с примера';
        if(!checking)feedback('Код изменён','Проверьте текущую версию перед запуском.');
        if(playingFrames.length)$('preview-status').textContent='Последняя рабочая версия';
        dirty=true;$('autosave').textContent='Сохранение…';clearTimeout(saveTimer);saveTimer=setTimeout(save,500);
    });
    $('check').addEventListener('click',async()=>{
        const source=editor.getValue(), requestRevision=revision;checking=true;$('check').disabled=true;$('check').textContent='Проверка…';$('run').disabled=true;clearMark();
        feedback('Проверяем сцену','Проверка команд и структуры…');
        try {
            const csrf=document.cookie.split('; ').find(c=>c.startsWith('csrftoken='))?.split('=')[1]||'';
            const response=await fetch('/studio/check/',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':decodeURIComponent(csrf)},body:JSON.stringify({source})});
            if(!response.ok)throw Error('Проверка недоступна. Попробуйте ещё раз.');
            const result=await response.json();
            if(revision!==requestRevision){feedback('Код изменился во время проверки','Нажмите «Проверить» ещё раз.');return;}
            if(result.ok){checkedSource=source;checkedFrames=result.frames;lastError=null;$('run').disabled=false;feedback('Сцена готова к запуску','Нажмите «Запустить превью», чтобы увидеть сцену.','success');}
            else {checkedSource=null;checkedFrames=[];lastError=result.errors[0];errorLine=lastError.line;editor.addLineClass(errorLine-1,'background','studio-error-line');const inlineError=document.createElement('div');inlineError.className='inline-code-error';inlineError.textContent=lastError.title+'. '+lastError.hint;errorWidget=editor.addLineWidget(errorLine-1,inlineError,{coverGutter:false,noHScroll:true});feedback('Строка '+errorLine+'. '+lastError.title,lastError.hint,'error');$('code-footer').textContent='1 ошибка · Строка '+errorLine;if(playingFrames.length)$('preview-status').textContent='Последняя рабочая версия · ошибка в коде';}
        }catch(e){checkedSource=null;feedback('Не удалось проверить сцену','Проверьте соединение и нажмите «Проверить» ещё раз.','error');}
        finally {checking=false;$('check').disabled=false;$('check').textContent='Проверить';}
    });
    function renderFrame(){const frame=playingFrames[frameIndex];if(!frame)return;const stage=$('stage');stage.style.backgroundImage='url("'+(frame.background==='cozy_room'?stage.dataset.room:stage.dataset.street)+'")';$('preview-empty').hidden=true;$('dialog').hidden=false;$('speaker').textContent=frame.speaker;$('speaker').hidden=!frame.speaker;$('line').textContent=frame.text;$('dialog').scrollTop=0;$('next').hidden=playingFrames.length<2;$('next').textContent=frameIndex===playingFrames.length-1?'Сначала ↺':'Дальше →';$('preview-status').textContent=playingFrames.length>1?'Реплика '+(frameIndex+1)+' из '+playingFrames.length:'Последняя рабочая версия';}
    $('run').addEventListener('click',()=>{if(checkedSource!==editor.getValue()||!checkedFrames.length)return;playingFrames=checkedFrames.map(f=>({...f}));frameIndex=0;renderFrame();if(matchMedia('(max-width:700px)').matches)selectTab('preview');});
    $('next').addEventListener('click',()=>{frameIndex=(frameIndex+1)%playingFrames.length;renderFrame();});
    $('error-line').addEventListener('click',()=>{selectTab('code');editor.focus();editor.setCursor(Math.max(0,(errorLine||1)-1),0);editor.scrollIntoView({line:Math.max(0,(errorLine||1)-1),ch:0},80);});
    function selectTab(name){document.querySelector('.workspace').dataset.active=name;document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});editor.refresh();}
    const tabs=Array.from(document.querySelectorAll('[data-tab]'));
    tabs.forEach((b,i)=>{b.addEventListener('click',()=>selectTab(b.dataset.tab));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];selectTab(next.dataset.tab);next.focus();});});
    $('account-info').addEventListener('click',()=>{$('account-message').hidden=false;});
    $('error-help').addEventListener('click',()=>{$('commands').open=true;});
    try {const raw=localStorage.getItem(storageKey);if(raw!==null){const draft=JSON.parse(raw);if(draft.version!==1||typeof draft.source!=='string'||draft.source.length>20000)throw Error();editor.setValue(draft.source);dirty=false;clearTimeout(saveTimer);$('save-status').textContent='Черновик восстановлен';$('autosave').textContent='Автосохранение включено';}}
    catch(e){$('save-status').textContent='Не удалось открыть черновик';}
    window.addEventListener('pagehide',save);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')save();});
});
