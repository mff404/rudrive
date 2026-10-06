/* =========================================================================
   sim.js — модель испытательного стенда ВЧРП
   Телеметрия 10 Гц, профиль ступеней, уставки защит, аварии, журнал.
   Модуль не зависит от DOM: UI только читает состояние и подписывается.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ----------------------------- ПАСПОРТ СТЕНДА ---------------------------- */
  const CFG = {
    model: 'ВЧРП-6-2000',
    serial: '4417',
    Unom: 6.0,      // кВ, линейное выходное
    Fnom: 50,       // Гц
    Inom: 200,      // А
    Pnom: 2.0,      // МВт
    Uin: 6.0,       // кВ питающей сети
    UdcNom: 8.5,    // кВ звена постоянного тока
    Tamb: 24.5,     // °C
    tickHz: 10      // частота модельного шага
  };

  /* --------------------------------- КАНАЛЫ -------------------------------- */
  // warn/alarm — уставки; low:true — срабатывание по минимуму; trip — защитное отключение
  const CHANNELS = [
    { key:'u_out',      name:'U вых (линейное)',    unit:'кВ',   dec:2, color:'#29b6f6', chart:'power' },
    { key:'i_out',      name:'I вых',               unit:'А',    dec:1, color:'#f5a524', chart:'power', warn:210, alarm:240, trip:true },
    { key:'p_out',      name:'P вых',               unit:'МВт',  dec:2, color:'#a78bfa', chart:'power' },
    { key:'f_out',      name:'f вых',               unit:'Гц',   dec:2, color:'#37d67a', chart:'freq' },
    { key:'udc',        name:'U звена DC',          unit:'кВ',   dec:2, color:'#4dd0e1', chart:'freq', warn:9.5, alarm:9.9, trip:true },
    { key:'i_in',       name:'I вх',                unit:'А',    dec:1, color:'#94a3b8', chart:'freq' },
    { key:'t_igbt',     name:'T модулей IGBT (max)',unit:'°C',   dec:1, color:'#ff6b6b', chart:'therm', warn:70, alarm:85, trip:true },
    { key:'t_trans',    name:'T трансформатора',    unit:'°C',   dec:1, color:'#ffa94d', chart:'therm', warn:95, alarm:110 },
    { key:'t_cool',     name:'T охлаждающей жидкости',unit:'°C', dec:1, color:'#63e6be', chart:'therm', warn:55, alarm:65 },
    { key:'t_amb',      name:'T окружающей среды',  unit:'°C',   dec:1, color:'#8fa3b8' },
    { key:'udc_ripple', name:'Пульсации U звена DC',unit:'%',    dec:2, color:'#6ea8fe', warn:2.5, alarm:4.0, gate:true, gateLoad:0.25 },
    { key:'thd',        name:'THD U вых',           unit:'%',    dec:2, color:'#ff9f43', warn:5, alarm:7, gate:true, gateLoad:0.25 },
    { key:'cosphi',     name:'cos φ',               unit:'',     dec:3, color:'#8ce99a', warn:0.87, alarm:0.82, low:true, gate:true, gateLoad:0.45 },
    { key:'efficiency', name:'КПД',                 unit:'%',    dec:2, color:'#7ee0c0', warn:95, alarm:93, low:true, gate:true, gateLoad:0.45 },
    { key:'flow',       name:'Расход охлаждения',   unit:'л/мин',dec:0, color:'#74c0fc', warn:80, alarm:60, low:true, trip:true },
    { key:'press',      name:'Давление контура',    unit:'бар',  dec:2, color:'#4dd0e1', warn:2.2, alarm:1.8, low:true },
    { key:'u_in',       name:'U вх (сеть)',         unit:'кВ',   dec:2, color:'#a9bccf' },
    { key:'n_motor',    name:'Частота вращения',    unit:'об/мин',dec:0, color:'#c0a5ff' },
    { key:'torque',     name:'Момент нагрузки',     unit:'%',    dec:1, color:'#f7b267' },
    { key:'aux_u',      name:'U собственных нужд',  unit:'В',    dec:0, color:'#9fb0c3', warn:360, alarm:340, low:true },
    { key:'vibro',      name:'Вибрация подшипников',unit:'мм/с', dec:2, color:'#f08c8c', warn:4.5, alarm:7.1 }
  ];
  const CH = {};
  CHANNELS.forEach(c => { CH[c.key] = c; });

  /* --------------------------------- ПРОГРАММЫ ----------------------------- */
  // ступень: [частота %, напряжение %, нагрузка %, длительность с]
  const PROGRAMS = [
    { id:'psi1', code:'ПСИ-1', name:'Приёмо-сдаточные испытания',
      desc:'Ступенчатый выход на номинал 25–50–75–100 %, выдержка, контроль КПД, THD и нагрева.',
      norm:'ТУ 3411-002-2026, п. 5.2',
      settings:{ iwarn:210, itrip:240 },
      steps:[[0,0,0,2],[25,25,25,8],[50,50,50,10],[75,75,75,12],[100,100,100,20],[100,100,50,8],[0,0,0,6]],
      disturbances:[{t:30, key:'t_amb', add:2.5, dur:26},{t:44, key:'flow', add:-38, dur:10}] },

    { id:'psi2', code:'ПСИ-2', name:'Диапазон регулирования частоты',
      desc:'Работа на частотах 2–50 Гц по закону V/f, контроль THD, устойчивости и cos φ.',
      norm:'ТУ 3411-002-2026, п. 5.3',
      settings:{ iwarn:210, itrip:240 },
      steps:[[10,10,30,6],[20,20,30,6],[40,40,50,6],[70,70,75,8],[100,100,100,10],[60,60,40,5],[0,0,0,5]],
      disturbances:[] },

    { id:'psi3', code:'ПСИ-3', name:'Нагрузочная способность, 1,5 Iн',
      desc:'Выдержка 150 % номинального тока, контроль теплового режима и защит от перегрузки.',
      norm:'ТУ 3411-002-2026, п. 5.5; ГОСТ Р 51524, п. 7.4',
      settings:{ iwarn:290, itrip:320, note:'порог защиты по току поднят до 320 А (1,6 Iн) на время испытания перегрузкой' },
      steps:[[100,100,100,12],[100,100,150,42],[100,100,100,8],[0,0,0,5]],
      disturbances:[], overload:true, overloadLevel:150, overloadNeed:25 },

    { id:'psi4', code:'ПСИ-4', name:'Проверка защит и аварийных отключений',
      desc:'Подача завышенных уставок, проверка срабатывания технологических защит и блокировок.',
      norm:'ТУ 3411-002-2026, п. 5.7',
      settings:{ iwarn:215, itrip:235, note:'уставки приближены к номинальному току для проверки срабатывания защиты' },
      steps:[[100,100,100,8],[100,100,120,14],[100,100,60,5],[0,0,0,4]],
      disturbances:[], expectTrip:true },

    { id:'psi5', code:'ПСИ-5', name:'Термоциклирование',
      desc:'Циклы нагрев/охлаждение 100 → 30 % нагрузки, контроль тепловых деформаций и стабильности.',
      norm:'Программа заказчика П-14',
      settings:{ iwarn:210, itrip:240 },
      steps:[[100,100,100,12],[100,100,30,9],[100,100,100,12],[100,100,30,9],[100,100,100,12],[0,0,0,5]],
      disturbances:[] }
  ];

  /* --------------------------- ПРОВЕРКИ ПЕРЕД ПУСКОМ ----------------------- */
  const CHECKS = [
    { id:'visual',  title:'Внешний осмотр ВЧРП и шкафов',            hint:'Механические повреждения, следы перегрева, комплектность', kind:'ask' },
    { id:'clean',   title:'Чистота изоляционных поверхностей',        hint:'Продувка, отсутствие пыли и токопроводящих загрязнений',   kind:'ask' },
    { id:'ground',  title:'Заземление корпуса и шкафов',              hint:'Сопротивление контура заземления, не более 4 Ом',        kind:'test', unit:'Ом',        value:() => 0.74 + Math.random()*0.1, dec:2, norm:'≤ 4 Ом' },
    { id:'cables',  title:'Подключение силовых кабелей 6 кВ',         hint:'Момент затяжки контактных соединений, маркировка фаз',   kind:'ask' },
    { id:'control', title:'Цепи управления и блокировки',             hint:'Исправность цепей E-STOP, концевых выключателей дверей', kind:'test', unit:'', value:() => 'исправно', norm:'исправно' },
    { id:'iso',     title:'Сопротивление изоляции главных цепей',     hint:'Мегаомметр 2,5 кВ, время замера 60 с',                   kind:'test', unit:'МОм',       value:() => 38 + Math.random()*12, dec:1, norm:'≥ 10 МОм' },
    { id:'hivolt',  title:'Испытание изоляции повышенным напряжением',hint:'12 кВ, 60 с, контроль тока утечки',                      kind:'test', unit:'', value:() => 'без пробоя', norm:'без пробоя' },
    { id:'cooling', title:'Система охлаждения',                       hint:'Герметичность контура, давление, расход, качество жидкости', kind:'test', unit:'бар', value:() => 3.1 + Math.random()*0.2, dec:2, norm:'2,5…3,5 бар' },
    { id:'pumps',   title:'Насосы и вентиляторы обдува',              hint:'Токи потребления, направление вращения, шум подшипников', kind:'test', unit:'А',         value:() => 4.6 + Math.random()*0.3, dec:2, norm:'4,2…5,2 А' },
    { id:'sensors', title:'Датчики тока, напряжения и температуры',    hint:'Проверка каналов измерения и калибровки',                kind:'test', unit:'%',         value:() => 0.3 + Math.random()*0.25, dec:2, norm:'погрешность ≤ 0,5 %' },
    { id:'plc',     title:'Связь с ПЛК и конфигурация ПО',            hint:'Загрузка проекта, версия прошивки, журнал диагностики',  kind:'test', unit:'', value:() => 'ПО v3.14.2', norm:'ПО v3.14.2 и выше' },
    { id:'load',    title:'Нагрузочный тракт и рекуперация',          hint:'Реактор, мотор-генератор, готовность к приёму мощности', kind:'ask' }
  ];

  /* ------------------------------- СОСТОЯНИЕ ------------------------------- */
  const CAP = 3600;           // ёмкость буферов трендов (точек)
  const TRIM = 400;

  const S = {
    state:'idle',              // idle | ready | running | paused | tripping | estop | done
    stateText:'ОСТАНОВЛЕН',
    speed:5,                   // множитель модельного времени
    clock:0,                   // модельное время сессии, с
    clockOffset:0,             // смещение меток журнала при ускоренной прокрутке, с
    t:0,                       // время с начала испытания, с
    program:null,
    steps:[],
    stepIndex:-1,
    settings:{ unom:CFG.Unom, fnom:CFG.Fnom, inom:CFG.Inom, iwarn:190, itrip:220, twarn:70, ttrip:85,
      ramp:0.6, hold:20, cycles:1, loadmode:'Плавный (V/f)',
      loadtype:'Реактор + мотор-генератор (рекуперация)', operator:'Иванов А. П.' },
    P:{},                      // текущие значения каналов
    sp:{ f:0, u:0, load:0 },   // задание
    a:{ f:0, u:0, load:0 },    // фактические (с инерцией)
    hist:{ t:[] },
    alarms:[],
    events:[],
    actions:[],
    checks:{},                 // результаты проверок по id
    nominal:[],                // выборка на номинальном режиме
    stats:{ alarms:0, warns:0, deviations:0, actions:0, trips:0 },
    overloadHold:0,
    tripReason:null,
    result:null,
    startedAt:null,
    savedAt:null,
    disturb:[],
    subscribers:[],
    seq:0
  };
  CHANNELS.forEach(c => { S.hist[c.key] = []; });

  /* ------------------------------- УТИЛИТЫ -------------------------------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rnd = (a) => (Math.random() * 2 - 1) * a;
  const nowStr = () => new Date(Date.now() + S.clockOffset * 1000).toLocaleTimeString('ru-RU', { hour12:false });
  const fmtNum = (v, dec) => (v === null || v === undefined || v === '' ) ? '—'
    : (typeof v === 'number' ? v.toFixed(dec ?? 2).replace('.', ',') : String(v));
  const timeStr = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
    return (h ? String(h).padStart(2,'0') + ':' : '') + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  };

  /* --------------------------------- ЖУРНАЛ -------------------------------- */
  function log(text, sev) {
    const ev = { t:nowStr(), clock:S.clock, text, sev:sev || 'info' };
    S.events.unshift(ev);
    if (S.events.length > 400) S.events.pop();
    return ev;
  }
  function act(title, desc, count) {
    S.actions.unshift({ t:nowStr(), title, desc, count:count || 0 });
    if (S.actions.length > 40) S.actions.pop();
  }

  /* --------------------------------- АВАРИИ -------------------------------- */
  function raiseAlarm(key, sev, value, limit, opts) {
    const c = CH[key];
    const open = S.alarms.find(a => a.key === key && a.sev === sev && a.state !== 'cleared');
    if (open) { open.value = value; return open; }
    S.seq++;
    const code = (sev === 'alarm' ? 'AL-' : sev === 'warn' ? 'WR-' : 'IN-') + String(100 + S.seq).slice(-3);
    const al = {
      id:'a' + S.seq, seq:S.seq, code, sev, key,
      name: opts && opts.name ? opts.name : c.name,
      unit: c.unit, dec: c.dec, value, limit,
      source: opts && opts.source ? opts.source : 'Контроллер стенда · ПЛС',
      state:'active', t:nowStr(), clock:S.clock,
      latch: !!(opts && opts.latch),
      cause: opts && opts.cause ? opts.cause : null,
      actions: opts && opts.actions ? opts.actions : null
    };
    S.alarms.unshift(al);
    if (S.alarms.length > 300) S.alarms.pop();
    if (sev === 'alarm') S.stats.alarms++; else if (sev === 'warn') S.stats.warns++;
    log(`${code} · ${al.name}: ${fmtNum(value, c.dec)} ${c.unit} (уставка ${fmtNum(limit, c.dec)} ${c.unit})`, sev === 'alarm' ? 'err' : 'warn');
    const trip = opts && opts.trip;
    if (trip && (S.state === 'running' || S.state === 'paused')) {
      S.stats.trips++;
      act('Защитное отключение стенда', `Сработала защита «${al.name}». Силовой тракт отключён, профиль остановлен.`, 1);
      log(`АЗ-01 · Автоматическое отключение вводного выключателя Q1. Причина: ${al.name}`, 'err');
      S.tripReason = al.code + ' · ' + al.name;
      S.state = 'tripping';
      S.estopMode = false;
      S.stateText = 'АВАРИЙНОЕ ОТКЛЮЧЕНИЕ';
    }
    return al;
  }

  function clearIfNormal(energized, loadFrac) {
    for (const a of S.alarms) {
      if (a.state === 'cleared' || a.key === 'estop') continue;
      if (a.latch) continue;                     // защитное событие удерживается до квитирования
      const c = CH[a.key];
      if (!c || c.warn === undefined) continue;
      if (c.gate && (!energized || loadFrac < (c.gateLoad || 0))) { a.state = 'cleared'; log(`${a.code} · условие снято: ${a.name} — параметр вне рабочей зоны`, 'ok'); continue; }
      const v = S.P[a.key];
      const hyst = Math.abs(c.warn) * 0.03 + (c.dec === 0 ? 1 : 0.01);
      const gone = (c.low ? v > c.warn + hyst : v < c.warn - hyst);
      if (gone) {
        a.state = 'cleared';
        log(`${a.code} · условие снято: ${a.name} вернулся в норму`, 'ok');
      }
    }
  }

  function ack(id) {
    const a = S.alarms.find(x => x.id === id);
    if (!a || a.state === 'acked' || a.state === 'cleared-acked') return;
    a.state = a.state === 'cleared' ? 'cleared-acked' : 'acked';
    log(`${a.code} · квитировано оператором`, 'act');
  }
  function ackAll() {
    let n = 0;
    S.alarms.forEach(a => {
      if (a.state !== 'acked' && a.state !== 'cleared-acked') {
        a.state = a.state === 'cleared' ? 'cleared-acked' : 'acked';
        n++;
      }
    });
    if (n) log(`Квитировано событий: ${n}`, 'act');
    return n;
  }

  /* ----------------------------- МОДЕЛЬ ПРОЦЕССА --------------------------- */
  function disturbancesAt() {
    const p = S.program;
    S.disturb = [];
    if (!p || !p.disturbances) return;
    p.disturbances.forEach(d => {
      if (S.t >= d.t && S.t < d.t + d.dur) S.disturb.push(d);
    });
  }

  function stepToward(cur, target, tau, dt) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }

  function physics(dt) {
    const st = S.settings;
    const Unom = st.unom, Fnom = st.fnom, Inom = st.inom;
    const open = (S.state === 'running');

    // --- задание по текущей ступени профиля
    let target = { f:0, u:0, load:0 };
    if (S.state === 'running' || S.state === 'paused') {
      const cur = S.steps[S.stepIndex];
      if (cur) target = { f:Fnom*cur[0]/100, u:Unom*cur[1]/100, load:cur[2]/100 };
    }
    S.sp = target;

    // --- темп нарастания / спада (штатный режим)
    const ramp = Math.max(0.05, +st.ramp || 0.6);
    const dU = ramp * dt;                           // кВ за шаг
    const dF = (Fnom / Unom) * ramp * dt;           // Гц за шаг (закон V/f)
    const hardStop = (S.state === 'tripping' || S.state === 'estop');

    function approach(cur, tgt, d) {
      if (cur < tgt) return Math.min(tgt, cur + d);
      return Math.max(tgt, cur - d);
    }
    if (S.state === 'running') {
      S.a.u = approach(S.a.u, target.u, dU);
      S.a.f = approach(S.a.f, target.f, dF);
      S.a.load = stepToward(S.a.load, target.load, 1.8, dt);
      // скорость определяется заданием, факт следует за ним с малой инерцией
    } else if (hardStop) {
      const k = S.state === 'estop' ? 4 : 2.2;      // ускоренный сброс
      S.a.u = approach(S.a.u, 0, dU * k * 3);
      S.a.f = approach(S.a.f, 0, dF * k * 3);
      S.a.load = stepToward(S.a.load, 0, 0.7, dt);
    } else {
      S.a.u = approach(S.a.u, 0, dU);
      S.a.f = approach(S.a.f, 0, dF);
      S.a.load = stepToward(S.a.load, 0, 2.5, dt);
    }

    disturbancesAt();
    const P = S.P;
    const load = S.a.load, u = S.a.u, f = S.a.f;
    const rel = Fnom ? f / Fnom : 0;

    // --- электрические величины
    P.u_out = Math.max(0, u + (u > 0.1 ? rnd(0.012) : 0));
    P.f_out = Math.max(0, f + (f > 0.2 ? rnd(0.02) : 0));
    const iTarget = Inom * load * Math.max(0.12, rel) + (u > 0.1 ? 6 : 0);
    P.i_out = Math.max(0, iTarget + (iTarget > 1 ? rnd(iTarget * 0.006) : 0));
    P.cosphi = u > 0.2 ? clamp(0.855 + 0.105 * load + rnd(0.004), 0.6, 0.995) : 0;
    P.p_out = Math.sqrt(3) * (P.u_out * 1000) * P.i_out * Math.max(P.cosphi, 0) / 1e6;
    P.efficiency = u > 0.2 ? clamp(97.6 - 1.9 * (1 - load) - 1.1 * (1 - rel) + rnd(0.05), 80, 99) : 0;
    const pIn = P.efficiency > 0 ? P.p_out / (P.efficiency / 100) : 0;
    P.i_in = pIn > 0 ? pIn * 1e6 / (Math.sqrt(3) * (CFG.Uin * 1000) * 0.985) : 0;
    P.u_in = CFG.Uin + rnd(0.02);
    P.udc = P.u_out * 1.4145 * (1 + 0.004 * load) + (P.u_out > 0.2 ? rnd(0.03) : 0);
    P.udc_ripple = u > 0.2 ? clamp(0.75 + 1.05 * load + rnd(0.06), 0.2, 6) : 0;
    P.thd = u > 0.2 ? clamp(1.35 + 3.4 * Math.pow(1 - rel, 1.25) + 0.35 * (1 - load) + rnd(0.08), 0.5, 12) : 0;
    P.n_motor = f > 0.2 ? 1480 * rel + rnd(3) : 0;
    P.torque = load * 100 + (load > 0.02 ? rnd(0.7) : 0);
    P.aux_u = 380 + rnd(2.4);

    // --- тепловая модель (жидкостное охлаждение: рост температуры близок к линейному по потерям)
    const heat = Math.pow(P.i_out / Inom, 0.4) * (0.9 + 0.1 * rel);
    const dTA = S.disturb.filter(d => d.key === 't_amb').reduce((s, d) => s + d.add, 0);
    P.t_amb = CFG.Tamb + dTA + rnd(0.15);
    P.t_igbt = stepToward(P.t_igbt || P.t_amb, P.t_amb + 4 + 38 * heat, 20, dt) + rnd(0.25);
    P.t_trans = stepToward(P.t_trans || P.t_amb, P.t_amb + 5 + 34 * heat, 55, dt) + rnd(0.2);
    P.t_cool = stepToward(P.t_cool || P.t_amb, P.t_amb + 2 + 16 * heat, 22, dt) + rnd(0.2);
    const dFlow = S.disturb.filter(d => d.key === 'flow').reduce((s, d) => s + d.add, 0);
    P.flow = clamp(121 - 9 * heat + dFlow + rnd(1.2), 0, 200);
    P.press = clamp(3.15 - 0.28 * heat + dFlow / 260 + rnd(0.03), 0, 6);
    P.vibro = clamp(1.1 + 2.9 * Math.pow(load, 1.6) + rnd(0.12), 0, 12);

    // --- выборка «номинального режима» для протокола
    if (S.state === 'running' && load > 0.95 && rel > 0.97) {
      S.nominal.push({ u:P.u_out, i:P.i_out, f:P.f_out, cos:P.cosphi, eff:P.efficiency, thd:P.thd, p:P.p_out, t:P.t_igbt, rip:P.udc_ripple });
    }
    // --- выдержка перегрузки
    if (S.program && S.program.overload && load >= (S.program.overloadLevel/100) - 0.03) {
      S.overloadHold += dt;
    }

    // --- контроль уставок
    const energized = P.u_out > 0.4;                    // стенд под напряжением
    const loadFrac = S.a.load;
    for (const c of CHANNELS) {
      if (c.warn === undefined) continue;
      const v = P[c.key];
      if (v === undefined) continue;
      // производные величины (КПД, cos φ, THD, пульсации) контролируются только в рабочей зоне
      if (c.gate && (!energized || loadFrac < (c.gateLoad || 0))) continue;
      if (!c.low) {
        if (c.alarm !== undefined && v >= c.alarm) raiseAlarm(c.key, 'alarm', v, c.alarm, { trip:c.trip });
        else if (v >= c.warn) raiseAlarm(c.key, 'warn', v, c.warn);
      } else {
        if (c.alarm !== undefined && v <= c.alarm) raiseAlarm(c.key, 'alarm', v, c.alarm, { trip:c.trip });
        else if (v <= c.warn) raiseAlarm(c.key, 'warn', v, c.warn);
      }
    }
    clearIfNormal(energized, loadFrac);

    // --- фиксация отклонений (расхождение задания и факта)
    if (S.state === 'running' && u > 0.3) {
      const dev = Math.abs(P.u_out - S.sp.u) / Math.max(S.sp.u, 0.001);
      if (dev > 0.03) S.stats.deviations++;
    }
  }

  function sample() {
    S.hist.t.push(+S.clock.toFixed(2));
    CHANNELS.forEach(c => S.hist[c.key].push(+(S.P[c.key] || 0).toFixed(3)));
    if (S.hist.t.length > CAP) {
      S.hist.t.splice(0, TRIM);
      CHANNELS.forEach(c => S.hist[c.key].splice(0, TRIM));
    }
  }

  /* ------------------------------ ХОД ПРОГРАММЫ ---------------------------- */
  function totalDuration() { return S.steps.reduce((s, x) => s + x[3], 0); }

  function stepPosition() {
    let acc = 0;
    for (let i = 0; i < S.steps.length; i++) {
      const d = S.steps[i][3];
      if (S.t < acc + d) return { index:i, inStep:S.t - acc, remain:acc + d - S.t, start:acc, dur:d };
      acc += d;
    }
    return { index:S.steps.length - 1, inStep:S.steps[S.steps.length-1] ? S.steps[S.steps.length-1][3] : 0, remain:0, start:acc, dur:0 };
  }

  let lastLoggedStep = -1;

  function runLogic(dt) {
    if (S.state !== 'running') return;
    const pos = stepPosition();
    if (pos.index !== S.stepIndex) {
      if (S.stepIndex >= 0) log(`Ступень ${S.stepIndex + 1} завершена`, 'ok');
      S.stepIndex = pos.index;
      const st = S.steps[pos.index];
      if (st) {
        log(`Ступень ${pos.index + 1}/${S.steps.length}: задание ${st[0]} % f, ${st[1]} % U, нагрузка ${st[2]} %, выдержка ${st[3]} с`, 'act');
        act('Переход на ступень ' + (pos.index + 1),
            `Задание: f = ${(S.settings.fnom * st[0] / 100).toFixed(1)} Гц, U = ${(S.settings.unom * st[1] / 100).toFixed(2)} кВ, нагрузка ${st[2]} %`,
            pos.index + 1);
      }
    }
    if (S.t >= totalDuration()) finish('completed');
  }

  function finish(reason) {
    const wasState = S.state;
    S.state = 'done';
    S.stateText = 'ИСПЫТАНИЕ ЗАВЕРШЕНО';
    S.finishedReason = reason;
    S.a = { f:0, u:0, load:0 };
    S.sp = { f:0, u:0, load:0 };
    if (reason === 'completed') {
      log('Программа испытания выполнена полностью. Стенд выведен на нулевые параметры.', 'ok');
      act('Завершение программы', 'Профиль отработан, нагрузка снята, стенд обесточен.', 1);
    }
    S.result = evaluate();
    log(`Предварительный вердикт: ${S.result.verdict === 'pass' ? 'СООТВЕТСТВУЕТ' : 'НЕ СООТВЕТСТВУЕТ'} (${S.result.reasons.length} замечаний)`, S.result.verdict === 'pass' ? 'ok' : 'err');
  }

  /* --------------------------------- ПУСК --------------------------------- */
  function start(settings, steps, programId) {
    S.settings = Object.assign({}, settings);
    S.steps = steps.map(s => s.slice());
    S.program = PROGRAMS.find(p => p.id === programId) || PROGRAMS[0];
    S.state = 'running';
    S.stateText = 'ИСПЫТАНИЕ ИДЁТ';
    S.t = 0;
    S.stepIndex = -1;
    lastLoggedStep = -1;
    S.a = { f:0, u:0, load:0 };
    S.sp = { f:0, u:0, load:0 };
    S.nominal = [];
    S.overloadHold = 0;
    S.tripReason = null;
    S.result = null;
    S.startedAt = new Date();
    S.settings.ramp = Math.max(0.05, +S.settings.ramp || 0.6);
    log(`ПУСК ИСПЫТАНИЯ · программа ${S.program.code} «${S.program.name}»`, 'ok');
    log(`Уставки: U = ${S.settings.unom} кВ, f = ${S.settings.fnom} Гц, Iн = ${S.settings.inom} А; защита по I: ${S.settings.itrip} А, по T: ${S.settings.ttrip} °C`, 'act');
    act('Подача силового питания', 'Вводной выключатель Q1 включён, звено DC заряжено, ШИМ разрешена.', 1);
  }

  function pause() {
    if (S.state !== 'running') return;
    S.state = 'paused';
    S.stateText = 'ПАУЗА';
    log('Испытание приостановлено оператором: задание удерживается на текущем уровне', 'warn');
    act('Пауза', 'Профиль остановлен, параметры удерживаются, запись данных продолжается.', 1);
  }
  function resume() {
    if (S.state !== 'paused') return;
    S.state = 'running';
    S.stateText = 'ИСПЫТАНИЕ ИДЁТ';
    log('Испытание возобновлено', 'ok');
    act('Возобновление', 'Профиль продолжен с текущей ступени.', 1);
  }
  function normalStop() {
    if (S.state !== 'running' && S.state !== 'paused') return;
    S.state = 'done';
    S.stateText = 'ШТАТНЫЙ ОСТАНОВ';
    S.a = { f:0, u:0, load:0 };
    log('Штатный останов по команде оператора. Нагрузка снята, напряжение снижено до нуля.', 'warn');
    act('Штатный останов', 'Плавное снижение U и f, отключение нагрузки, разрядка звена DC.', 1);
    S.result = evaluate();
  }
  function estop() {
    S.state = 'estop';
    S.stateText = 'АВАРИЙНЫЙ ОСТАНОВ';
    S.seq++;
    S.alarms.unshift({
      id:'a' + S.seq, seq:S.seq, code:'ES-001', sev:'alarm', key:'estop',
      name:'Аварийный останов стенда (E-STOP)', unit:'', dec:0, value:'нажата', limit:'—',
      source:'Пост оператора · кнопка E-STOP', state:'active', t:nowStr(), clock:S.clock,
      cause:'Ручное отключение оператором. Возможные причины: угроза безопасности, посторонний шум, дым, нарушение изоляции, присутствие людей в зоне стенда.',
      actions:[
        'Немедленное отключение вводного выключателя Q1 и снятие импульсов ШИМ',
        'Разрядка звена постоянного тока через тормозной резистор (не более 20 с)',
        'Включение световой и звуковой сигнализации «СТЕНД ОБЕСТОЧЕН»',
        'Блокировка повторного пуска до квитирования и повторной проверки'
      ]
    });
    S.stats.alarms++;
    log('ES-001 · АВАРИЙНЫЙ ОСТАНОВ (E-STOP). Силовой тракт отключён.', 'err');
    act('Аварийный останов', 'Отключение Q1, сброс ШИМ, разрядка DC-звена, блокировка пуска.', 2);
    S.tripReason = 'ES-001 · Аварийный останов';
  }

  /* ------------------------------ РАСЧЁТ ИТОГОВ ---------------------------- */
  function stats(key) {
    const a = S.hist[key];
    if (!a || !a.length) return null;
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    const avg = sum / a.length;
    let s2 = 0;
    for (const v of a) s2 += (v - avg) * (v - avg);
    const sd = Math.sqrt(s2 / a.length);
    return { min:mn, max:mx, avg, sd, n:a.length };
  }

  function avgOf(arr, key) {
    if (!arr.length) return null;
    return arr.reduce((s, x) => s + x[key], 0) / arr.length;
  }
  function sdOf(arr, key) {
    if (arr.length < 2) return 0;
    const m = avgOf(arr, key);
    return Math.sqrt(arr.reduce((s, x) => s + (x[key] - m) * (x[key] - m), 0) / arr.length);
  }

  function evaluate() {
    const rows = [];
    const reasons = [];
    const nom = S.nominal;
    const st = S.settings || {};
    const isCheck = id => S.checks[id] && S.checks[id].result === 'ok';
    const n = (v, d) => fmtNum(v, d === undefined ? 2 : d);

    function row(name, normText, actual, dev, ok) {
      rows.push({ n:rows.length + 1, name, norm:normText, actual, dev, ok });
      if (!ok) reasons.push(name);
    }

    const iso = S.checks.iso ? S.checks.iso.raw : null;
    row('Сопротивление изоляции главных цепей', 'не менее 10 МОм',
        iso !== null && iso !== undefined ? n(iso, 1) + ' МОм' : 'нет данных',
        iso !== null && iso !== undefined ? n(iso - 10, 1) + ' МОм' : '—',
        iso !== null && iso !== undefined ? iso >= 10 : false);

    row('Испытание изоляции повышенным напряжением 12 кВ, 60 с', 'без пробоя и перекрытия',
        isCheck('hivolt') ? 'выдержано' : 'не выполнено', '—', isCheck('hivolt'));

    row('Заземление корпуса стенда', 'не более 4 Ом',
        S.checks.ground ? n(S.checks.ground.raw, 2) + ' Ом' : 'нет данных',
        S.checks.ground ? n(4 - S.checks.ground.raw, 2) + ' Ом' : '—',
        !!(S.checks.ground && S.checks.ground.raw <= 4));

    const avgU = avgOf(nom, 'u'), avgP = avgOf(nom, 'p'), avgCos = avgOf(nom, 'cos');
    const minEff = nom.length ? Math.min.apply(null, nom.map(x => x.eff)) : null;
    const maxThd = nom.length ? Math.max.apply(null, nom.map(x => x.thd)) : null;
    const maxT = stats('t_igbt');
    const maxRip = stats('udc_ripple');
    const maxI = stats('i_out');
    const fStat = stats('f_out');

    const done = S.state === 'done';
    const hasNom = nom.length > 5;

    const pct = (v, base) => (v - base) / base * 100;

    row('Установившееся выходное напряжение на номинале', `${st.unom || 6} кВ ± 5 %`,
        hasNom ? n(avgU, 2) + ' кВ' : 'нет данных (номинал не достигнут)',
        hasNom ? n(pct(avgU, st.unom || 6), 2) + ' %' : '—',
        hasNom ? Math.abs(pct(avgU, st.unom || 6)) <= 5 : false);

    row('Выходная мощность на номинале', `не менее ${CFG.Pnom} МВт`,
        hasNom ? n(avgP, 2) + ' МВт' : 'нет данных',
        hasNom ? n(avgP - CFG.Pnom, 2) + ' МВт' : '—',
        hasNom ? avgP >= CFG.Pnom * 0.95 : false);

    row('Стабильность выходной частоты', '50,00 Гц ± 0,10 Гц (σ ≤ 0,05)',
        hasNom ? n(avgOf(nom, 'f'), 2) + ' Гц, σ = ' + n(sdOf(nom, 'f'), 3) : 'нет данных',
        hasNom ? n(avgOf(nom, 'f') - 50, 2) + ' Гц' : '—',
        hasNom ? Math.abs(avgOf(nom, 'f') - 50) <= 0.1 && sdOf(nom, 'f') <= 0.05 : false);

    row('Коэффициент мощности на номинале', 'не менее 0,95',
        hasNom ? n(avgCos, 3) : 'нет данных',
        hasNom ? n(avgCos - 0.95, 3) : '—',
        hasNom ? avgCos >= 0.95 : false);

    row('Коэффициент полезного действия', 'не менее 96,0 %',
        minEff !== null ? 'мин. ' + n(minEff, 2) + ' %' : 'нет данных',
        minEff !== null ? n(minEff - 96, 2) + ' %' : '—',
        minEff !== null ? minEff >= 96 : false);

    row('Коэффициент искажения синусоидальности THD U вых', 'не более 5,0 %',
        maxThd !== null ? 'макс. ' + n(maxThd, 2) + ' %' : 'нет данных',
        maxThd !== null ? n(maxThd - 5, 2) + ' %' : '—',
        maxThd !== null ? maxThd <= 5 : false);

    row('Максимальная температура модулей IGBT', `не более ${st.ttrip || 85} °C (предупр. ${st.twarn || 70} °C)`,
        maxT ? n(maxT.max, 1) + ' °C' : 'нет данных',
        maxT ? n(maxT.max - (st.ttrip || 85), 1) + ' °C' : '—',
        maxT ? maxT.max <= (st.ttrip || 85) : false);

    row('Пульсации напряжения звена постоянного тока', 'не более 2,5 %',
        maxRip ? 'макс. ' + n(maxRip.max, 2) + ' %' : 'нет данных',
        maxRip ? n(maxRip.max - 2.5, 2) + ' %' : '—',
        maxRip ? maxRip.max <= 2.5 : false);

    row('Максимальный выходной ток за испытание', `не более ${st.itrip || 220} А`,
        maxI ? n(maxI.max, 1) + ' А' : 'нет данных',
        maxI ? n(maxI.max - (st.itrip || 220), 1) + ' А' : '—',
        maxI ? maxI.max <= (st.itrip || 220) : false);

    if (S.program && S.program.overload) {
      const need = S.program.overloadNeed;
      row('Выдержка перегрузки 150 % Iн', `не менее ${need} с без отключения`,
          n(S.overloadHold, 1) + ' с' + (S.stats.trips ? ' (отключение защитой)' : ''),
          n(S.overloadHold - need, 1) + ' с',
          S.overloadHold >= need && !S.stats.trips);
    }

    if (S.program && S.program.expectTrip) {
      const tripped = S.alarms.some(a => a.sev === 'alarm' && a.key !== 'estop');
      row('Срабатывание технологической защиты по превышению тока', 'защита срабатывает, стенд отключается',
          tripped ? `сработала (${S.tripReason || 'защита по току'})` : 'не сработала',
          '—', tripped);
    } else {
      row('Количество аварийных отключений за испытание', '0 (без срабатывания защит)',
          String(S.stats.trips), String(S.stats.trips), S.stats.trips === 0);
    }

    row('Завершение программы испытания', 'программа отработана полностью',
        done ? 'завершено' : 'не завершено', '—', done);

    const verdict = reasons.length === 0 ? 'pass' : 'fail';
    return { rows, reasons, verdict, hasNom, isDone:done };
  }

  /* --------------------------------- ЭКСПОРТ ------------------------------- */
  function csvTrends(dec) {
    const head = ['t,' + CHANNELS.map(c => c.key).join(',')];
    const lines = S.hist.t.map((t, i) => t + ',' + CHANNELS.map(c => (S.hist[c.key][i] ?? 0)).join(','));
    return head.concat(lines).join('\n');
  }
  function csvLog() {
    const head = 'Время;Код;Уровень;Параметр;Значение;Ед.;Уставка;Источник;Состояние';
    const sev = { alarm:'Авария', warn:'Предупреждение', info:'Информация' };
    const stt = { active:'Активно', acked:'Квитировано', cleared:'Устранено', 'cleared-acked':'Устранено, квитировано' };
    const rows = S.alarms.map(a => [a.t, a.code, sev[a.sev] || a.sev, a.name,
      (typeof a.value === 'number' ? fmtNum(a.value, a.dec) : a.value), a.unit,
      (typeof a.limit === 'number' ? fmtNum(a.limit, a.dec) : a.limit), a.source, stt[a.state] || a.state].join(';'));
    return [head].concat(rows).join('\n');
  }
  function csvWave() {
    const rows = [];
    const f = S.P.f_out || 0, u = S.P.u_out || 0;
    const N = 400, T = f > 0.2 ? 1 / f : 0.02;
    for (let i = 0; i < N; i++) {
      const t = i * T / N;
      const a = 2 * Math.PI * f * t;
      const ph = u * 1000 * Math.SQRT2 / Math.sqrt(3) / 1000;
      rows.push([t.toFixed(6), (ph * Math.sin(a)).toFixed(4), (ph * Math.sin(a - 2.0944)).toFixed(4), (ph * Math.sin(a + 2.0944)).toFixed(4)].join(';'));
    }
    return ['t;Ua;Ub;Uc'].concat(rows).join('\n');
  }
  function snapshot() {
    return {
      bench: { model:CFG.model, serial:CFG.serial, unom:CFG.Unom, fnom:CFG.Fnom, inom:CFG.Inom },
      session: {
        program:S.program ? S.program.code : null,
        programName:S.program ? S.program.name : null,
        startedAt:S.startedAt, finishedAt:S.savedAt || new Date(),
        duration:S.t, clock:S.clock, mode:'автоматический',
        operator:S.settings.operator || 'Иванов А. П.',
        settings:S.settings, checks:S.checks,
        verdict:S.result ? S.result.verdict : null,
        rows:S.result ? S.result.rows : [],
        stats:S.stats,
        alarms:S.alarms, events:S.events.slice(0, 200), actions:S.actions
      },
      channels: CHANNELS.map(c => ({ key:c.key, name:c.name, unit:c.unit, stat:stats(c.key) })),
      trends: S.hist
    };
  }

  /* -------------------------------- ОСНОВНОЙ ЦИКЛ -------------------------- */
  let acc = 0, last = performance.now();
  const BASE_DT = 1 / CFG.tickHz;

  // завершение аварийного сброса (общее для реального времени и ускоренной прокрутки)
  function settleEmergency() {
    if ((S.state === 'tripping' || S.state === 'estop') && S.a.u < 0.05) {
      const wasEstop = S.state === 'estop';
      S.state = 'done';
      S.stateText = wasEstop ? 'ОСТАНОВ ПО E-STOP' : 'АВАРИЙНОЕ ОТКЛЮЧЕНИЕ';
      S.a = { f:0, u:0, load:0 };
      log(wasEstop ? 'Стенд обесточен. Разрядка звена DC завершена (18 с).' : 'Стенд обесточен. Зафиксирована причина отключения.', 'err');
      S.result = evaluate();
    }
  }

  function tickOnce(dt, advanceClock) {
    S.clock += dt;
    if (advanceClock) S.clockOffset += dt;
    if (S.state === 'running' || S.state === 'paused') {
      if (S.state === 'running') S.t += dt;
      runLogic(dt);
    }
    physics(dt);
    sample();
    settleEmergency();
  }

  function loop(now) {
    const wall = Math.min(0.5, (now - last) / 1000);
    last = now;
    acc += wall * S.speed;
    let guard = 0;
    while (acc >= BASE_DT && guard++ < 40) {
      acc -= BASE_DT;
      tickOnce(BASE_DT, false);
    }
    S.subscribers.forEach(fn => { try { fn(S); } catch (e) { console.error(e); } });
    requestAnimationFrame(loop);
  }

  /* Ускоренная прокрутка модели (демонстрация, проверка алгоритмов, подготовка
     данных для протокола). Синхронно прогоняет sec модельных секунд. */
  function fastForward(sec) {
    const n = Math.max(0, Math.round(sec * CFG.tickHz));
    for (let i = 0; i < n; i++) tickOnce(BASE_DT, true);
    return { clock:S.clock, t:S.t, state:S.state, points:S.hist.t.length };
  }

  /* ---------------------------------- API --------------------------------- */
  function initP() {
    CHANNELS.forEach(c => { S.P[c.key] = (c.key === 'u_in' ? CFG.Uin : c.key === 'aux_u' ? 380 : c.key === 't_amb' ? CFG.Tamb : 0); });
    S.P.t_igbt = CFG.Tamb; S.P.t_trans = CFG.Tamb; S.P.t_cool = CFG.Tamb;
  }

  global.Sim = {
    CFG, CHANNELS, CH, PROGRAMS, CHECKS, S,
    init(){ initP(); log('АРМ оператора запущено. Связь с ПЛК установлена, конфигурация ПО v3.14.2 загружена.', 'ok'); requestAnimationFrame(loop); },
    subscribe(fn){ S.subscribers.push(fn); },
    setSpeed(x){ S.speed = x; log(`Множитель модельного времени: ×${x}`, 'info'); },
    start, pause, resume, normalStop, estop, ack, ackAll,
    finish, fastForward,
    raiseAlarm, log, act,
    stats, evaluate,
    totalDuration,
    stepPosition,
    csvTrends, csvLog, csvWave, snapshot,
    setProgram(id){ S.program = PROGRAMS.find(p => p.id === id) || PROGRAMS[0]; },
    reset(){
      S.state = 'idle'; S.stateText = 'ОСТАНОВЛЕН'; S.t = 0; S.stepIndex = -1;
      S.a = { f:0, u:0, load:0 }; S.alarms = []; S.events = []; S.actions = [];
      S.stats = { alarms:0, warns:0, deviations:0, actions:0, trips:0 };
      S.checks = {}; S.nominal = []; S.overloadHold = 0; S.result = null;
      S.hist.t = []; CHANNELS.forEach(c => { S.hist[c.key] = []; });
      initP();
    },
    setCheck(id, res){ S.checks[id] = res; },
    fmtNum, timeStr, nowStr
  };
})(window);
