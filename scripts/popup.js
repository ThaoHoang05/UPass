'use strict';

const _params = new URLSearchParams(location.search);
let _tabId = parseInt(_params.get('tabId') || '0', 10);

const $ = (id) => document.getElementById(id);
const elHeaderTitle    = $('headerTitle');
const elHeaderSub      = $('headerSub');
const elUpdateBadge    = $('updateBadge');
const elDisplayUsername = $('displayUsername');
const elDisplayPassword = $('displayPassword');
const elDisplaySite    = $('displaySite');
const elFavicon        = $('favicon');
const elTogglePwd      = $('togglePwd');
const elBtnSave        = $('btnSave');
const elBtnDismiss     = $('btnDismiss');
const elBtnNever       = $('btnNever');
const elBtnClose       = $('btnClose');
const elSuccessOverlay = $('successOverlay');
const elSuccessText    = $('successText');
const elSuccessSub     = $('successSub');

let _creds      = null;   
let _pwdVisible = false;
let _saving     = false;
let _windowId   = null;   
// Thêm khai báo selector ở phần DOM REFS đầu file:
const elBtnSettings = $('btnSettings');
const elBtnGenerate = $('btnGenerate');

// Tìm đến hàm init() hoặc khu vực gán sự kiện Event Handlers để nối thêm logic:
if (elBtnSettings) {
  elBtnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

if (elBtnGenerate) {
  elBtnGenerate.addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('scripts/generatorpanel.html'),
      type: 'popup',
      width: 400,
      height: 650 // Chiều cao tối ưu để không bị khuất UI
    });
  });
}

async function init() {
  const win = await chrome.windows.getCurrent();
  _windowId = win.id;

  // Nếu không tìm thấy tabId trên URL (do bấm trực tiếp vào icon extension thay vì đi từ luồng login)
  // Tiến hành lấy ID của tab đang mở hiện tại
  if (!_tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) _tabId = tabs[0].id;
  }

  if (!_tabId) {
    _renderError('Không tìm thấy thông tin trang.');
    return;
  }

  // Yêu cầu background gửi dữ liệu tài khoản đang chờ xử lý
  chrome.runtime.sendMessage({ type: 'PROMPT_GET_CREDS', tabId: _tabId }, (res) => {
    console.log('[Popup] PROMPT_GET_CREDS response:', res); 
    if (chrome.runtime.lastError || !res?.ok) {
      _renderError('Không có tài khoản nào đang chờ lưu.');
      return;
    }
    _creds = res.creds;
    _renderCredentials(_creds);
  });
}

function _renderCredentials(creds) {
  elDisplayUsername.textContent = creds.username || '(không tên)';
  elDisplayUsername.title       = creds.username || '';
  _updatePasswordDisplay();

  const pageUrl = creds.url || '—';
  elDisplaySite.textContent = pageUrl;
  elDisplaySite.title       = pageUrl;

  try {
    const origin = new URL(pageUrl).origin;
    elFavicon.src = `${origin}/favicon.ico`;
    elFavicon.onerror = () => { elFavicon.style.display = 'none'; };
  } catch (_) {
    elFavicon.style.display = 'none';
  }

  if (creds.isUpdate) {
    elUpdateBadge.classList.add('visible');
    elHeaderTitle.textContent  = 'Cập nhật mật khẩu?';
    elHeaderSub.textContent    = 'Mật khẩu mới khác với phiên bản cũ';
    elBtnSave.querySelector('.btn-label').textContent = '🔄 Cập nhật';
  }
}

function _renderError(msg) {
  elDisplayUsername.textContent = '—';
  elDisplaySite.textContent     = msg;
  elBtnSave.disabled            = true;
  elBtnSave.style.opacity       = '0.4';
}

function _updatePasswordDisplay() {
  if (!_creds) return;
  if (_pwdVisible) {
    elDisplayPassword.textContent = _creds.password;
    elDisplayPassword.style.letterSpacing = '0.02em';
    elTogglePwd.textContent = '🙈';
  } else {
    const dots = '•'.repeat(Math.min(_creds.password.length, 16));
    elDisplayPassword.textContent = dots;
    elDisplayPassword.style.letterSpacing = '0.12em';
    elTogglePwd.textContent = '👁';
  }
}

elTogglePwd.addEventListener('click', () => {
  _pwdVisible = !_pwdVisible;
  _updatePasswordDisplay();
});

// Sự kiện bấm LƯU/CẬP NHẬT
elBtnSave.addEventListener('click', () => {
  if (_saving || !_creds) return;
  _saving = true;

  elBtnSave.classList.add('loading');
  elBtnSave.querySelector('.btn-label').textContent = 'Đang xử lý…';

  // Gửi lệnh yêu cầu background ghi dữ liệu vào database (Chrome Storage)
  chrome.runtime.sendMessage({ 
    type: 'PROMPT_SAVE', 
    tabId: _tabId, 
    windowId: _windowId 
  }, (res) => {
    if (res?.ok) {
      _showSuccess(_creds.isUpdate ? 'Đã cập nhật mật khẩu' : 'Đã lưu mật khẩu', _creds.username);
    }
  });
});

elBtnDismiss.addEventListener('click', () => _dismiss(false));
elBtnNever.addEventListener('click', () => _dismiss(true));
elBtnClose.addEventListener('click', () => _dismiss(false));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _dismiss(false);
  if (e.key === 'Enter' && !_saving) elBtnSave.click();
});

function _dismiss(never) {
  chrome.runtime.sendMessage({
    type: 'PROMPT_DISMISS',
    tabId: _tabId,
    windowId: _windowId,
    never
  });
  window.close();
}

function _showSuccess(message, username) {
  elSuccessText.textContent = message;
  elSuccessSub.textContent  = username ? `cho tài khoản ${username}` : '';
  elSuccessOverlay.classList.add('visible');
  setTimeout(() => window.close(), 1200);
}

document.addEventListener('DOMContentLoaded', init);