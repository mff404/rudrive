/* =========================================================================
   app.js — логика АРМ: этапы user flow, привязка данных, протокол, экспорт
   ========================================================================= */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const S = window.Sim.S;
  const C = window.Sim.CH;
  const fmt = window.Sim.fmtNum;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

  const UI = {
    view: 1,
    admitted: false,
    saved: false,
    protocolReady: false,
    checkTimer: null,
    stopRunning: false,
    alFilter: 'all',
    selectedAlarm: null,
    lastAlarmSig: '',
    lastEventCount: -1,
    lastActionCount: -1,
    logCount: 0,
    stepIndex: -1,
    charts: {},
    gauges: {},
    chRows: {}
  };

  /* ============================== БАЗА ЗНАНИЙ ПО АВАРИЯМ =================== */
  const KB = {
    i_out: { cause:'Перегрузка по току: короткое замыкание в нагрузке, неисправность силового модуля, несоответствие уставки V/f, заклинивание нагрузки.',
      actions:['Проверить состояние нагрузочного реактора и кабельных соединений','Проконтролировать форму выходного тока и симметрию фаз','Сверить уставку защиты по току с паспортной','При повторном срабатывании — дефектация силовых модулей'] },
    t_igbt: { cause:'Перегрев силовых модулей: снижение расхода охлаждающей жидкости, загрязнение радиаторов, повышение температуры окружающей среды, длительная перегрузка.',
      actions:['Проверить работу насосов и вентиляторов обдува','Проверить расход и температуру охлаждающей жидкости','Очистить радиаторы и воздушные фильтры','Снизить нагрузку до восстановления теплового режима'] },
    t_trans: { cause:'Перегрев вводного трансформатора: превышение нагрузки, ухудшение условий охлаждения, повышенная температура среды.',
      actions:['Проверить принудительную вентиляцию трансформатора','Проверить температуру масла/обмоток по штатным датчикам','Ограничить длительность перегрузки'] },
    t_cool: { cause:'Нагрев охлаждающей жидкости: недостаточный расход, неисправность теплообменника, засорение контура.',
      actions:['Проверить перепад температур на теплообменнике','Проверить расход и давление в контуре','Проверить работу вентиляторов сухой охлаждающей башни'] },
    flow: { cause:'Снижение расхода охлаждающей жидкости: утечка, завоздушивание контура, неисправность насоса, засорение фильтра.',
      actions:['Проверить герметичность контура и уровень жидкости','Удалить воздух из контура','Проверить фильтр и насосный агрегат','При потере расхода — защитное отключение стенда'] },
    press: { cause:'Отклонение давления в контуре охлаждения: утечка, неисправность регулирующего клапана, завоздушивание.',
      actions:['Проверить показания манометров на входе и выходе','Проверить работу подпиточного узла','Проверить настройку предохранительного клапана'] },
    udc: { cause:'Повышение напряжения звена постоянного тока: рекуперация энергии от нагрузки, просадка/всплеск напряжения сети, сбой регулирования.',
      actions:['Проверить работу тормозного прерывателя и резистора','Проконтролировать напряжение питающей сети','Проверить настройки регулятора звена DC'] },
    udc_ripple: { cause:'Увеличение пульсаций звена DC: деградация конденсаторов, несимметрия фаз, неисправность выпрямителя.',
      actions:['Проверить ёмкость и температуру конденсаторной батареи','Проверить симметрию входного напряжения','Выполнить диагностику выпрямительного модуля'] },
    thd: { cause:'Увеличение коэффициента искажений: работа на низкой выходной частоте, резонансные явления в нагрузке, неисправность фильтра.',
      actions:['Проверить настройки ШИМ и частоты коммутации','Проконтролировать спектр выходного напряжения','Проверить состояние выходного синус-фильтра'] },
    cosphi: { cause:'Снижение коэффициента мощности: малая загрузка преобразователя, несимметрия нагрузки.',
      actions:['Увеличить загрузку до номинальной','Проверить симметрию нагрузки по фазам','Проверить настройки регулятора'] },
    efficiency: { cause:'Снижение КПД: рост потерь в силовых модулях и трансформаторе, ухудшение теплового режима, работа вне зоны номинальных параметров.',
      actions:['Сопоставить КПД с паспортной кривой','Проверить тепловой режим и качество охлаждения','Проверить точность измерительных каналов'] },
    aux_u: { cause:'Отклонение напряжения собственных нужд: неисправность источника питания, перегрузка цепи СН.',
      actions:['Проверить ввод собственных нужд и автоматы защиты','Проверить нагрузку цепей СН','Проверить ИБП контроллера'] },
    vibro: { cause:'Повышенная вибрация подшипников мотор-генератора: износ подшипников, разцентровка, ослабление крепления.',
      actions:['Проверить крепление и центровку агрегата','Проконтролировать температуру подшипников','Выполнить вибродиагностику'] },
    estop: { cause:'Ручное отключение оператором (E-STOP).', actions:['Выяснить и устранить причину отключения','Выполнить повторную проверку стенда по чек-листу','Квитировать событие и снять блокировку пуска с разрешения руководителя испытаний'] }
  };
  const AL_SEV = { alarm:{ t:'Авария', s:'АВАРИЯ', c:'st-err' }, warn:{ t:'Предупреждение', s:'ПРЕДУПР.', c:'st-warn' }, info:{ t:'Информация', s:'ИНФО', c:'st-info' } };
  const AL_ST = { active:{ t:'Активно', s:'активно', c:'st-err' }, acked:{ t:'Квитировано', s:'квитир.', c:'st-info' }, cleared:{ t:'Устранено', s:'устранено', c:'st-idle' }, 'cleared-acked':{ t:'Устранено, квитир.', s:'устранено', c:'st-ok' } };

  /* ================================= УТИЛИТЫ ============================== */
  function toast(title, text, kind) {
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.innerHTML = `<b>${esc(title)}</b><span>${esc(text)}</span>`;
    $('#toasts').appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transform = 'translateX(14px)'; d.style.transition = 'all .3s'; }, 4200);
    setTimeout(() => d.remove(), 4600);
  }
  function download(name, text, mime) {
    const blob = new Blob(['\ufeff' + text], { type:(mime || 'text/csv') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function fill(tpl, data) { return tpl.replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : data[k])); }

  /* ============================ НАВИГАЦИЯ ПО ЭТАПАМ ======================= */
  function go(view) {
    UI.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.rail-item').forEach(b => b.classList.toggle('active', +b.dataset.view === view));
    $('#views').scrollTop = 0;
    if (view === 4) ['c-power', 'c-freq', 'c-therm'].forEach(k => UI.charts[k].render(S.hist, S.clock, true));
    if (view === 7) renderAnalysis(true);
  }
  $$('.rail-item').forEach(b => b.addEventListener('click', () => go(+b.dataset.view)));
  $('#ab-goto').addEventListener('click', () => go(5));

  function railState(i, text, done) {
    const el = document.querySelector(`.rail-item[data-view="${i}"]`);
    if (!el) return;
    el.querySelector('[data-state]').textContent = text;
    el.classList.toggle('done', !!done);
  }
  function updateRail() {
    const okChecks = Object.values(S.checks).filter(c => c.result === 'ok').length;
    railState(1, UI.admitted ? 'стенд допущен' : `проверок: ${okChecks}/${Sim.CHECKS.length}`, UI.admitted);
    railState(2, S.startedAt ? 'профиль запущен' : (UI.admitted ? 'готово к пуску' : 'ожидает допуска'), !!S.startedAt);
    railState(3, S.state === 'running' ? 'выполняется' : S.state === 'paused' ? 'пауза' :
      (S.state === 'done' ? 'программа завершена' : (S.startedAt ? 'остановлено' : 'не начато')), S.state === 'done');
    railState(4, S.startedAt ? `точек: ${S.hist.t.length}` : 'нет данных', S.hist.t.length > 100);
    const nAct = S.alarms.filter(a => a.state === 'active').length;
    railState(5, nAct ? `активных: ${nAct}` : 'событий нет', S.alarms.length > 0);
    railState(6, UI.saved ? 'испытание сохранено' : (S.state === 'done' ? 'требуется сохранение' : 'не начато'), UI.saved);
    railState(7, UI.protocolReady ? 'протокол сформирован' : (S.result ? 'готово к анализу' : 'нет результатов'), UI.protocolReady);
  }

  /* ============================== ЭТАП 1: ПРОВЕРКИ ======================== */
  const CHK_TPL = `
    <div class="ci" data-id="{id}">
      <div class="ci-ico">{ico}</div>
      <div class="ci-body">
        <div class="ci-title">{title}</div>
        <div class="ci-meta">{hint}</div>
      </div>
      <button class="ci-btn" data-run="{id}">{btn}</button>
    </div>`;
  function buildChecklist() {
    $('#checklist').innerHTML = Sim.CHECKS.map((c, i) => fill(CHK_TPL, {
      id:c.id, title:c.title, hint:c.hint + ' · ' + (c.kind === 'ask' ? 'подтверждение оператора' : 'автоматический тест'),
      ico:String(i + 1), btn:c.kind === 'ask' ? 'Подтвердить' : 'Выполнить'
    })).join('');
    $('#ready-total').textContent = Sim.CHECKS.length;
    $$('#checklist [data-run]').forEach(b => b.addEventListener('click', () => runCheck(b.dataset.run)));
    refreshChecks();
  }
  function runCheck(id, silent) {
    const def = Sim.CHECKS.find(c => c.id === id);
    const row = document.querySelector(`.ci[data-id="${id}"]`);
    if (!row || row.classList.contains('run')) return;
    const btn = row.querySelector('.ci-btn');
    row.classList.add('run'); btn.disabled = true; btn.textContent = def.kind === 'ask' ? '…' : 'измерение…';
    const finishIt = () => {
      const raw = typeof def.value === 'function' ? def.value() : 'выполнено';
      const res = { id, result:'ok', raw, text:(typeof raw === 'number' ? fmt(raw, def.dec) + ' ' + (def.unit || '') : String(raw)), time:Sim.nowStr() };
      Sim.setCheck(id, res);
      applyCheckRow(def, res);
      Sim.log(`Проверка «${def.title}»: ${def.kind === 'ask' ? 'подтверждено оператором' : res.text}`, 'ok');
      refreshChecks();
      if (!silent) toast('Проверка пройдена', def.title + ' — ' + (res.text || 'выполнено'), 'ok');
    };
    setTimeout(finishIt, def.kind === 'ask' ? 320 : 700 + Math.random() * 700);
  }
  // визуальная отметка выполненной проверки в чек-листе
  function applyCheckRow(def, res) {
    const row = document.querySelector(`.ci[data-id="${def.id}"]`);
    if (!row) return;
    row.classList.remove('run'); row.classList.add('ok');
    row.querySelector('.ci-ico').textContent = '✓';
    row.querySelector('.ci-meta').textContent = (def.kind === 'ask' ? 'подтверждено оператором' : res.text) +
      ' · ' + (def.norm ? 'норма ' + def.norm : 'норма выполнена');
    const btn = row.querySelector('.ci-btn');
    btn.textContent = 'выполнено'; btn.disabled = true;
  }
  function refreshChecks() {
    const ids = Object.keys(S.checks);
    const done = ids.filter(k => S.checks[k].result === 'ok').length;
    $('#ready-done').textContent = done;
    $('#ready-fill').style.width = (done / Sim.CHECKS.length * 100) + '%';
    const all = done === Sim.CHECKS.length;
    $('#btn-ready').disabled = !all || UI.admitted;
    $('#btn-ready').textContent = UI.admitted ? 'Стенд допущен к испытанию' : 'Допустить стенд к испытанию';
    $('#ready-note').textContent = all
      ? (UI.admitted ? 'Стенд допущен. Перейдите к настройке испытания.' : 'Все проверки пройдены — подтвердите допуск стенда')
      : 'Выполнено проверок: ' + done + ' из ' + Sim.CHECKS.length;
    $('#v2-ready').textContent = UI.admitted ? 'да' : 'нет';
    updateRail();
  }
  $('#btn-check-all').addEventListener('click', () => {
    Sim.CHECKS.forEach((c, i) => setTimeout(() => runCheck(c.id, true), i * 340));
    setTimeout(() => toast('Проверки запущены', 'Автоматические тесты выполняются последовательно', 'ok'), 100);
  });
  $('#btn-check-reset').addEventListener('click', () => {
    if (UI.admitted) return toast('Допуск уже подтверждён', 'Сброс проверок недоступен после допуска стенда', 'warn');
    S.checks = {};
    buildChecklist();
    Sim.log('Результаты предпусковых проверок сброшены', 'info');
  });
  $('#btn-ready').addEventListener('click', () => {
    UI.admitted = true;
    refreshChecks();
    Sim.log('Стенд допущен к испытанию. Ограничения сняты, силовой тракт готов к подаче напряжения.', 'ok');
    toast('Стенд допущен', 'Можно переходить к настройке и запуску испытания', 'ok');
    go(2);
  });

  /* ============================== ЭТАП 2: НАСТРОЙКА ====================== */
  let steps = [];

  function loadProgram(id) {
    const p = Sim.PROGRAMS.find(x => x.id === id) || Sim.PROGRAMS[0];
    Sim.setProgram(p.id);
    steps = p.steps.map(s => s.slice());
    // программы с особым режимом (перегрузка, проверка защит) требуют своих уставок защиты
    if (p.settings) {
      if (p.settings.iwarn) $('#f-iwarn').value = p.settings.iwarn;
      if (p.settings.itrip) $('#f-itrip').value = p.settings.itrip;
      if (p.settings.note) Sim.log(`${p.code}: ${p.settings.note}`, 'warn');
    }
    renderProfile();
    $$('.pc').forEach(c => c.classList.toggle('active', c.dataset.prog === id));
    Sim.log(`Выбрана программа испытаний ${p.code} «${p.name}» (${p.norm})`, 'act');
  }
  function buildPrograms() {
    $('#prog-cards').innerHTML = Sim.PROGRAMS.map(p => `
      <button class="pc" data-prog="${p.id}">
        <span class="pc-ico">${p.code.slice(-1)}</span>
        <span>
          <span class="pc-title">${esc(p.code)} · ${esc(p.name)}</span>
          <span class="pc-desc">${esc(p.desc)}</span>
          <span class="pc-meta"><span>ступеней: ${p.steps.length}</span><span>длительность: ${p.steps.reduce((a, s) => a + s[3], 0)} с</span><span>${esc(p.norm)}</span></span>
        </span>
      </button>`).join('');
    $$('.pc').forEach(c => c.addEventListener('click', () => loadProgram(c.dataset.prog)));
  }
  function renderProfile() {
    $('#profile-body').innerHTML = steps.map((s, i) => `
      <tr data-i="${i}">
        <td>${i + 1}</td>
        <td><input type="number" data-k="0" value="${s[0]}" min="0" max="100" step="5"></td>
        <td><input type="number" data-k="1" value="${s[1]}" min="0" max="100" step="5"></td>
        <td><input type="number" data-k="2" value="${s[2]}" min="0" max="200" step="5"></td>
        <td><input type="number" data-k="3" value="${s[3]}" min="1" max="600" step="1"></td>
      </tr>`).join('');
    $$('#profile-body input').forEach(inp => inp.addEventListener('change', e => {
      const tr = e.target.closest('tr'), i = +tr.dataset.i, k = +e.target.dataset.k;
      steps[i][k] = Math.max(0, +e.target.value || 0);
      if (k === 3) steps[i][3] = Math.max(1, steps[i][3]);
      validate();
      drawProfileChart();
    }));
    $('#prof-total').textContent = steps.reduce((a, s) => a + s[3], 0);
    $('#prof-count').textContent = steps.length;
    validate();
    drawProfileChart();
  }
  function drawProfileChart() {
    if (!UI.charts.profile) return;
    const cur = S.startedAt && (S.state === 'running' || S.state === 'paused') ? Sim.stepPosition().index : -1;
    UI.charts.profile.render(steps, cur, S.t);
  }
  function validate() {
    const st = readSettings();
    const msgs = [];
    let total = steps.reduce((a, s) => a + s[3], 0);
    if (!steps.length) msgs.push(['err', 'Профиль пуст: добавьте хотя бы одну ступень']);
    steps.forEach((s, i) => {
      if (s[0] > 100 || s[1] > 100) msgs.push(['err', `Ступень ${i + 1}: задание частоты или напряжения выше 100 %`]);
      if (s[1] > 0 && s[0] === 0) msgs.push(['warn', `Ступень ${i + 1}: задано напряжение при нулевой частоте`]);
      if (s[2] > 100) msgs.push(['warn', `Ступень ${i + 1}: нагрузка ${s[2]} % — режим перегрузки, ожидается срабатывание защиты`]);
    });
    if (st.iwarn >= st.itrip) msgs.push(['err', 'Порог предупреждения по току не может быть выше порога аварии']);
    if (st.twarn >= st.ttrip) msgs.push(['err', 'Порог предупреждения по температуре выше порога аварии']);
    if (st.itrip > st.inom * 1.25) msgs.push(['warn', `Уставка аварии по току ${st.itrip} А превышает 1,25 Iн (${(st.inom * 1.25).toFixed(0)} А)`]);
    if (total < 10) msgs.push(['warn', 'Суммарная длительность профиля меньше 10 с']);
    if (total > 900) msgs.push(['warn', 'Суммарная длительность более 15 мин — проверьте программу']);
    if (!msgs.length) msgs.push(['ok', `Профиль корректен: ${steps.length} ступеней, ${total} с, максимальный ток ${Math.max.apply(null, steps.map(s => s[2] / 100 * st.inom)).toFixed(0)} А`]);
    if (!UI.admitted) msgs.push(['warn', 'Стенд не допущен к испытанию — выполните проверки на этапе 1']);
    $('#valid-list').innerHTML = msgs.map(m => `<div class="vl ${m[0]}"><span class="vl-ico">${m[0] === 'ok' ? '✓' : m[0] === 'warn' ? '!' : '✕'}</span><span>${esc(m[1])}</span></div>`).join('');
    return msgs;
  }
  function readSettings() {
    const num = id => parseFloat($(id).value) || 0;
    return {
      unom:num('#f-unom'), fnom:num('#f-fnom'), inom:num('#f-inom'),
      iwarn:num('#f-iwarn'), itrip:num('#f-itrip'), twarn:num('#f-twarn'), ttrip:num('#f-ttrip'),
      ramp:num('#f-ramp'), hold:num('#f-hold'), cycles:num('#f-cycles'),
      loadmode:$('#f-loadmode').value, loadtype:$('#f-loadtype').value,
      operator:$('#s-operator').value
    };
  }
  $$('.form-grid input, .form-grid select').forEach(el => el.addEventListener('change', () => { validate(); drawProfileChart(); }));
  $('#btn-add-step').addEventListener('click', () => {
    const last = steps[steps.length - 1] || [100, 100, 100, 10];
    steps.push([last[0], last[1], last[2], 10]);
    renderProfile();
  });
  $('#btn-del-step').addEventListener('click', () => { if (steps.length > 1) { steps.pop(); renderProfile(); } });
  $('#btn-save-profile').addEventListener('click', () => {
    const msgs = validate();
    if (msgs.some(m => m[0] === 'err')) return toast('Профиль не сохранён', 'Устраните ошибки в уставках', 'err');
    toast('Профиль сохранён', `Ступеней: ${steps.length}, длительность ${steps.reduce((a, s) => a + s[3], 0)} с`, 'ok');
    Sim.log(`Профиль испытания сохранён (${steps.length} ступеней, ${steps.reduce((a, s) => a + s[3], 0)} с)`, 'act');
  });

  /* --------------------------- МОДАЛЬНОЕ ОКНО ПУСКА ---------------------- */
  const mstAck = ['#mst-ack-zone', '#mst-ack-doors', '#mst-ack-cool', '#mst-ack-host'];
  function mstRefresh() {
    $('#mst-confirm').disabled = !mstAck.every(s => $(s).checked);
  }
  mstAck.forEach(s => $(s).addEventListener('change', mstRefresh));
  $('#btn-start').addEventListener('click', () => {
    const msgs = validate();
    if (!UI.admitted) { toast('Стенд не допущен', 'Выполните предпусковые проверки на этапе 1', 'err'); return go(1); }
    if (msgs.some(m => m[0] === 'err')) { toast('Пуск заблокирован', 'Устраните ошибки в профиле и уставках', 'err'); return; }
    const st = readSettings();
    const total = steps.reduce((a, s) => a + s[3], 0);
    const p = Sim.PROGRAMS.find(x => x.id === (S.program ? S.program.id : 'psi1'));
    $('#mst-summary').innerHTML = [
      ['Программа', p.code + ' · ' + p.name],
      ['Ступеней / длительность', steps.length + ' / ' + total + ' с'],
      ['Номинальные параметры', st.unom + ' кВ, ' + st.fnom + ' Гц, ' + st.inom + ' А'],
      ['Максимальная нагрузка', Math.max.apply(null, steps.map(s => s[2])) + ' % (' + (Math.max.apply(null, steps.map(s => s[2])) / 100 * st.inom).toFixed(0) + ' А)'],
      ['Защита по току', 'предупр. ' + st.iwarn + ' А / авария ' + st.itrip + ' А'],
      ['Защита по температуре', 'предупр. ' + st.twarn + ' °C / авария ' + st.ttrip + ' °C'],
      ['Режим', 'автоматический, ' + st.loadmode],
      ['Нагрузка', st.loadtype]
    ].map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('');
    mstAck.forEach(s => { $(s).checked = false; });
    mstRefresh();
    $('#modal-start').hidden = false;
  });
  const closeModal = () => { $('#modal-start').hidden = true; };
  $('#mst-cancel').addEventListener('click', closeModal);
  $('#mst-cancel-x').addEventListener('click', closeModal);
  $('#modal-start').addEventListener('click', e => { if (e.target.id === 'modal-start') closeModal(); });
  $('#mst-confirm').addEventListener('click', () => {
    closeModal();
    const st = readSettings();
    st.operator = $('#mst-operator').value || 'Иванов А. П.';
    Sim.start(st, steps, S.program ? S.program.id : 'psi1');
    UI.logCount = 0;
    toast('Испытание запущено', 'Программа ' + S.program.code + ' выполняется в автоматическом режиме', 'ok');
    go(3);
  });

  /* ============================ ЭТАП 3: АВТОРЕЖИМ ======================== */
  function runStateClass() {
    if (S.state === 'running') return 'run';
    if (S.state === 'paused') return 'pause';
    if (S.state === 'tripping' || S.state === 'estop' || S.state === 'done' && S.stats.trips) return 'err';
    return '';
  }
  function renderRun() {
    const total = Sim.totalDuration();
    const pos = Sim.stepPosition();
    const rs = $('#run-state');
    rs.className = 'run-state ' + runStateClass();
    rs.querySelector('b').textContent = S.stateText;
    $('#run-prog').textContent = S.program ? S.program.code + ' · ' + S.program.name : '—';
    $('#run-prog-sub').textContent = S.program ? S.program.norm : 'не выбрана';
    $('#run-step').textContent = S.steps.length && (S.state === 'running' || S.state === 'paused' || S.state === 'done') ? (Math.max(0, pos.index) + 1) : '—';
    $('#run-step-total').textContent = S.steps.length ? '/ ' + S.steps.length : '';
    const cur = S.steps[pos.index];
    $('#run-step-desc').textContent = cur ? `f = ${cur[0]} % · U = ${cur[1]} % · нагрузка ${cur[2]} % · выдержка ${cur[3]} с` : 'профиль не запущен';
    $('#run-time').textContent = Sim.timeStr(S.t);
    $('#run-remaining').textContent = S.stepIndex >= 0 || S.state === 'running' ? Sim.timeStr(Math.max(0, total - S.t)) : '--:--';
    $('#run-setpoint').textContent = fmt(S.sp.f, 1) + ' Гц · ' + fmt(S.sp.u, 2) + ' кВ';
    $('#run-actual').textContent = fmt(S.P.f_out, 1) + ' Гц · ' + fmt(S.P.u_out, 2) + ' кВ';
    $('#run-actions').textContent = S.actions.length;
    $('#run-devs').textContent = Math.round(S.stats.deviations / 10);
    const pr = total ? Math.min(100, S.t / total * 100) : 0;
    $('#run-progress').style.width = pr.toFixed(1) + '%';
    $('#run-progress-text').textContent = pr.toFixed(1).replace('.', ',') + ' %';
    $('#run-progress-hint').textContent = S.state === 'running' ? `выполняется ступень ${Math.max(0, pos.index) + 1} из ${S.steps.length}`
      : S.state === 'paused' ? 'пауза — задание удерживается'
      : S.state === 'done' ? (S.finishedReason === 'completed' ? 'программа выполнена' : 'испытание остановлено')
      : S.state === 'tripping' ? 'аварийное отключение, сброс параметров'
      : S.state === 'estop' ? 'аварийный останов по E-STOP' : 'ожидание пуска';
    $('#btn-pause').disabled = !(S.state === 'running' || S.state === 'paused');
    $('#btn-pause').textContent = S.state === 'paused' ? '▶ Продолжить' : '⏸ Пауза';
    $('#btn-stop-run').disabled = !(S.state === 'running' || S.state === 'paused');
    $('#steps-state').textContent = S.state === 'running' ? 'выполняется' : S.state === 'done' ? 'завершено' : 'ожидание';
    renderSteps(S.startedAt ? pos.index : -1);
    renderAutoLog();
    renderAutoActions();
  }
  function renderSteps(idx) {
    if (UI.stepIndex === idx && $('#step-list').childElementCount === steps.length) return;
    UI.stepIndex = idx;
    $('#step-list').innerHTML = S.steps.map((s, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'cur' : '';
      return `<div class="step ${cls}">
        <div class="st-ico">${i < idx ? '✓' : i + 1}</div>
        <div class="st-body">
          <div class="st-title">Ступень ${i + 1}: f ${s[0]} % · U ${s[1]} % · нагрузка ${s[2]} %</div>
          <div class="st-meta">выдержка ${s[3]} с · ${(S.settings.fnom || 50) * s[0] / 100 | 0} Гц · ${fmt((S.settings.unom || 6) * s[1] / 100, 2)} кВ</div>
        </div>
        <div class="st-bar"><i style="width:${i < idx ? 100 : i === idx ? '60' : 0}%"></i></div>
      </div>`;
    }).join('');
  }
  function renderAutoLog() {
    if (UI.logCount === S.events.length && $('#auto-log').childElementCount) return;
    UI.logCount = S.events.length;
    const list = S.events.slice(0, 60).map(e => `<div class="log-row sev-${e.sev === 'err' ? 'err' : e.sev === 'warn' ? 'warn' : e.sev === 'ok' ? 'ok' : 'act'}"><span class="lr-t">${e.t}</span><span class="lr-txt">${esc(e.text)}</span></div>`).join('');
    $('#auto-log').innerHTML = list || '<div class="empty-sm">Журнал пуст</div>';
  }
  function renderAutoActions() {
    if (UI.lastActionCount === S.actions.length) return;
    UI.lastActionCount = S.actions.length;
    $('#auto-actions').innerHTML = S.actions.slice(0, 8).map(a => `
      <div class="aa act">
        <div class="aa-t"><span>${esc(a.title)}</span><span class="muted mono">${a.t}</span></div>
        <div class="aa-d">${esc(a.desc)}</div>
        <div class="aa-n">действий: ${a.count}</div>
      </div>`).join('') || '<div class="empty-sm">Автоматических воздействий не было</div>';
  }
  $('#btn-pause').addEventListener('click', () => { S.state === 'paused' ? Sim.resume() : Sim.pause(); });
  $('#btn-stop-run').addEventListener('click', () => { Sim.normalStop(); toast('Штатный останов', 'Нагрузка снята, стенд выведен на нулевые параметры', 'warn'); });
  $('#btn-estop2').addEventListener('click', () => doEstop());
  $('#btn-estop').addEventListener('click', () => doEstop());
  function doEstop() {
    if (S.state === 'idle' && !S.startedAt) return toast('Стенд обесточен', 'Аварийный останов недоступен — стенд не под напряжением', 'warn');
    Sim.estop();
    toast('АВАРИЙНЫЙ ОСТАНОВ', 'Силовой тракт отключён, импульсы ШИМ сняты, звено DC разряжается', 'err');
    go(5);
  }

  /* =========================== ЭТАП 4: МОНИТОРИНГ ======================== */
  const MINI = ['u_out', 'i_out', 'f_out', 'p_out', 'cosphi', 't_igbt', 'udc', 'thd', 'efficiency'];
  const MINI_MAX = { u_out:7.2, i_out:300, f_out:60, p_out:2.5, cosphi:1, t_igbt:120, udc:10.5, thd:8, efficiency:100 };

  function buildMonitor() {
    // приборы
    const g = (id, cfg) => { UI.gauges[id] = new Charts.Gauge(document.getElementById(id), cfg); };
    g('g-u', { min:0, max:7.2, dec:2, unit:'кВ', color:'#29b6f6' });
    g('g-i', { min:0, max:300, dec:0, unit:'А', warn:210, alarm:240, color:'#f5a524' });
    g('g-f', { min:0, max:60, dec:1, unit:'Гц', color:'#37d67a' });
    g('g-p', { min:0, max:2.5, dec:2, unit:'МВт', warn:2.1, alarm:2.3, color:'#a78bfa' });
    g('g-cos', { min:0, max:1, dec:3, unit:'', warn:0.87, alarm:0.82, low:true, color:'#8ce99a' });
    g('g-t', { min:0, max:120, dec:0, unit:'°C', warn:70, alarm:85, color:'#ff6b6b' });

    // тренды
    const lc = (id, cfg) => { UI.charts[id] = new Charts.LineChart(document.getElementById(id), cfg); };
    lc('c-power', { dec:1, window:120, area:false, refs:[{ v:210 * 0.03, color:'#f5a524', label:'I предупр. 210 А' }, { v:240 * 0.03, color:'#ff4d4f', label:'I авария 240 А' }],
      series:[{ key:'u_out', color:'#29b6f6', label:'U вых', unit:'кВ', dec:2, k:1 },
              { key:'i_out', color:'#f5a524', label:'I вых', unit:'А', dec:0, k:0.03 }] });
    lc('c-freq', { dec:1, window:120, area:false, refs:[{ v:50, color:'#37d67a', label:'f ном. 50 Гц' }],
      series:[{ key:'f_out', color:'#37d67a', label:'f вых', unit:'Гц', dec:2, k:1 },
              { key:'udc', color:'#4dd0e1', label:'U звена DC', unit:'кВ', dec:2, k:6 }] });
    lc('c-therm', { dec:0, window:120, area:false, refs:[{ v:70, color:'#f5a524', label:'предупр. 70 °C' }, { v:85, color:'#ff4d4f', label:'авария 85 °C' }],
      series:[{ key:'t_igbt', color:'#ff6b6b', label:'T IGBT', unit:'°C', dec:1 },
              { key:'t_trans', color:'#ffa94d', label:'T трансф.', unit:'°C', dec:1 },
              { key:'t_cool', color:'#63e6be', label:'T жидкости', unit:'°C', dec:1 },
              { key:'t_amb', color:'#8fa3b8', label:'T среды', unit:'°C', dec:1 }] });
    lc('c-full', { dec:1, window:null, area:false, minInterval:500,
      series:[{ key:'u_out', color:'#29b6f6', label:'U вых', unit:'кВ', dec:2, k:1 },
              { key:'f_out', color:'#37d67a', label:'f вых', unit:'Гц', dec:1, k:0.12 },
              { key:'p_out', color:'#a78bfa', label:'P вых', unit:'МВт', dec:2, k:2.5 }] });
    UI.charts.wave = new Charts.Waveform($('#c-wave'));
    UI.charts.harm = new Charts.Harmonics($('#c-harm'));
    UI.charts.profile = new Charts.ProfileChart($('#profile-canvas'));

    // правая панель
    $('#mini-params').innerHTML = MINI.map(k => `
      <div class="mp" data-k="${k}">
        <span class="mp-name">${esc(C[k].name)}, ${esc(C[k].unit)}</span>
        <span class="mp-val">—</span>
        <span class="mp-bar"><i style="width:0%"></i></span>
      </div>`).join('');
    // таблица каналов
    $('#ch-body').innerHTML = Sim.CHANNELS.map(c => {
      const w = c.warn === undefined ? '—' : fmt(c.warn, c.dec) + (c.unit ? ' ' + c.unit : '');
      const a = c.alarm === undefined ? '—' : fmt(c.alarm, c.dec) + (c.unit ? ' ' + c.unit : '');
      return `<tr data-k="${c.key}">
        <td>${esc(c.name)}${c.unit ? ', ' + esc(c.unit) : ''}</td>
        <td class="num v">—</td><td class="num mn">—</td><td class="num mx">—</td><td class="num av">—</td>
        <td class="num">${w}</td><td class="num">${a}</td>
        <td class="st"><span class="st-pill st-idle">нет данных</span></td>
      </tr>`;
    }).join('');
    Sim.CHANNELS.forEach(c => {
      const tr = document.querySelector(`#ch-body tr[data-k="${c.key}"]`);
      UI.chRows[c.key] = { v:tr.querySelector('.v'), mn:tr.querySelector('.mn'), mx:tr.querySelector('.mx'), av:tr.querySelector('.av'), st:tr.querySelector('.st') };
    });
  }

  function renderMonitor(force) {
    MINI.forEach(k => {
      const row = document.querySelector(`#mini-params [data-k="${k}"]`);
      if (!row) return;
      const v = S.P[k] || 0, c = C[k];
      const el = row.querySelector('.mp-val'), bar = row.querySelector('.mp-bar i');
      el.textContent = fmt(v, c.dec);
      const bad = c.alarm !== undefined && (c.low ? v <= c.alarm : v >= c.alarm);
      const wrn = !bad && c.warn !== undefined && (c.low ? v <= c.warn : v >= c.warn);
      el.className = 'mp-val' + (bad ? ' err' : wrn ? ' warn' : '');
      bar.className = bad ? 'err' : wrn ? 'warn' : '';
      bar.style.width = Math.max(0, Math.min(100, (v / (MINI_MAX[k] || 100)) * 100)) + '%';
    });
    Object.keys(UI.gauges).forEach(id => {
      const key = { 'g-u':'u_out', 'g-i':'i_out', 'g-f':'f_out', 'g-p':'p_out', 'g-cos':'cosphi', 'g-t':'t_igbt' }[id];
      UI.gauges[id].render(S.P[key] || 0);
    });
    if (UI.view === 4 || force) {
      UI.charts['c-power'].render(S.hist, S.clock);
      UI.charts['c-freq'].render(S.hist, S.clock);
      UI.charts['c-therm'].render(S.hist, S.clock);
      UI.charts.wave.render(S.P.u_out, S.P.f_out, S.P.thd, { phase:(performance.now() / 1000 * 2.2) % 6.283 });
      UI.charts.harm.render(S.P.thd);
      $('#thd-val').textContent = fmt(S.P.thd, 2);
      $('#pt-count').textContent = S.hist.t.length;
      $('#ch-state').textContent = S.hist.t.length ? 'обновлено ' + Sim.nowStr() : 'нет данных';
      // таблица каналов
      Sim.CHANNELS.forEach(c => {
        const r = UI.chRows[c.key];
        const st = Sim.stats(c.key);
        if (!st) return;
        r.v.textContent = fmt(S.P[c.key], c.dec);
        r.mn.textContent = fmt(st.min, c.dec);
        r.mx.textContent = fmt(st.max, c.dec);
        r.av.textContent = fmt(st.avg, c.dec);
        const bad = c.alarm !== undefined && (c.low ? st.min <= c.alarm : st.max >= c.alarm);
        const wrn = c.warn !== undefined && (c.low ? st.min <= c.warn : st.max >= c.warn);
        r.st.innerHTML = bad ? '<span class="st-pill st-err">авария</span>' : wrn ? '<span class="st-pill st-warn">предупреждение</span>' : '<span class="st-pill st-ok">норма</span>';
      });
    }
  }

  /* ============================= ЭТАП 5: АВАРИИ ========================== */
  function alarmSig() {
    return S.alarms.length + '|' + S.alarms.filter(a => a.state === 'active').length + '|' + (S.alarms[0] ? S.alarms[0].id + S.alarms[0].state : '');
  }
  function filteredAlarms() {
    const f = UI.alFilter;
    return S.alarms.filter(a => f === 'all' ? true : f === 'active' ? (a.state === 'active' || a.state === 'cleared') : a.sev === f);
  }
  function renderAlarms(force) {
    const sig = alarmSig() + UI.alFilter;
    if (!force && sig === UI.lastAlarmSig) return;
    UI.lastAlarmSig = sig;
    const list = filteredAlarms();
    $('#alarm-body').innerHTML = list.map(a => {
      const sv = AL_SEV[a.sev], st = AL_ST[a.state] || AL_ST.active;
      return `<tr data-id="${a.id}" class="${a.state === 'active' ? 'al-row-new' : ''}">
        <td class="mono">${a.t}</td>
        <td class="mono">${esc(a.code)}</td>
        <td><span class="st-pill ${sv.c}">${sv.s}</span></td>
        <td>${esc(a.name)}</td>
        <td class="num">${typeof a.value === 'number' ? fmt(a.value, a.dec) : esc(a.value)} ${esc(a.unit)}</td>
        <td class="num">${typeof a.limit === 'number' ? fmt(a.limit, a.dec) : esc(a.limit)}</td>
        <td><span class="st-pill ${st.c}">${st.s}</span></td>
        <td>${a.state === 'active' || a.state === 'cleared' ? `<button class="btn ghost sm" data-ack="${a.id}" title="Квитировать событие">✓</button>` : ''}</td>
      </tr>`;
    }).join('');
    $('#alarm-empty').hidden = list.length > 0;
    $$('#alarm-body [data-ack]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); Sim.ack(b.dataset.ack); }));
    $$('#alarm-body tr').forEach(tr => tr.addEventListener('click', () => selectAlarm(tr.dataset.id)));
    $('#al-shown').textContent = list.length;
    $('#al-total').textContent = S.alarms.length;
    const cnt = sev => S.alarms.filter(a => a.sev === sev).length;
    $('#cnt-alarm').textContent = cnt('alarm');
    $('#cnt-warn').textContent = cnt('warn');
    $('#cnt-info').textContent = cnt('info');
    renderSideAlarms();
    updateBanner();
  }
  function selectAlarm(id) {
    const a = S.alarms.find(x => x.id === id);
    if (!a) return;
    UI.selectedAlarm = id;
    const kb = KB[a.key] || {};
    const acts = a.actions || kb.actions || ['Действия не заданы'];
    const st = AL_ST[a.state] || AL_ST.active;
    $('#alarm-detail').className = 'detail';
    $('#alarm-detail').innerHTML = `
      <div class="d-head">
        <div>
          <div class="d-code">${esc(a.code)} · ${esc(a.source)}</div>
          <div class="d-title">${esc(a.name)}</div>
        </div>
        <span class="st-pill ${st.c}">${st.t}</span>
      </div>
      <div class="d-grid">
        <span>Уровень</span><b>${AL_SEV[a.sev].t}</b>
        <span>Время фиксации</span><b>${a.t} (T+${Sim.timeStr(a.clock)})</b>
        <span>Измеренное значение</span><b>${typeof a.value === 'number' ? fmt(a.value, a.dec) : esc(a.value)} ${esc(a.unit)}</b>
        <span>Уставка</span><b>${typeof a.limit === 'number' ? fmt(a.limit, a.dec) : esc(a.limit)} ${esc(a.unit)}</b>
        <span>Канал / датчик</span><b>${esc(a.key)}</b>
      </div>
      <div class="d-sec"><h4>Возможные причины</h4><ul class="d-list">${String(a.cause || kb.cause || 'Причина не классифицирована').split('; ').map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
      <div class="d-sec"><h4>Рекомендуемые действия</h4><ul class="d-list">${acts.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
      <div class="d-note">Все события и действия оператора фиксируются в журнале испытания и включаются в протокол. Квитирование не устраняет причину — оно подтверждает ознакомление оператора.</div>
      ${a.state === 'active' || a.state === 'cleared' ? `<button class="btn primary" data-ack2="${a.id}">Квитировать событие</button>` : '<div class="cf-note">Событие квитировано</div>'}`;
    const b = $('#alarm-detail [data-ack2]');
    if (b) b.addEventListener('click', () => { Sim.ack(id); selectAlarm(id); });
  }
  function renderSideAlarms() {
    const list = S.alarms.slice(0, 6);
    const active = S.alarms.filter(a => a.state === 'active').length;
    $('#side-al-badge').textContent = active;
    $('#side-al-badge').className = 'al-badge' + (active ? '' : ' zero');
    $('#chip-alarm-n').textContent = active;
    $('#chip-alarms').hidden = !S.alarms.some(a => a.sev === 'alarm' && a.state !== 'acked' && a.state !== 'cleared-acked');
    $('#side-alarms').innerHTML = list.map(a => {
      const acked = a.state === 'acked' || a.state === 'cleared-acked';
      const tag = a.state === 'active' && !acked ? '<span class="sa-tag on">активно</span>'
        : a.state === 'cleared' ? '<span class="sa-tag off">устранено</span>'
        : '<span class="sa-tag ack">квитировано</span>';
      return `<div class="sa ${a.sev === 'alarm' ? 'err' : 'warn'}" data-id="${a.id}">
        <div class="sa-top"><span>${a.code}</span><span>${tag}</span><span>${a.t}</span></div>
        <div class="sa-txt">${esc(a.name)}</div>
        <div class="sa-val">${typeof a.value === 'number' ? fmt(a.value, a.dec) : esc(a.value)} ${esc(a.unit)} · уставка ${typeof a.limit === 'number' ? fmt(a.limit, a.dec) : esc(a.limit)}</div>
      </div>`;
    }).join('') || '<div class="empty-sm">Аварий и предупреждений нет</div>';
    $$('#side-alarms .sa').forEach(el => el.addEventListener('click', () => { go(5); selectAlarm(el.dataset.id); }));
  }
  function updateBanner() {
    const crit = S.alarms.find(a => a.sev === 'alarm' && a.state === 'active') || S.alarms.find(a => a.sev === 'alarm' && a.state === 'cleared');
    const warn = S.alarms.find(a => a.sev === 'warn' && a.state === 'active');
    const a = crit || warn;
    const bar = $('#alarm-banner');
    if (!a) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.classList.toggle('warn', !crit);
    $('#ab-title').textContent = crit ? 'АВАРИЯ · ' + a.code : 'ПРЕДУПРЕЖДЕНИЕ · ' + a.code;
    $('#ab-desc').textContent = `${a.name}: ${typeof a.value === 'number' ? fmt(a.value, a.dec) : a.value} ${a.unit} при уставке ${typeof a.limit === 'number' ? fmt(a.limit, a.dec) : a.limit} ${a.unit}`;
    $('#ab-time').textContent = a.t;
  }
  $$('#al-filter .chip-btn').forEach(b => b.addEventListener('click', () => {
    UI.alFilter = b.dataset.alfilter;
    $$('#al-filter .chip-btn').forEach(x => x.classList.toggle('active', x === b));
    renderAlarms(true);
  }));
  $('#btn-ack-all').addEventListener('click', () => {
    const n = Sim.ackAll();
    renderAlarms(true);
    if (n) toast('События квитированы', 'Квитировано записей: ' + n, 'ok');
  });
  $('#btn-alarm-export').addEventListener('click', () => { download(`journal_${ts()}.csv`, Sim.csvLog()); toast('Журнал выгружен', 'Файл CSV сохранён', 'ok'); });
  $('#ab-ack').addEventListener('click', () => { Sim.ackAll(); renderAlarms(true); });
  $('#btn-inject-warn').addEventListener('click', () => {
    Sim.raiseAlarm('t_igbt', 'warn', 73.4, 70, { latch:true });
    renderAlarms(true); toast('Смоделировано предупреждение', 'T модулей IGBT 73,4 °C (уставка 70 °C) — удерживается до квитирования', 'warn');
  });
  $('#btn-inject-alarm').addEventListener('click', () => {
    Sim.raiseAlarm('vibro', 'alarm', 7.8, 7.1, { latch:true });
    renderAlarms(true); toast('Смоделирована авария', 'Вибрация подшипников 7,8 мм/с (уставка 7,1 мм/с)', 'err');
    go(5);
  });

  /* ========================== ЭТАП 6: ЗАВЕРШЕНИЕ ========================= */
  const STOP_STEPS = [
    { t:'Плавное снижение частоты и напряжения', d:'закон V/f, темп 0,6 кВ/с', v:'f → 0 Гц · U → 0 кВ' },
    { t:'Отключение нагрузки, выбег мотор-генератора', d:'реактор L1 и нагрузочный контур отключены', v:'I вых → 0 А' },
    { t:'Отключение вводного выключателя Q1', d:'снятие напряжения 6 кВ с силового тракта', v:'U вх = 0 кВ' },
    { t:'Разрядка звена постоянного тока', d:'тормозной резистор, контроль U звена DC', v:'U dc → 0 кВ (18 с)' },
    { t:'Заземление силовой цепи', d:'включение заземляющего разъединителя QS1', v:'цепь заземлена' },
    { t:'Останов системы охлаждения и фиксация данных', d:'насосы и вентиляторы отключены, буферы записаны', v:'охлаждение off' }
  ];
  function renderStopSteps(cur) {
    $('#stop-steps').innerHTML = STOP_STEPS.map((s, i) => `
      <div class="ss ${i < cur ? 'ok' : i === cur ? 'cur' : ''}">
        <div class="ss-ico">${i < cur ? '✓' : i + 1}</div>
        <div class="ss-body"><div class="ss-t">${esc(s.t)}</div><div class="ss-d">${esc(s.d)}</div></div>
        <div class="ss-v">${esc(s.v)}</div>
      </div>`).join('');
  }
  $('#btn-stop-proc').addEventListener('click', () => {
    if (UI.stopRunning) return;
    if (!S.startedAt) return toast('Испытание не начиналось', 'Процедуру останова выполнять не требуется', 'warn');
    UI.stopRunning = true;
    if (S.state === 'running' || S.state === 'paused') Sim.normalStop();
    Sim.log('Начата процедура штатного останова стенда', 'act');
    let i = 0;
    const next = () => {
      if (i >= STOP_STEPS.length) {
        UI.stopRunning = false;
        S.state = S.state === 'done' ? 'done' : S.state;
        S.stateText = 'СТЕНД ОБЕСТОЧЕН';
        Sim.log('Стенд обесточен и заземлён. Процедура останова завершена.', 'ok');
        toast('Останов завершён', 'Стенд обесточен, силовая цепь заземлена, данные зафиксированы', 'ok');
        renderStopSteps(STOP_STEPS.length);
        return;
      }
      renderStopSteps(i);
      Sim.log(`Останов, шаг ${i + 1}: ${STOP_STEPS[i].t}`, 'act');
      Sim.act('Шаг останова ' + (i + 1), STOP_STEPS[i].t, i + 1);
      i++;
      setTimeout(next, 750);
    };
    next();
  });
  function renderFinish() {
    const d = S.state === 'done';
    $('#v6-state').textContent = d ? (S.finishedReason === 'completed' ? 'программа завершена' : 'испытание остановлено') : S.startedAt ? 'испытание выполняется' : 'испытание не начато';
    const v = $('#fin-verdict');
    if (S.result) {
      v.textContent = S.result.verdict === 'pass' ? 'СООТВЕТСТВУЕТ ТУ' : 'НЕ СООТВЕТСТВУЕТ ТУ';
      v.className = 'verdict-sm ' + (S.result.verdict === 'pass' ? 'ok' : 'bad');
    } else { v.textContent = 'результат не сформирован'; v.className = 'verdict-sm'; }
    $('#fin-dur').textContent = Sim.timeStr(S.t) + ' (модельное время)';
    $('#fin-steps').textContent = (S.stepIndex + 1) + ' из ' + S.steps.length;
    $('#fin-alarms').textContent = S.stats.alarms;
    $('#fin-warns').textContent = S.stats.warns;
    $('#fin-size').textContent = dataSize();
  }
  function dataSize() {
    const n = S.hist.t.length * Sim.CHANNELS.length * 8;
    return (n / 1048576).toFixed(2).replace('.', ',') + ' МБ (' + S.hist.t.length + ' точек × ' + Sim.CHANNELS.length + ' каналов)';
  }
  $('#btn-save-session').addEventListener('click', () => {
    if (!S.startedAt) return toast('Нет данных испытания', 'Запустите испытание перед сохранением', 'err');
    if (!S.result) S.result = Sim.evaluate();
    S.savedAt = new Date();
    UI.saved = true;
    const name = $('#s-name').value || 'Испытание ВЧРП';
    const files = [];
    if ($('#s-save-trends').checked) files.push([`trends_${ts()}.csv`, dataSize()]);
    if ($('#s-save-wave').checked) files.push([`scope_${ts()}.csv`, '0,42 МБ']);
    if ($('#s-save-log').checked) files.push([`journal_${ts()}.csv`, (S.alarms.length * 0.4 + 12).toFixed(1).replace('.', ',') + ' КБ']);
    if ($('#s-save-raw').checked) files.push([`raw_${ts()}.bin`, dataSize()]);
    if ($('#s-save-video').checked) files.push([`video_${ts()}.mp4`, '184,6 МБ']);
    files.push([`session_${ts()}.json`, '0,9 МБ']);
    $('#file-list').innerHTML = files.map(f => `<div class="file"><b>${esc(f[0])}</b><span>${esc(f[1])}</span></div>`).join('') +
      `<div class="cf-note">Сессия «${esc(name)}» сохранена в архив стенда (${Sim.nowStr()}).</div>`;
    $('#save-note').textContent = 'Сохранено ' + Sim.nowStr() + ' · ' + files.length + ' артефактов';
    Sim.log(`Испытание «${name}» сохранено в архив. Артефактов: ${files.length}, объём данных ${dataSize()}`, 'ok');
    toast('Испытание сохранено', 'Артефакты: ' + files.length + ' · ' + dataSize(), 'ok');
    updateRail();
  });
  $('#btn-csv').addEventListener('click', () => { if (!S.hist.t.length) return toast('Нет данных', 'Тренды пусты', 'err'); download(`trends_${ts()}.csv`, Sim.csvTrends()); toast('Выгрузка трендов', 'Файл CSV сформирован', 'ok'); });
  $('#btn-csv-log').addEventListener('click', () => { download(`journal_${ts()}.csv`, Sim.csvLog()); toast('Выгрузка журнала', 'Файл CSV сформирован', 'ok'); });
  $('#btn-csv-wave').addEventListener('click', () => { download(`scope_${ts()}.csv`, Sim.csvWave()); toast('Выгрузка осциллограммы', 'Файл CSV сформирован', 'ok'); });
  $('#btn-json').addEventListener('click', () => { download(`session_${ts()}.json`, JSON.stringify(Sim.snapshot(), null, 2), 'application/json'); toast('Сессия выгружена', 'JSON с полным состоянием испытания', 'ok'); });

  /* ========================= ЭТАП 7: АНАЛИЗ И ПРОТОКОЛ =================== */
  function renderAnalysis(force) {
    if (!S.result) S.result = Sim.evaluate();
    const r = S.result;
    $('#cmp-body').innerHTML = r.rows.map(row => `
      <tr>
        <td class="mono">${row.n}</td>
        <td>${esc(row.name)}</td>
        <td class="muted">${esc(row.norm)}</td>
        <td class="num">${esc(row.actual)}</td>
        <td class="num">${esc(row.dev)}</td>
        <td><span class="st-pill ${row.ok ? 'st-ok' : 'st-err'}">${row.ok ? 'соответствует' : 'не соответствует'}</span></td>
      </tr>`).join('');
    const keys = ['u_out', 'i_out', 'f_out', 'p_out', 'cosphi', 'thd', 't_igbt', 'udc', 'udc_ripple', 'efficiency'];
    $('#stats-body').innerHTML = keys.map(k => {
      const st = Sim.stats(k); const c = C[k];
      if (!st) return `<tr><td>${esc(c.name)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`;
      return `<tr><td>${esc(c.name)}, ${esc(c.unit)}</td>
        <td class="num">${fmt(st.min, c.dec)}</td><td class="num">${fmt(st.max, c.dec)}</td>
        <td class="num">${fmt(st.avg, c.dec)}</td><td class="num">${fmt(st.sd, c.dec)}</td>
        <td class="num">${fmt(st.max - st.min, c.dec)}</td></tr>`;
    }).join('');
    $('#v7-samples').textContent = S.hist.t.length;
    const card = $('#verdict-card'), mark = $('#vc-mark');
    if (!r.isDone) {
      card.className = 'card mt verdict-card';
      mark.textContent = '—';
      $('#vc-title').textContent = 'Испытание не завершено';
      $('#vc-desc').textContent = 'Выполните программу испытания полностью, чтобы система рассчитала соответствие нормам и сформировала протокол. Ниже — предварительная оценка по уже собранным данным.';
    } else if (r.verdict === 'pass') {
      card.className = 'card mt verdict-card ok';
      mark.textContent = '✓';
      $('#vc-title').textContent = 'Изделие соответствует требованиям ТУ';
      $('#vc-desc').textContent = 'Все контролируемые параметры находятся в пределах норм. Испытание признано успешным, изделие допускается к приёмке.';
    } else {
      card.className = 'card mt verdict-card bad';
      mark.textContent = '✕';
      $('#vc-title').textContent = 'Изделие не соответствует требованиям ТУ';
      $('#vc-desc').textContent = 'Выявлены отклонения по ' + r.reasons.length + ' пунктам: ' + r.reasons.join('; ') + '. Требуется анализ причин и повторное испытание после устранения замечаний.';
    }
    $('#vc-facts').innerHTML = [
      ['Программа', S.program ? S.program.code : '—'],
      ['Длительность', Sim.timeStr(S.t)],
      ['Пунктов проверено', r.rows.length],
      ['Соответствует', r.rows.filter(x => x.ok).length],
      ['Аварий', S.stats.alarms],
      ['Предупреждений', S.stats.warns]
    ].map(f => `<div>${esc(f[0])}<b>${esc(f[1])}</b></div>`).join('');
    if (force || UI.view === 7) UI.charts['c-full'].render(S.hist, S.clock, true);
    $('#btn-protocol').disabled = false;
  }
  function ts() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); }
  const RU = d => d ? new Date(d).toLocaleString('ru-RU', { hour12:false }) : '—';

  function buildProtocol() {
    const r = S.result || Sim.evaluate();
    const st = S.settings || {};
    const img = $('#c-full').toDataURL('image/png');
    const prog = S.program ? S.program.code + ' «' + S.program.name + '»' : '—';
    const checks = Sim.CHECKS.filter(c => S.checks[c.id]).map(c => `<tr><td>${esc(c.title)}</td><td>${esc(c.norm || (c.kind === 'ask' ? 'подтверждение оператора' : 'выполнено'))}</td><td>${esc(S.checks[c.id].text || '—')}</td><td>выполнено</td></tr>`).join('');
    const rows = r.rows.map(x => `<tr><td>${x.n}</td><td>${esc(x.name)}</td><td>${esc(x.norm)}</td><td>${esc(x.actual)}</td><td>${esc(x.dev)}</td><td>${x.ok ? 'соответствует' : 'НЕ СООТВЕТСТВУЕТ'}</td></tr>`).join('');
    const alarms = S.alarms.length ? S.alarms.map(a => `<tr><td>${a.t}</td><td>${esc(a.code)}</td><td>${AL_SEV[a.sev].t}</td><td>${esc(a.name)}</td><td>${typeof a.value === 'number' ? fmt(a.value, a.dec) : esc(a.value)} ${esc(a.unit)}</td><td>${AL_ST[a.state] ? AL_ST[a.state].t : a.state}</td></tr>`).join('')
      : '<tr><td colspan="6">Событий и аварий за время испытания не зарегистрировано.</td></tr>';
    const verdict = r.verdict === 'pass' && r.isDone;
    return `
      <h1>ПРОТОКОЛ ИСПЫТАНИЙ № ${esc(($('#s-tags').value || '2026-041').split(',').pop().trim())}</h1>
      <p style="text-align:center;margin:0 0 4mm">испытательного стенда высоковольтного преобразователя частоты (ВЧРП)</p>
      <div class="pr-meta">
        <div><b>Объект испытаний:</b> ${esc($('#s-object').value)}</div>
        <div><b>Заказчик:</b> ${esc($('#s-customer').value)}</div>
        <div><b>Программа:</b> ${esc(prog)}</div>
        <div><b>Нормативный документ:</b> ${esc(S.program ? S.program.norm : '—')}</div>
        <div><b>Дата и время начала:</b> ${esc(RU(S.startedAt))}</div>
        <div><b>Дата и время окончания:</b> ${esc(RU(S.savedAt || new Date()))}</div>
        <div><b>Оператор:</b> ${esc(S.settings.operator || '—')}</div>
        <div><b>Режим:</b> автоматический, ${esc(st.loadtype || '—')}</div>
        <div><b>Длительность испытания:</b> ${esc(Sim.timeStr(S.t))}</div>
        <div><b>Температура окружающей среды:</b> ${esc(fmt(S.P.t_amb, 1))} °C</div>
        <div><b>Уставки защиты:</b> I: ${esc(st.iwarn)}/${esc(st.itrip)} А, T: ${esc(st.twarn)}/${esc(st.ttrip)} °C</div>
        <div><b>Номинальные параметры:</b> ${esc(st.unom)} кВ, ${esc(st.fnom)} Гц, ${esc(st.inom)} А</div>
      </div>

      <h2>1. Проверка изделия перед испытанием</h2>
      <table><thead><tr><th>Проверка</th><th>Норма</th><th>Результат</th><th>Заключение</th></tr></thead><tbody>${checks || '<tr><td colspan="4">Данные отсутствуют</td></tr>'}</tbody></table>

      <h2>2. Режимы и профиль испытания</h2>
      <table><thead><tr><th>Ступень</th><th>Частота, %</th><th>Напряжение, %</th><th>Нагрузка, %</th><th>Выдержка, с</th></tr></thead>
      <tbody>${S.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${s[0]}</td><td>${s[1]}</td><td>${s[2]}</td><td>${s[3]}</td></tr>`).join('')}</tbody></table>

      <h2>3. Результаты измерений и соответствие нормам</h2>
      <table><thead><tr><th>№</th><th>Контролируемый параметр</th><th>Норма</th><th>Измерено</th><th>Отклонение</th><th>Вердикт</th></tr></thead><tbody>${rows}</tbody></table>

      <h2>4. Тренд основных параметров за испытание</h2>
      <img class="pr-chart" src="${img}" alt="Тренд испытания">
      <p class="pr-small">Объём зарегистрированных данных: ${esc(dataSize())}. Осциллограммы и массивы сырых данных прилагаются в электронном виде.</p>

      <h2>5. События, предупреждения и срабатывания защит</h2>
      <table><thead><tr><th>Время</th><th>Код</th><th>Уровень</th><th>Событие</th><th>Значение</th><th>Состояние</th></tr></thead><tbody>${alarms}</tbody></table>

      <h2>6. Заключение</h2>
      <div class="pr-verdict">${verdict ? 'Изделие соответствует требованиям ' + esc(S.program ? S.program.norm : 'ТУ') : 'Изделие НЕ соответствует требованиям ' + esc(S.program ? S.program.norm : 'ТУ')}</div>
      <p>${verdict
        ? 'Испытание проведено в полном объёме программы ' + esc(prog) + '. Все контролируемые параметры находятся в пределах установленных норм. Отказов, срабатываний технологических защит и повреждений оборудования не зафиксировано. Изделие рекомендуется к приёмке.'
        : 'В ходе испытания выявлены отклонения по следующим пунктам: ' + esc(r.reasons.join('; ')) + '. Требуется анализ причин, устранение замечаний и повторное испытание в объёме программы.'}</p>
      <p class="pr-small">Комментарий оператора: ${esc($('#s-comment').value || '—')}</p>
      <p class="pr-small">Испытание проведено с применением автоматизированной системы управления и мониторинга испытательного стенда (ПО v2.4.1). Протокол сформирован автоматически ${esc(RU(new Date()))}.</p>

      <div class="pr-sig">
        <div>Оператор стенда: ${esc(S.settings.operator || '________________')}<br><span class="pr-small">подпись, дата</span></div>
        <div>Начальник испытаний: ________________<br><span class="pr-small">подпись, дата</span></div>
        <div>Представитель ОТК: ________________<br><span class="pr-small">подпись, дата</span></div>
      </div>`;
  }
  function openProtocolModal() {
    const html = buildProtocol();
    $('#print-root').innerHTML = html;
    let m = $('#proto-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'proto-modal';
      m.className = 'modal-back';
      m.innerHTML = `<div class="modal modal-wide">
        <div class="modal-head"><h2>Протокол испытаний — предварительный просмотр</h2><button class="modal-x" data-close>✕</button></div>
        <div class="modal-body"><div class="paper" id="paper"></div></div>
        <div class="modal-foot">
          <button class="btn ghost" data-close>Закрыть</button>
          <button class="btn ghost" id="proto-json">Выгрузить JSON</button>
          <button class="btn primary" id="proto-print">Печать / сохранить PDF</button>
        </div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) m.hidden = true; });
      m.querySelector('#proto-print').addEventListener('click', () => window.print());
      m.querySelector('#proto-json').addEventListener('click', () => download(`session_${ts()}.json`, JSON.stringify(Sim.snapshot(), null, 2), 'application/json'));
    }
    $('#paper').innerHTML = html;
    m.hidden = false;
  }
  $('#btn-protocol').addEventListener('click', () => {
    UI.protocolReady = true;
    if (!S.result) S.result = Sim.evaluate();
    openProtocolModal();
    Sim.log('Сформирован протокол испытаний с приложением трендов и журнала событий', 'ok');
    toast('Протокол сформирован', 'Доступен предварительный просмотр и печать', 'ok');
    updateRail();
  });
  $('#btn-print').addEventListener('click', () => { $('#print-root').innerHTML = buildProtocol(); UI.protocolReady = true; updateRail(); window.print(); });
  $('#btn-archive').addEventListener('click', () => { toast('Отправлено в архив', 'Протокол и данные сессии переданы в архив испытательного центра', 'ok'); Sim.log('Протокол и данные сессии отправлены в архив', 'ok'); });
  $('#btn-csv2') && $('#btn-csv2').addEventListener('click', () => download(`trends_${ts()}.csv`, Sim.csvTrends()));

  /* ============================ ОБЩИЙ ЦИКЛ ОТРИСОВКИ ===================== */
  function renderStatusBar() {
    $('#sb-buf').textContent = S.hist.t.length;
    $('#sb-rec').textContent = (S.state === 'running' || S.state === 'paused') ? 'идёт' : 'остановлена';
    $('#sb-rec').className = (S.state === 'running' || S.state === 'paused') ? 'err' : '';
    $('#rec-ind').hidden = !(S.state === 'running' || S.state === 'paused');
    $('#rec-time').textContent = Sim.timeStr(S.t);
    const chip = $('#chip-bench');
    chip.className = 'chip ' + (S.state === 'running' ? 'ok run' : S.state === 'paused' ? 'warn' : (S.state === 'tripping' || S.state === 'estop') ? 'err' : '');
    $('#chip-bench-text').textContent = S.stateText;
    $('#plc-ping').textContent = (10 + Math.round(Math.random() * 5)) + ' мс';
    $('#sb-plc').textContent = 'связь есть';
    $('#sb-plc').className = 'ok';
  }
  function renderSchematic() {
    const running = S.state === 'running' || S.state === 'paused';
    const fault = S.state === 'tripping' || S.state === 'estop' || S.stats.trips > 0;
    const set = (id, cls) => { const n = $(id); if (n) n.setAttribute('class', 'node ' + cls); };
    set('#nd-net', 'on');
    set('#nd-breaker', running ? 'on' : 'off');
    set('#nd-trans', running ? 'on' : 'ready');
    set('#nd-vfd', fault ? 'err' : running ? 'on' : UI.admitted ? 'ready' : 'off');
    set('#nd-cool', (running || S.P.flow > 5) ? 'on' : 'off');
    set('#nd-load', running ? 'on' : 'off');
    set('#nd-motor', running ? 'on' : 'off');
    $('#vfd-sub').textContent = fault ? 'аварийное отключение' : running ? 'работа, ШИМ разрешена' : UI.admitted ? 'готов, обесточен' : 'ожидание';
    $('#schem-state').textContent = fault ? 'авария' : running ? 'работа' : UI.admitted ? 'готов' : 'ожидание';
    const cool = $('#wire-cool');
    if (cool) cool.classList.toggle('active', S.P.flow > 5);
    $$('.scheme .wire.flow').forEach(w => w.classList.toggle('active', running));
  }
  function renderEventsPanel() {
    if (UI.lastEventCount === S.events.length) return;
    UI.lastEventCount = S.events.length;
    $('#side-events').innerHTML = S.events.slice(0, 12).map(e =>
      `<div class="se sev-${e.sev}"><span class="se-t">${e.t}</span><span class="se-x">${esc(e.text)}</span></div>`).join('') || '<div class="empty-sm">Событий нет</div>';
  }
  let lastFast = 0, clockTick = 0;
  window.Sim.subscribe(function (SimS) {
    const now = performance.now();
    if (now - lastFast < 90) return;
    lastFast = now;
    renderStatusBar();
    renderMonitor();
    renderRun();
    renderAlarms();
    renderEventsPanel();
    renderSchematic();
    renderFinish();
    if (UI.view === 7) UI.charts['c-full'].render(S.hist, S.clock);
    if (UI.view === 2) drawProfileChart();
    updateRail();
  });
  setInterval(() => {
    const d = new Date();
    $('#clock').textContent = d.toLocaleTimeString('ru-RU', { hour12:false });
    $('#clock-date').textContent = d.toLocaleDateString('ru-RU');
  }, 1000);
  $('#daq-rate').textContent = '10 Гц';

  /* ============================ СКОРОСТЬ ВРЕМЕНИ ========================= */
  $$('#speed-sel button').forEach(b => b.addEventListener('click', () => {
    $$('#speed-sel button').forEach(x => x.classList.toggle('active', x === b));
    Sim.setSpeed(+b.dataset.speed);
  }));

  /* ================================= СТАРТ ============================== */
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    buildChecklist();
    buildPrograms();
    buildMonitor();
    loadProgram('psi1');
    renderProfile();
    renderStopSteps(-1);
    go(1);
    updateRail();
    Sim.init();
    // автоматический демо-режим для предпросмотра/скриншотов
    const q = new URLSearchParams(location.search);
    if (q.has('demo')) {
      const view = q.has('view') ? +q.get('view') : 3;
      try {
        Sim.CHECKS.forEach(c => {
          const raw = typeof c.value === 'function' ? c.value() : 'выполнено';
          const res = { id:c.id, result:'ok', raw, text:(typeof raw === 'number' ? fmt(raw, c.dec) + ' ' + (c.unit || '') : String(raw)), time:Sim.nowStr() };
          Sim.setCheck(c.id, res);
          applyCheckRow(c, res);
        });
        UI.admitted = true;
        refreshChecks();
        const pid = q.get('prog') || 'psi1';
        loadProgram(pid);
        Sim.start(readSettings(), steps, pid);
        UI.logCount = 0;
        // ускоренная прокрутка модели: полный прогон или середина программы
        const ff = q.has('ff') ? +q.get('ff') : ((view === 3 || view === 4 || view === 5) ? 42 : 95);
        Sim.fastForward(ff);
        const P = S.P;
        if (P.u_out > 0.4) {
          Sim.raiseAlarm('t_igbt', 'warn', Math.max(70.6, P.t_igbt), 70, { latch:true });
          Sim.raiseAlarm('flow', 'warn', Math.min(78, P.flow), 80, { latch:true });
        } else {
          Sim.raiseAlarm('vibro', 'warn', 4.7, 4.5, { latch:true });
          Sim.raiseAlarm('t_trans', 'info', 78.2, 95, { latch:true });
        }
        simRefresh();
        toast('Демонстрационный режим', 'Модель прокручена на ' + ff + ' с, интерфейс заполнен данными', 'ok');
        if (q.has('proto')) { renderAnalysis(); openProtocolModal(); }
      } catch (e) {
        console.error('demo mode:', e);
        toast('Демо-режим прерван', String(e && e.message || e), 'err');
      }
      go(view);
    }
  }
  // принудительная перерисовка всех панелей (после ускоренной прокрутки модели)
  function simRefresh() {
    UI.lastAlarmSig = ''; UI.lastEventCount = -1; UI.lastActionCount = -1;
    UI.logCount = -1; UI.stepIndex = -999;
    renderStatusBar(); renderMonitor(true); renderRun(); renderAlarms(true);
    renderEventsPanel(); renderSchematic(); renderFinish(); updateRail();
    if (S.result) renderAnalysis();
  }
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();