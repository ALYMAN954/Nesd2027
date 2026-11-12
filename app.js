(function () {
  'use strict';

  var API = (window.CNE_CONFIG && window.CNE_CONFIG.API_URL) || '';
  var DEMO = !API;

  var cfg = null;
  var clockOffset = 0;      // serverNow - clientNow
  var accessCode = '';
  var currentStep = 0;
  var timerHandle = null;
  var submitting = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Backend calls                                                       */
  /* ------------------------------------------------------------------ */

  var DEMO_CFG = (function () {
    var L = ['Strongly Agree', 'Agree', 'Disagree', 'Strongly Disagree'], Y = ['Yes', 'No'];
    return {
      ok: true, sessionId: 'demo', topic: 'Sepsis', speaker: 'Ms. Nouf Alamri, RN', date: 'November 04 2026',
      codeRequired: false, open: true, closesAt: 0, serverNow: Date.now(),
      units: ['Nursing Admin', 'Nursing Supervisor', 'Headnurse', 'ER', 'OPD', 'AICU', 'PICU', 'HDU', 'EU', 'OR\\DSU\\PACU', 'NICU', 'L&D', 'OBGYNE', 'PW', 'FMSW', 'MMSW', 'Intern', 'CSSD', 'PHC', 'Other'],
      questions: [
        { id: 'q5', no: 1, type: 'choice', required: true, options: L, text: 'The content of this CNE had relevance to my job and work environment' },
        { id: 'q6', no: 2, type: 'choice', required: true, options: L, text: 'The content of this CNE will enhance my knowledge/skill or abilities' },
        { id: 'q7', no: 3, type: 'choice', required: true, options: L, text: 'I will apply the knowledge I gained from this presentation in my daily practice' },
        { id: 'q8', no: 4, type: 'choice', required: true, options: L, text: 'I will share the knowledge I gained with my colleagues' },
        { id: 'q9', no: 5, type: 'choice', required: true, options: L, text: 'This CNE addressed my professional needs' },
        { id: 'q10', no: 6, type: 'choice', required: true, options: L, text: 'The presentation met my expected learning outcome' },
        { id: 'q11', no: 7, type: 'choice', required: true, options: Y, text: 'Did you get the opportunity to assess your knowledge or reflect on your current practice?' },
        { id: 'q12', no: 8, type: 'choice', required: true, options: Y, text: 'Did you find this CNE learning activity engaging?' },
        { id: 'q13', no: 9, type: 'choice', required: true, options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'], text: 'Rate your experience in attending this CNE' },
        { id: 'q14', no: 10, type: 'choice', required: false, options: Y, text: 'Did you encounter any difficulties in acquiring transportation coming to the CNE? (for staff living in Al-Rawdha Hostel ONLY)' },
        { id: 'q15', no: 11, type: 'text', required: false, text: 'If you encountered any difficulties with transportation, please specify' },
        { id: 'q16', no: 12, type: 'choice', required: true, options: Y, text: 'Do you like to be speaker for our future CNE?' },
        { id: 'q17', no: 13, type: 'text', required: true, text: 'Suggestions for further improvement' }
      ]
    };
  })();

  function post(payload) {
    if (DEMO) {
      if (payload.action === 'lookup') {
        return new Promise(function (res) {
          setTimeout(function () {
            res(String(payload.idNo).trim() === '123456'
              ? { ok: true, found: true, name: 'Test Nurse', council: 'SCFHS-1', unit: 'Other: Dialysis' }
              : { ok: true, found: false });
          }, 300);
        });
      }
      return new Promise(function (res) {
        setTimeout(function () { res({ ok: true }); }, 500);
      });
    }
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // plain text avoids a CORS preflight on Apps Script
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function loadConfig() {
    if (DEMO) return Promise.resolve(DEMO_CFG);
    return fetch(API + (API.indexOf('?') > -1 ? '&' : '?') + 'action=config&_=' + Date.now())
      .then(function (r) { return r.json(); });
  }

  /* ------------------------------------------------------------------ */
  /* Screens                                                             */
  /* ------------------------------------------------------------------ */

  var ALL = ['s-loading', 's-error', 's-closed', 's-already', 's-1', 's-2', 's-3', 's-done'];

  function show(id) {
    ALL.forEach(function (s) { $(s).hidden = (s !== id); });
    var m = /^s-(\d)$/.exec(id);
    currentStep = m ? Number(m[1]) : 0;
    $('stepper').hidden = !m;
    if (m) {
      var items = document.querySelectorAll('#stepper li[data-step]');
      Array.prototype.forEach.call(items, function (li) {
        var n = Number(li.getAttribute('data-step'));
        li.classList.toggle('active', n === currentStep);
        li.classList.toggle('done', n < currentStep);
        li.querySelector('.dot').textContent = n < currentStep ? '✓' : String(n);
      });
    }
    var h = $(id).querySelector('h2');
    window.scrollTo(0, 0);
    if (h) h.focus({ preventScroll: true });
  }

  function startTimer() {
    clearInterval(timerHandle);
    var t = $('timer');
    if (!cfg || !cfg.closesAt) { t.hidden = true; return; }
    function tick() {
      var left = cfg.closesAt - (Date.now() + clockOffset);
      if (left <= 0) { t.textContent = 'Closed'; clearInterval(timerHandle); return; }
      var s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      var mm = (h ? String(h) + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
      t.textContent = 'Closes in ' + mm;
    }
    t.hidden = false;
    tick();
    timerHandle = setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Form building                                                       */
  /* ------------------------------------------------------------------ */

  function radioGroup(name, options, cls, onChange) {
    var wrap = el('div', { 'class': 'opts ' + cls });
    options.forEach(function (o, i) {
      var id = name + '-' + i;
      var box = el('div', { 'class': 'opt' });
      var input = el('input', { type: 'radio', name: name, id: id, value: o });
      var label = el('label', { 'for': id }, o);
      input.addEventListener('change', function () { if (onChange) onChange(o); });
      box.appendChild(input); box.appendChild(label);
      wrap.appendChild(box);
    });
    return wrap;
  }

  function checkedValue(name) {
    var c = document.querySelector('input[name="' + name + '"]:checked');
    return c ? c.value : '';
  }

  function buildUnits() {
    var box = $('units');
    box.innerHTML = '';
    cfg.units.forEach(function (u, i) {
      var id = 'unit-' + i;
      var opt = el('div', { 'class': 'opt' });
      var input = el('input', { type: 'radio', name: 'unit', id: id, value: u });
      var label = el('label', { 'for': id }, u === 'Other' ? 'Other:' : u);
      input.addEventListener('change', function () {
        var other = (checkedValue('unit') === 'Other');
        $('other-wrap').hidden = !other;
        if (other) $('other-unit').focus();
        setErr('f-unit', 'e-unit', '');
      });
      opt.appendChild(input); opt.appendChild(label);
      box.appendChild(opt);
    });
  }

  function buildQuestions() {
    var box = $('questions');
    box.innerHTML = '';
    cfg.questions.forEach(function (q) {
      var row = el('div', { 'class': 'q', id: 'row-' + q.id });
      row.appendChild(el('div', { 'class': 'num', 'aria-hidden': 'true' }, String(q.no)));
      var body = el('div', { 'class': 'body' });

      if (q.type === 'choice') {
        var fs = el('fieldset', { 'class': 'field', id: 'f-' + q.id });
        var lg = el('legend', { 'class': 'qtext' }, q.text);
        if (!q.required) lg.appendChild(el('span', { 'class': 'opt-tag' }, 'Optional'));
        fs.appendChild(lg);
        var cls = q.options.length === 5 ? 'five' : (q.options.length === 2 ? 'yn' : 'likert');
        fs.appendChild(radioGroup(q.id, q.options, cls, function () {
          setErr('row-' + q.id, 'e-' + q.id, '');
          row.classList.remove('group-err');
          if (!q.required) clr.hidden = false;
        }));
        var clr = el('button', { type: 'button', 'class': 'clear-btn' }, 'Clear answer');
        clr.hidden = true;
        clr.addEventListener('click', function () {
          var all = document.querySelectorAll('input[name="' + q.id + '"]');
          Array.prototype.forEach.call(all, function (i) { i.checked = false; });
          clr.hidden = true;
        });
        if (!q.required) fs.appendChild(clr);
        fs.appendChild(el('p', { 'class': 'err-msg', id: 'e-' + q.id, role: 'alert' }));
        body.appendChild(fs);
      } else {
        var wrap = el('div', { 'class': 'field', id: 'f-' + q.id });
        var lb = el('label', { 'for': 'in-' + q.id, 'class': 'qtext', style: 'font-weight:600;margin-bottom:12px' }, q.text);
        if (!q.required) lb.appendChild(el('span', { 'class': 'opt-tag' }, 'Optional'));
        wrap.appendChild(lb);
        var ta = el('textarea', { id: 'in-' + q.id, maxlength: '1500', rows: '4' });
        ta.addEventListener('input', function () { setErr('row-' + q.id, 'e-' + q.id, ''); });
        wrap.appendChild(ta);
        wrap.appendChild(el('p', { 'class': 'err-msg', id: 'e-' + q.id, role: 'alert' }));
        body.appendChild(wrap);
      }
      row.appendChild(body);
      box.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Validation helpers                                                  */
  /* ------------------------------------------------------------------ */

  function setErr(boxId, msgId, msg) {
    var b = $(boxId), m = $(msgId);
    if (!b || !m) return;
    m.textContent = msg || '';
    b.classList.toggle('invalid', !!msg);
    var input = b.querySelector('input[type="text"], textarea');
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function val(id) { return $(id).value.replace(/\s+/g, ' ').trim(); }

  ['name', 'idno', 'council'].forEach(function (id) {
    var map = { name: ['f-name', 'e-name'], idno: ['f-id', 'e-id'], council: ['f-council', 'e-council'] };
    $(id).addEventListener('input', function () { setErr(map[id][0], map[id][1], ''); });
  });
  $('code').addEventListener('input', function () { setErr('f-code', 'e-code', ''); });

  function firstInvalid() {
    var n = document.querySelector('.invalid, .group-err');
    if (n) {
      n.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var f = n.querySelector('input, textarea');
      if (f) f.focus({ preventScroll: true });
    }
  }

  function validateStep2() {
    var ok = true;
    var name = val('name'), id = val('idno'), cn = val('council');
    if (name.length < 3) { setErr('f-name', 'e-name', 'Enter your full name.'); ok = false; }
    if (id.length < 3) { setErr('f-id', 'e-id', 'Enter your ID number.'); ok = false; }
    if (cn.length < 3) { setErr('f-council', 'e-council', 'Enter your Saudi Council number.'); ok = false; }
    var unit = checkedValue('unit');
    if (!unit) { setErr('f-unit', 'e-unit', 'Select your unit.'); ok = false; }
    else if (unit === 'Other' && !val('other-unit')) { setErr('f-unit', 'e-unit', 'Write your unit in the box.'); ok = false; }
    if (!ok) firstInvalid();
    return ok;
  }

  function collectAnswers() {
    var out = {};
    cfg.questions.forEach(function (q) {
      out[q.id] = q.type === 'choice' ? checkedValue(q.id) : $('in-' + q.id).value.trim();
    });
    return out;
  }

  function validateStep3() {
    var ok = true, ans = collectAnswers();
    cfg.questions.forEach(function (q) {
      var row = $('row-' + q.id);
      row.classList.remove('invalid', 'group-err');
      $('e-' + q.id).textContent = '';
      if (q.required && !ans[q.id]) {
        ok = false;
        $('e-' + q.id).textContent = 'Answer this question to continue.';
        row.classList.add(q.type === 'choice' ? 'group-err' : 'invalid');
        if (q.type === 'choice') row.classList.add('invalid');
      }
    });
    if (!ok) {
      var n = document.querySelector('.q.invalid');
      if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    return ok;
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function fillLecture() {
    $('v-topic').textContent = cfg.topic;
    $('v-speaker').textContent = cfg.speaker;
    $('v-date').textContent = cfg.date;
  }

  $('start').addEventListener('click', function () {
    var btn = $('start');
    if (!cfg.codeRequired) { fillLecture(); show('s-2'); return; }
    var c = $('code').value.replace(/\s+/g, ' ').trim();
    if (!c) { setErr('f-code', 'e-code', 'Enter the access code.'); $('code').focus(); return; }
    btn.disabled = true;
    post({ action: 'check_code', code: c }).then(function (r) {
      btn.disabled = false;
      if (r.ok) { accessCode = c; fillLecture(); show('s-2'); }
      else if (r.error === 'CLOSED') { show('s-closed'); }
      else { setErr('f-code', 'e-code', r.message || 'The access code is not correct.'); $('code').focus(); }
    }).catch(function () {
      btn.disabled = false;
      setErr('f-code', 'e-code', 'Could not reach the server. Check your connection and try again.');
    });
  });

  /* ------------------------------------------------------------------ */
  /* Staff directory: fill the details as soon as the ID is typed        */
  /* ------------------------------------------------------------------ */

  var lookupTimer = null, lookupSeq = 0, lookupCache = {}, filled = null;

  function setFindMsg(text) {
    var m = $('find-msg');
    m.textContent = text || '';
    m.hidden = !text;
  }

  function fillUnit(unit) {
    var other = /^Other:\s*(.+)$/.exec(unit || '');
    var want = other ? 'Other' : unit;
    var radios = document.querySelectorAll('input[name="unit"]');
    var hit = null;
    Array.prototype.forEach.call(radios, function (r) { r.checked = false; if (r.value === want) hit = r; });
    if (!hit) { $('other-wrap').hidden = true; return; }
    hit.checked = true;
    $('other-wrap').hidden = !other;
    $('other-unit').value = other ? other[1] : '';
    setErr('f-unit', 'e-unit', '');
  }

  function currentUnitText() {
    var u = checkedValue('unit');
    return u === 'Other' ? 'Other: ' + val('other-unit') : u;
  }

  function applyLookup(r) {
    if (r && r.found) {
      $('name').value = r.name || '';
      $('council').value = r.council || '';
      fillUnit(r.unit);
      ['f-name', 'f-council'].forEach(function (b) { setErr(b, 'e-' + b.slice(2), ''); });
      filled = { name: val('name'), council: val('council'), unit: currentUnitText() };
      setFindMsg('Your details were found. Check them and correct anything that has changed.');
      return;
    }
    // Not found: clear anything we filled for a previous ID (only if the person has not edited it)
    if (filled) {
      if (val('name') === filled.name) $('name').value = '';
      if (val('council') === filled.council) $('council').value = '';
      if (currentUnitText() === filled.unit) {
        Array.prototype.forEach.call(document.querySelectorAll('input[name="unit"]'), function (x) { x.checked = false; });
        $('other-wrap').hidden = true; $('other-unit').value = '';
      }
      filled = null;
    }
    setFindMsg('This ID is not saved yet. Fill in your details; they will appear automatically next time.');
  }

  function runLookup() {
    clearTimeout(lookupTimer);
    var id = val('idno');
    if (id.length < 3) { setFindMsg(''); return; }
    if (Object.prototype.hasOwnProperty.call(lookupCache, id)) { applyLookup(lookupCache[id]); return; }
    var seq = ++lookupSeq;
    post({ action: 'lookup', sessionId: cfg.sessionId, idNo: id }).then(function (r) {
      if (seq !== lookupSeq || val('idno') !== id) return;       // a newer ID was typed meanwhile
      if (!r || !r.ok) { setFindMsg(''); return; }               // stay quiet: the person can type everything
      lookupCache[id] = r;
      applyLookup(r);
    }).catch(function () { if (seq === lookupSeq) setFindMsg(''); });
  }

  $('idno').addEventListener('input', function () {
    clearTimeout(lookupTimer);
    lookupSeq++;                                                  // ignore any answer still on its way
    setFindMsg('');
    if (val('idno').length >= 3) lookupTimer = setTimeout(runLookup, 650);
  });
  $('idno').addEventListener('blur', function () { if (val('idno').length >= 3) runLookup(); });

  $('back-1').addEventListener('click', function () { show('s-1'); });
  $('back-2').addEventListener('click', function () { show('s-2'); });
  $('next-2').addEventListener('click', function () { if (validateStep2()) show('s-3'); });
  $('retry').addEventListener('click', init);

  function showSubmitError(msg) {
    var b = $('submit-error');
    b.textContent = msg; b.hidden = false;
    b.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  $('submit').addEventListener('click', function () {
    if (submitting) return;
    $('submit-error').hidden = true;
    if (!validateStep3()) return;

    var unit = checkedValue('unit');
    var payload = {
      action: 'submit',
      sessionId: cfg.sessionId,
      code: accessCode,
      fullName: val('name'),
      idNo: val('idno'),
      council: val('council'),
      unit: unit,
      otherUnit: unit === 'Other' ? val('other-unit') : '',
      answers: collectAnswers(),
      hp: $('hp').value
    };

    submitting = true;
    var btn = $('submit');
    btn.disabled = true; btn.textContent = 'Submitting…';

    post(payload).then(function (r) {
      submitting = false; btn.disabled = false; btn.textContent = 'Submit evaluation';
      if (r.ok) {
        try { localStorage.setItem('cne_done_' + cfg.sessionId, '1'); } catch (e) {}
        clearInterval(timerHandle);
        show('s-done');
        return;
      }
      switch (r.error) {
        case 'DUPLICATE':
          show('s-2');
          setErr('f-id', 'e-id', 'This ID or Saudi Council number was already used for this lecture. Check the numbers you entered.');
          setErr('f-council', 'e-council', '');
          firstInvalid();
          break;
        case 'CLOSED': show('s-closed'); break;
        case 'STALE': showSubmitError('This form was updated. Reload the page and fill it in again.'); break;
        case 'BAD_CODE': showSubmitError('The access code is not correct. Go back to the first page and enter it again.'); break;
        case 'INVALID': showSubmitError(r.message || 'Some answers are missing or invalid.'); break;
        default: showSubmitError(r.message || 'Your answers were not saved. Try again.');
      }
    }).catch(function () {
      submitting = false; btn.disabled = false; btn.textContent = 'Submit evaluation';
      showSubmitError('Could not reach the server, so your answers were not saved. Check your connection and press Submit again.');
    });
  });

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    show('s-loading');
    loadConfig().then(function (c) {
      if (!c || !c.ok) throw new Error('config');
      cfg = c;
      clockOffset = (c.serverNow || Date.now()) - Date.now();

      var done = false;
      try { done = localStorage.getItem('cne_done_' + cfg.sessionId) === '1'; } catch (e) {}
      if (done && !DEMO) { show('s-already'); return; }
      if (!cfg.open) { show('s-closed'); return; }

      buildUnits();
      buildQuestions();
      $('code-row').hidden = !cfg.codeRequired;
      startTimer();
      show('s-1');
    }).catch(function () { show('s-error'); });
  }

  $('demo-flag').hidden = !DEMO;
  init();
})();
