/* Pured Media evergreen funnel: shared script (attribution capture, form handling, class events).
   No dependencies. All storage access is wrapped in try/catch. */
(function () {
  'use strict';

  // ---- CONFIG (placeholders: see README) ----
  // One Zapier Catch Hook URL per zap (EV-1 opt-in, EV-2 class events, EV-3 application).
  var ZAPIER_WEBHOOK_URL = 'ZAPIER_WEBHOOK_URL';          // PLACEHOLDER: default for all events
  var WEBHOOK_OVERRIDES = { optin: '', 'class': '', apply: '' }; // optional per-event URLs
  // PLACEHOLDER: coo supplies the supported-country list. Anything else goes to not-a-fit.html.
  var SUPPORTED_COUNTRIES = ['US', 'CA', 'GB', 'AU', 'NZ'];
  var LEAD_SOURCE_META = 'evergreen-meta';

  var $ = function (id) { return document.getElementById(id); };
  document.documentElement.classList.add('js');

  // ---- storage helpers ----
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  // ---- attribution: utm_*, ad_id, landing_url, lead_source ----
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id'];
  function clean(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 120); }
  function captureAttribution() {
    var params;
    try { params = new URL(location.href).searchParams; } catch (e) { params = new URLSearchParams(); }
    var saved = null;
    try { saved = JSON.parse(lsGet('pm_ev_attr')); } catch (e) { saved = null; }
    var hasNew = !!(params.get('utm_source') || params.get('ad_id'));
    if (hasNew || !saved) {
      var a = { landing_url: location.href.slice(0, 500) };
      KEYS.forEach(function (k) { a[k] = clean(params.get(k)); });
      lsSet('pm_ev_attr', JSON.stringify(a));
      saved = a;
    }
    return saved;
  }
  var ATTR = captureAttribution() || {};
  // Non-Meta visits leave lead_source blank so setter pay is never mis-credited.
  function leadSource() { return ATTR.utm_source === 'meta' ? LEAD_SOURCE_META : ''; }
  function fillHidden() {
    KEYS.forEach(function (k) { var el = document.querySelector('input[name="' + k + '"]'); if (el) el.value = ATTR[k] || ''; });
    var l = document.querySelector('input[name="landing_url"]'); if (l) l.value = ATTR.landing_url || location.href;
    var s = document.querySelector('input[name="lead_source"]'); if (s) s.value = leadSource();
  }
  fillHidden();

  // ---- sending ----
  function webhookFor(ev) { return WEBHOOK_OVERRIDES[ev] || ZAPIER_WEBHOOK_URL; }
  function isLocal() { return location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname); }
  function send(ev, fields) {
    var url = webhookFor(ev);
    var body = new URLSearchParams();
    Object.keys(fields).forEach(function (k) { body.set(k, fields[k] == null ? '' : String(fields[k])); });
    body.set('event', ev === 'class' ? (fields.event || 'class_viewed') : ev === 'optin' ? 'optin' : 'apply');
    if (url === 'ZAPIER_WEBHOOK_URL') {
      if (isLocal()) { console.info('[dev] webhook not set; would send', Object.fromEntries(body)); return Promise.resolve(); }
      return Promise.reject(new Error('Webhook URL not set'));
    }
    return fetch(url, { method: 'POST', mode: 'no-cors', body: body });
  }

  // ---- shared helpers ----
  function cap(s) { return s.replace(/\s+/g, ' ').trim().split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v); }
  // Returns { e164, country } or null. US/CA numbers: 10 digits (optional leading 1). A leading + means international.
  function parsePhone(raw) {
    raw = String(raw || '');
    var digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (!/^\s*\+/.test(raw)) {
      if (digits.length === 10) return { e164: '+1' + digits, country: 'US-CA' };
      if (digits.length === 11 && digits.charAt(0) === '1') return { e164: '+' + digits, country: 'US-CA' };
      return null;
    }
    if (digits.length < 8 || digits.length > 15) return null;
    if (digits.charAt(0) === '1' && digits.length === 11) return { e164: '+' + digits, country: 'US-CA' };
    return { e164: '+' + digits, country: 'OTHER' };
  }
  function labelText(id) { var el = document.getElementById(id); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function showErr(box, msg, focusEl) { box.textContent = msg; box.classList.add('show'); if (focusEl) focusEl.focus(); box.scrollIntoView({ block: 'center' }); }
  function safeName(s) { return String(s || '').replace(/[^A-Za-zÀ-ɏ' -]/g, '').slice(0, 40); }

  // ---- OPT-IN ----
  var optin = $('optin-form');
  if (optin) {
    var phone = $('phone'), boxes = $('sms-boxes');
    var syncBoxes = function () {
      var has = phone.value.trim() !== '';
      boxes.classList.toggle('hidden', !has);
      if (!has) { $('sms-reminders').checked = false; $('sms-marketing').checked = false; }
    };
    phone.addEventListener('input', syncBoxes); syncBoxes();
    optin.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = optin, err = $('optin-error'); err.classList.remove('show');
      if (f.nickname_hp.value.trim() !== '') { location.href = 'class.html'; return; } // honeypot: fake success, send nothing
      var first = cap(f.first_name.value);
      if (!first) { showErr(err, 'Please enter your first name.', f.first_name); return; }
      var email = f.email.value.trim().toLowerCase();
      if (!validEmail(email)) { showErr(err, 'Please enter a valid email address.', f.email); return; }
      var p = null;
      if (f.phone.value.trim() !== '') {
        p = parsePhone(f.phone.value);
        if (!p) { showErr(err, 'That mobile number does not look right. You can also leave it blank.', f.phone); return; }
      }
      var btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
      var rem = !!(p && $('sms-reminders').checked), mkt = !!(p && $('sms-marketing').checked);
      var data = {
        first_name: first, email: email, phone: p ? p.e164 : '', country: p ? p.country : '', phone_country: p ? p.country : '',
        sms_consent: rem ? 'true' : 'false', sms_consent_text: rem ? labelText('sms-reminders-text') : '',
        marketing_sms_consent: mkt ? 'true' : 'false', marketing_sms_consent_text: mkt ? labelText('sms-marketing-text') : '',
        consent_version: f.consent_version.value, consent_timestamp: new Date().toISOString(),
        lead_source: leadSource(), tag: 'evergreen-optin', page_url: location.href, user_agent: navigator.userAgent, hp: ''
      };
      KEYS.forEach(function (k) { data[k] = ATTR[k] || ''; }); data.landing_url = ATTR.landing_url || location.href;
      lsSet('pm_ev_email', email); lsSet('pm_ev_name', first);
      send('optin', data).then(function () {
        location.href = 'class.html?n=' + encodeURIComponent(first);
      }, function () {
        btn.disabled = false; showErr(err, 'Something went wrong. Please try again.');
      });
    });
  }

  // ---- CLASS PAGE ----
  var qs = new URLSearchParams(location.search);
  var nameSlot = $('first-name');
  if (nameSlot) {
    var n = safeName(qs.get('n') || lsGet('pm_ev_name'));
    if (n) nameSlot.textContent = ', ' + n;
  }
  // Ready for the real recording: give the <video> id="class-video" and these events fire (EV-2).
  var vid = $('class-video');
  if (vid) {
    var fired = {};
    var fire = function (name) {
      if (fired[name]) return; fired[name] = true;
      send('class', { event: name, email: lsGet('pm_ev_email') || '', page_url: location.href }).catch(function () {});
    };
    vid.addEventListener('timeupdate', function () { if (vid.duration && vid.currentTime / vid.duration >= 0.5) fire('class_viewed'); });
    vid.addEventListener('ended', function () { fire('class_complete'); });
  }

  // ---- THANK YOU ----
  var tyName = $('ty-name');
  if (tyName) {
    var tn = safeName(qs.get('n') || lsGet('pm_ev_name'));
    if (tn) tyName.textContent = ', ' + tn;
  }

  // ---- APPLICATION ----
  var form = $('apply-form');
  if (form) {
    var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
    var cur = 0, err2 = $('apply-error');
    var total = steps.length;
    var pre = lsGet('pm_ev_email'); if (pre && !form.email.value) form.email.value = pre;
    var show = function (i, quiet) {
      cur = i;
      steps.forEach(function (s, k) { s.classList.toggle('active', k === i); });
      $('progress').textContent = 'Step ' + (i + 1) + ' of ' + total;
      $('bar-fill').style.width = ((i + 1) / total * 100) + '%';
      $('back').classList.toggle('hidden', i === 0);
      $('next').classList.toggle('hidden', i === total - 1);
      $('submit-block').classList.toggle('hidden', i !== total - 1);
      err2.classList.remove('show');
      if (quiet) return;
      var h = steps[i].querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,textarea');
      if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
      $('progress').scrollIntoView({ block: 'start' });
    };
    var valid = function (i) {
      var els = steps[i].querySelectorAll('input,select,textarea');
      for (var k = 0; k < els.length; k++) {
        if (!els[k].checkValidity()) { els[k].reportValidity(); return false; }
      }
      if (steps[i].contains(form.email) && !validEmail(form.email.value.trim())) { showErr(err2, 'Please enter a valid email address.', form.email); return false; }
      if (steps[i].contains(form.phone) && !parsePhone(form.phone.value)) { showErr(err2, 'Please enter a valid US or Canada mobile number, or include your country code with a +.', form.phone); return false; }
      return true;
    };
    $('next').addEventListener('click', function () { if (valid(cur) && cur < total - 1) show(cur + 1); });
    $('back').addEventListener('click', function () { if (cur > 0) show(cur - 1); });
    form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && cur < total - 1) { e.preventDefault(); $('next').click(); } });
    // "Not yet" on Q6 shows the class link
    form.querySelectorAll('input[name="watched_class"]').forEach(function (r) {
      r.addEventListener('change', function () { $('not-yet-note').classList.toggle('show', r.value === 'not-yet' && r.checked); });
    });
    show(0, true);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.nickname_hp.value.trim() !== '') { location.href = 'thanks.html'; return; } // honeypot
      for (var i = 0; i < total; i++) { if (!valid(i)) { show(i); return; } }
      var btn = $('submit'); btn.disabled = true; err2.classList.remove('show');
      var p = parsePhone(form.phone.value);
      var sms = $('sms-app').checked;
      var first = cap(form.first_name.value);
      var country = form.country.value;
      var supported = SUPPORTED_COUNTRIES.indexOf(country) !== -1;
      var data = {
        first_name: first, last_name: cap(form.last_name.value), email: form.email.value.trim().toLowerCase(),
        phone: p.e164, phone_country: p.country, country: country, state: form.state.value.trim(), supported_country: supported ? 'yes' : 'no',
        q1_why: form.q1.value.trim(), q2_closest: form.q2.value, q3_work: form.q3.value, q4_hours: form.q4.value, q5_on_camera: form.q5.value,
        watched_class: form.watched_class.value, payment_intent: form.payment_intent.value,
        q8_decision_includes: form.q8.value.trim(), q9_best_time: form.q9.value.trim(),
        sms_consent: sms ? 'true' : 'false', sms_consent_text: sms ? labelText('sms-app-text') : '',
        call_consent_text: labelText('call-consent'),
        consent_version: form.consent_version.value, consent_timestamp: new Date().toISOString(),
        lead_source: leadSource(), tag: 'evergreen-applied', page_url: location.href, user_agent: navigator.userAgent, hp: ''
      };
      KEYS.forEach(function (k) { data[k] = ATTR[k] || ''; }); data.landing_url = ATTR.landing_url || location.href;
      lsSet('pm_ev_name', first);
      send('apply', data).then(function () {
        location.href = supported ? 'thanks.html?n=' + encodeURIComponent(first) : 'not-a-fit.html';
      }, function () {
        btn.disabled = false; showErr(err2, 'Something went wrong. Please try again.');
      });
    });
  }

  // ---- LANDING PAGE: hide the red embed placeholder once a Wistia/Vturb embed is pasted into #embed-slot ----
  var eslot = $('embed-slot'), eph = $('embed-ph');
  if (eslot && eph) {
    var hasEmbed = Array.prototype.some.call(eslot.children, function (c) { return c !== eph; });
    if (hasEmbed) eph.classList.add('gone');
  }

  // ---- VSL PAGE: honest video placeholder (hide overlay once a real source exists) ----
  var vsl = $('vsl-video'), ov = $('video-ov');
  if (vsl && ov && (vsl.getAttribute('src') || vsl.querySelector('source'))) ov.classList.add('gone');

  // ---- VSL PAGE: embedded SHORT application (contact + S1 to S4), single screen ----
  var sform = $('short-form');
  if (sform) {
    var serr = $('short-error');
    var spre = lsGet('pm_ev_email'); if (spre && !sform.email.value) sform.email.value = spre;
    sform.querySelectorAll('input[name="watched_class"]').forEach(function (r) {
      r.addEventListener('change', function () { $('not-yet-note').classList.toggle('show', r.value === 'not-yet' && r.checked); });
    });
    sform.addEventListener('submit', function (e) {
      e.preventDefault();
      serr.classList.remove('show');
      if (sform.nickname_hp.value.trim() !== '') { location.href = 'thanks.html'; return; } // honeypot: fake success, send nothing
      var els = sform.querySelectorAll('input,select,textarea');
      for (var k = 0; k < els.length; k++) {
        if (!els[k].checkValidity()) { els[k].reportValidity(); return; }
      }
      if (!validEmail(sform.email.value.trim())) { showErr(serr, 'Please enter a valid email address.', sform.email); return; }
      var p = parsePhone(sform.phone.value);
      if (!p) { showErr(serr, 'Please enter a valid US or Canada mobile number, or include your country code with a +.', sform.phone); return; }
      var btn = $('s_submit'); btn.disabled = true;
      var sms = $('s_sms').checked;
      var first = cap(sform.first_name.value);
      var country = sform.country.value;
      var supported = SUPPORTED_COUNTRIES.indexOf(country) !== -1;
      var data = {
        first_name: first, last_name: cap(sform.last_name.value), email: sform.email.value.trim().toLowerCase(),
        phone: p.e164, phone_country: p.country, country: country, state: sform.state.value.trim(), supported_country: supported ? 'yes' : 'no',
        q1_why: '', q2_closest: sform.q2.value, q3_work: '', q4_hours: '', q5_on_camera: '',
        watched_class: sform.watched_class.value, payment_intent: sform.payment_intent.value,
        q8_decision_includes: '', q9_best_time: sform.q9.value.trim(),
        sms_consent: sms ? 'true' : 'false', sms_consent_text: sms ? labelText('s_sms-text') : '',
        call_consent_text: labelText('s_call-consent'),
        consent_version: sform.consent_version.value, form_version: 'short', consent_timestamp: new Date().toISOString(),
        lead_source: leadSource(), tag: 'evergreen-applied', page_url: location.href, user_agent: navigator.userAgent, hp: ''
      };
      KEYS.forEach(function (k) { data[k] = ATTR[k] || ''; }); data.landing_url = ATTR.landing_url || location.href;
      lsSet('pm_ev_name', first); lsSet('pm_ev_email', data.email);
      send('apply', data).then(function () {
        location.href = supported ? 'thanks.html?n=' + encodeURIComponent(first) : 'not-a-fit.html';
      }, function () {
        btn.disabled = false; showErr(serr, 'Something went wrong. Please try again.');
      });
    });
  }

  // ---- THEME SWITCHER: preview only. Appears ONLY when the URL has ?preview=1 (the colorway itself is set by the inline head script). ----
  if (qs.get('preview') === '1') {
    var root = document.documentElement;
    var box = document.createElement('div');
    box.className = 'theme-switch';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Preview colorway');
    var btns = [];
    var mark = function () {
      var cur = root.getAttribute('data-theme') || 'b';
      btns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.t === cur ? 'true' : 'false'); });
    };
    ['a', 'b', 'c'].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.t = t; b.textContent = t.toUpperCase();
      b.setAttribute('aria-label', 'Colorway ' + t.toUpperCase());
      b.addEventListener('click', function () {
        root.setAttribute('data-theme', t);
        lsSet('pm_theme', t);
        try { var u = new URL(location.href); u.searchParams.set('theme', t); history.replaceState(null, '', u.toString()); } catch (e) { /* ignore */ }
        mark();
      });
      btns.push(b); box.appendChild(b);
    });
    document.body.appendChild(box); mark();
    // keep the preview switcher alive while clicking through the funnel pages
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
      var h = a.getAttribute('href');
      if (/^[a-z0-9-]+\.html(\?|#|$)/i.test(h) && h.indexOf('preview=') === -1) {
        var hash = h.indexOf('#'), base = hash === -1 ? h : h.slice(0, hash), tail = hash === -1 ? '' : h.slice(hash);
        a.setAttribute('href', base + (base.indexOf('?') === -1 ? '?' : '&') + 'preview=1' + tail);
      }
    });
  }
})();
