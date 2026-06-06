'use strict';

/* ── State ── */
const state = {
  mode       : 'password',
  password   : '',
  visible    : false,
  length     : 16,
  useUpper   : true,
  useLower   : true,
  useDigits  : true,
  useSymbols : true,
  noAmbiguous: false,
  wordCount  : 4,
  separator  : '-',
  addNumber  : false,
  addSymbol  : false,
};

const $ = id => document.getElementById(id);

/* ═══ INIT — tất cả event listeners gắn ở đây ═══ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Mode toggle ── */
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  /* ── Visibility & Copy ── */
  $('btnToggleVis').addEventListener('click', toggleVisibility);
  $('btnCopy').addEventListener('click', copyPassword);

  /* ── Length slider ── */
  $('lengthSlider').addEventListener('input', function () {
    state.length = parseInt(this.value);
    $('lenVal').textContent = this.value;
    regenerate();
  });

  /* ── Checkboxes (password mode) ── */
  const checkMap = {
    upper      : 'useUpper',
    lower      : 'useLower',
    digits     : 'useDigits',
    symbols    : 'useSymbols',
    noambiguous: 'noAmbiguous',
  };
  Object.keys(checkMap).forEach(key => {
    const el = $('ck-' + key);
    if (el) el.addEventListener('click', () => toggleCheck(key, checkMap));
  });

  /* ── Word count slider ── */
  $('wordCountSlider').addEventListener('input', function () {
    state.wordCount = parseInt(this.value);
    $('wordCountVal').textContent = this.value;
    regenerate();
  });

  /* ── Separator buttons ── */
  document.querySelectorAll('.sep-btn').forEach(btn => {
    btn.addEventListener('click', () => setSeparator(btn.dataset.sep));
  });

  /* ── Passphrase extra checkboxes ── */
  const ppOptMap = { addnumber: 'addNumber', addsymbol: 'addSymbol' };
  Object.keys(ppOptMap).forEach(key => {
    const el = $('ck-' + key);
    if (el) el.addEventListener('click', () => togglePpOpt(key, ppOptMap));
  });

  /* ── Action buttons ── */
  document.querySelector('.btn-regen').addEventListener('click', regenerate);
  $('btnFill').addEventListener('click', fillForm);
  $('btnSave').addEventListener('click', savePassword);

  /* ── Kick off first render ── */
  regenerate();
});

/* ═══ GENERATOR ═══ */
function regenerate() {
  try {
    if (state.mode === 'password') {
      state.password = PasswordGenerator.generatePassword({
        length      : state.length,
        useUpper    : state.useUpper,
        useLower    : state.useLower,
        useDigits   : state.useDigits,
        useSymbols  : state.useSymbols,
        noAmbiguous : state.noAmbiguous,
      });
    } else {
      state.password = PasswordGenerator.generatePassphrase({
        wordCount : state.wordCount,
        separator : state.separator,
        capitalize: true,
        addNumber : state.addNumber,
        addSymbol : state.addSymbol,
      });
    }
    renderOutput();
  } catch (e) {
    showFillStatus('⚠ ' + e.message, 'err');
  }
}

/* ═══ RENDER ═══ */
function renderOutput() {
  const result = PasswordGenerator.checkStrength(state.password);
  renderPasswordText(state.password, state.visible);
  renderStrength(result);
  renderTips(result.tips);
}

function renderPasswordText(pwd, visible) {
  const el = $('pwdText');
  if (!visible) {
    el.classList.add('hidden');
    el.textContent = pwd;
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = [...pwd].map(ch => {
    if (/[A-Z]/.test(ch)) return `<span class="ch-upper">${escHtml(ch)}</span>`;
    if (/[0-9]/.test(ch)) return `<span class="ch-digit">${escHtml(ch)}</span>`;
    if (/[^a-zA-Z0-9]/.test(ch)) return `<span class="ch-symbol">${escHtml(ch)}</span>`;
    return `<span class="ch-lower">${escHtml(ch)}</span>`;
  }).join('');
}

function renderStrength(result) {
  const colorMap = { danger:'#ff4757', warning:'#ffa502', info:'#3b9eff', success:'#00e5a0' };
  const color = colorMap[result.color] || '#5a5a72';
  for (let i = 1; i <= 5; i++) {
    const seg = $('seg' + i);
    seg.className = 'seg';
    if (i <= result.segments) seg.classList.add('active', result.color);
  }
  $('strengthLabel').textContent = result.label;
  $('strengthLabel').style.color = color;
  $('entropyBadge').textContent  = result.entropy + ' bit';
  $('crackTime').textContent     = result.crackTime ? `Thời gian crack: ${result.crackTime}` : '';
}

function renderTips(tips) {
  const sec  = $('tipsSection');
  const list = $('tipsList');
  if (!tips || !tips.length) { sec.classList.remove('visible'); return; }
  sec.classList.add('visible');
  list.innerHTML = tips.map(t => `<div class="tip-item">${escHtml(t)}</div>`).join('');
}

/* ═══ CONTROLS ═══ */
function toggleVisibility() {
  state.visible = !state.visible;
  $('btnToggleVis').textContent = state.visible ? '🙈' : '👁';
  renderPasswordText(state.password, state.visible);
}

async function copyPassword() {
  const ok = await PasswordGenerator.copyToClipboard(state.password);
  if (!ok) return;
  const btn = $('btnCopy');
  const fb  = $('copyFeedback');
  const box = $('outputBox');
  btn.classList.add('active-copy');
  fb.classList.add('show');
  box.classList.add('copied');
  setTimeout(() => {
    btn.classList.remove('active-copy');
    fb.classList.remove('show');
    box.classList.remove('copied');
  }, 1800);
}

function setMode(mode) {
  state.mode = mode;
  $('btn-mode-pwd').classList.toggle('active', mode === 'password');
  $('btn-mode-pp').classList.toggle('active', mode === 'passphrase');
  $('pwdControls').style.display = mode === 'password' ? '' : 'none';
  $('ppControls').classList.toggle('visible', mode === 'passphrase');
  regenerate();
}

function toggleCheck(key, checkMap) {
  const stateKey = checkMap[key];
  state[stateKey] = !state[stateKey];
  $('ck-' + key).classList.toggle('checked', state[stateKey]);
  regenerate();
}

function setSeparator(sep) {
  state.separator = sep;
  document.querySelectorAll('.sep-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sep === sep);
  });
  regenerate();
}

function togglePpOpt(key, ppOptMap) {
  const stateKey = ppOptMap[key];
  state[stateKey] = !state[stateKey];
  $('ck-' + key).classList.toggle('checked', state[stateKey]);
  regenerate();
}

/* ═══ ACTIONS ═══ */
function fillForm() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) { showFillStatus('Không tìm thấy tab', 'err'); return; }
    chrome.tabs.sendMessage(tab.id, { type: 'FILL_GENERATED_PWD', password: state.password }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        showFillStatus('⚠ Không tìm thấy password field', 'err');
      } else {
        showFillStatus('✓ Đã điền vào form', 'ok');
      }
    });
  });
}

function savePassword() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'SAVE_GENERATED_PWD', password: state.password }, (res) => {
      if (res?.ok) {
        showFillStatus('✓ Đã lưu vào danh sách', 'ok');
        $('btnSave').textContent = '✓ Đã lưu';
        setTimeout(() => { $('btnSave').textContent = '💾 Lưu'; }, 2000);
      } else {
        showFillStatus('⚠ Lưu thất bại', 'err');
      }
    });
  });
}

/* ═══ HELPERS ═══ */
function showFillStatus(msg, type) {
  const el = $('fillStatus');
  el.textContent = msg;
  el.className = 'fill-status show ' + (type || '');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}