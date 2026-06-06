/**
 * content.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chrome Extension Content Script
 * Tích hợp với CredentialScanner để:
 *   1. Quét DOM phát hiện form login
 *   2. Bắt credentials khi user submit
 *   3. Hỏi user có muốn lưu không (Save Password prompt)
 *   4. Lưu / cập nhật / xóa credentials vào chrome.storage.local
 *   5. Gợi ý autofill khi user quay lại trang
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
   * 0. GUARD — chỉ chạy 1 lần trên mỗi document
   * ═══════════════════════════════════════════════════════════════════════════ */
  if (window.__credStorageActive) return;
  window.__credStorageActive = true;

  /* ═══════════════════════════════════════════════════════════════════════════
   * 1. CONFIG
   * ═══════════════════════════════════════════════════════════════════════════ */
  const CFG = {
    STORAGE_KEY_PREFIX : 'cred_',        // Prefix cho key trong chrome.storage
    MAX_ENTRIES_PER_HOST: 20,            // Tối đa bao nhiêu tài khoản mỗi domain
    PROMPT_TIMEOUT_MS  : 15_000,         // Prompt tự ẩn sau 15 giây
    AUTOFILL_DELAY_MS  : 600,            // Delay trước khi autofill (chờ DOM ổn)
    MIN_USERNAME_LEN   : 3,              // Bỏ qua username quá ngắn
    MIN_PASSWORD_LEN   : 4,             // Bỏ qua password quá ngắn
    ENCRYPT_PASSWORDS  : true,           // Mã hóa password trước khi lưu
    PROMPT_Z_INDEX     : 2_147_483_647,  // Luôn trên cùng
  };

  /* ═══════════════════════════════════════════════════════════════════════════
   * 2. STORAGE KEY HELPERS
   * ═══════════════════════════════════════════════════════════════════════════ */

  /** Tạo storage key từ hostname hiện tại */
  function _hostKey(hostname) {
    // Chuẩn hóa: bỏ www., chuyển về lowercase
    const clean = (hostname || location.hostname)
      .toLowerCase()
      .replace(/^www\./, '');
    return CFG.STORAGE_KEY_PREFIX + clean;
  }

  /** Tạo entry ID duy nhất cho mỗi username trên một host */
  function _entryId(username) {
    return username.toLowerCase().trim();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 3. XOR ENCRYPT/DECRYPT (lightweight obfuscation)
   *    Không phải mã hóa mạnh — chỉ để tránh lưu plain-text trong storage.
   *    Nếu cần bảo mật thật sự: dùng Web Crypto API với user passphrase.
   * ═══════════════════════════════════════════════════════════════════════════ */

  const _XOR_KEY = 'cr3d$t0r@g3_k3y!'; // Đổi key này cho mỗi extension

  function _xorEncode(str) {
    if (!CFG.ENCRYPT_PASSWORDS || !str) return str;
    let result = '';
    for (let i = 0; i < str.length; i++) {
      result += String.fromCharCode(
        str.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length)
      );
    }
    return btoa(result); // Base64 để safe lưu JSON
  }

  function _xorDecode(encoded) {
    if (!CFG.ENCRYPT_PASSWORDS || !encoded) return encoded;
    try {
      const str = atob(encoded);
      let result = '';
      for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(
          str.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length)
        );
      }
      return result;
    } catch (_) {
      return encoded; // Fallback: trả về nguyên bản
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 4. CHROME STORAGE CRUD
   * ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Lấy tất cả entries của host hiện tại.
   * @param {string} [hostname]
   * @returns {Promise<Object.<string, CredEntry>>} Map entryId → CredEntry
   */
  async function storageGetAll(hostname) {
    const key = _hostKey(hostname);
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(result[key] || {});
      });
    });
  }

  /**
   * Lưu hoặc cập nhật một credential entry.
   *
   * @typedef {{ username: string, passwordEnc: string, url: string,
   *             createdAt: string, updatedAt: string, useCount: number }} CredEntry
   *
   * @param {string} username
   * @param {string} password  - plain text, sẽ được mã hóa trước khi lưu
   * @param {string} [hostname]
   * @returns {Promise<{ action: 'created'|'updated', entry: CredEntry }>}
   */
  async function storageSave(username, password, hostname) {
    const key    = _hostKey(hostname);
    const id     = _entryId(username);
    const allEntries = await storageGetAll(hostname);

    const isNew  = !allEntries[id];
    const now    = new Date().toISOString();

    // Kiểm tra giới hạn
    if (isNew && Object.keys(allEntries).length >= CFG.MAX_ENTRIES_PER_HOST) {
      // Xóa entry cũ nhất (ít dùng nhất)
      const oldest = Object.entries(allEntries)
        .sort((a, b) => (a[1].useCount || 0) - (b[1].useCount || 0))[0];
      if (oldest) delete allEntries[oldest[0]];
    }

    /** @type {CredEntry} */
    const entry = {
      username,
      passwordEnc: _xorEncode(password),
      url        : location.origin + location.pathname,
      createdAt  : isNew ? now : (allEntries[id]?.createdAt || now),
      updatedAt  : now,
      useCount   : isNew ? 0 : ((allEntries[id]?.useCount || 0)),
    };

    allEntries[id] = entry;

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: allEntries }, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });

    _log(`[Storage] ${isNew ? 'Created' : 'Updated'} entry for "${username}" @ ${key}`);
    return { action: isNew ? 'created' : 'updated', entry };
  }

  /**
   * Tăng useCount khi user autofill thành công.
   * @param {string} username
   * @param {string} [hostname]
   */
  async function storageIncrementUse(username, hostname) {
    const key    = _hostKey(hostname);
    const id     = _entryId(username);
    const all    = await storageGetAll(hostname);
    if (!all[id]) return;
    all[id].useCount = (all[id].useCount || 0) + 1;
    all[id].lastUsedAt = new Date().toISOString();
    await new Promise((res) => chrome.storage.local.set({ [key]: all }, res));
  }

  /**
   * Xóa một credential entry.
   * @param {string} username
   * @param {string} [hostname]
   * @returns {Promise<boolean>} true nếu tìm thấy và xóa
   */
  async function storageDelete(username, hostname) {
    const key = _hostKey(hostname);
    const id  = _entryId(username);
    const all = await storageGetAll(hostname);
    if (!all[id]) return false;
    delete all[id];
    await new Promise((res) => chrome.storage.local.set({ [key]: all }, res));
    _log(`[Storage] Deleted entry for "${username}" @ ${key}`);
    return true;
  }

  /**
   * Xóa toàn bộ credentials của một host.
   * @param {string} [hostname]
   */
  async function storageClearHost(hostname) {
    const key = _hostKey(hostname);
    await new Promise((res) => chrome.storage.local.remove(key, res));
    _log(`[Storage] Cleared all entries @ ${key}`);
  }

  /**
   * Lấy danh sách tất cả hosts đã lưu (để hiển thị trong popup).
   * @returns {Promise<string[]>} Danh sách key có prefix
   */
  async function storageListHosts() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (all) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(
          Object.keys(all).filter((k) => k.startsWith(CFG.STORAGE_KEY_PREFIX))
        );
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 5. SAVE PROMPT UI — thanh hỏi "Lưu mật khẩu không?"
   * ═══════════════════════════════════════════════════════════════════════════ */

  let _promptEl    = null;
  let _promptTimer = null;

  /**
   * Hiển thị thanh prompt hỏi user có muốn lưu password không.
   * @param {{ username: string, password: string }} creds
   * @param {function(boolean): void} onDecision  - true = lưu, false = từ chối
   */
  function showSavePrompt(creds, onDecision) {
    _dismissPrompt(); // Đảm bảo không có prompt cũ

    const bar = document.createElement('div');
    bar.id = '__cred_save_prompt__';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Lưu mật khẩu');

    Object.assign(bar.style, {
      position       : 'fixed',
      top            : '0',
      left           : '0',
      right          : '0',
      zIndex         : String(CFG.PROMPT_Z_INDEX),
      display        : 'flex',
      alignItems     : 'center',
      justifyContent : 'space-between',
      gap            : '12px',
      padding        : '10px 16px',
      background     : '#1a1a2e',
      borderBottom   : '2px solid #4f8ef7',
      boxShadow      : '0 2px 12px rgba(0,0,0,0.5)',
      fontFamily     : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize       : '13px',
      color          : '#e0e0e0',
      boxSizing      : 'border-box',
    });

    // ── Icon + Text ──
    const info = document.createElement('div');
    info.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;min-width:0';

    const icon = document.createElement('span');
    icon.textContent = '🔑';
    icon.style.fontSize = '18px';

    const text = document.createElement('span');
    text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    text.innerHTML =
      `Lưu mật khẩu cho <strong style="color:#4f8ef7">${_escHtml(creds.username)}</strong> ?`;

    info.appendChild(icon);
    info.appendChild(text);

    // ── Buttons ──
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:8px;flex-shrink:0';

    const btnSave = _makeBtn('Lưu', '#4f8ef7', '#fff', () => {
      _dismissPrompt();
      onDecision(true);
    });

    const btnNever = _makeBtn('Không lưu trang này', '#444', '#bbb', () => {
      _dismissPrompt();
      onDecision(false);
      _markNeverSave();
    });

    const btnDismiss = _makeBtn('✕', 'transparent', '#888', () => {
      _dismissPrompt();
      onDecision(false);
    });
    btnDismiss.title = 'Đóng';
    btnDismiss.style.padding = '4px 8px';

    btnGroup.appendChild(btnSave);
    btnGroup.appendChild(btnNever);
    btnGroup.appendChild(btnDismiss);

    bar.appendChild(info);
    bar.appendChild(btnGroup);

    document.documentElement.insertBefore(bar, document.documentElement.firstChild);
    _promptEl = bar;

    // Auto-dismiss
    _promptTimer = setTimeout(() => _dismissPrompt(), CFG.PROMPT_TIMEOUT_MS);
  }

  function _makeBtn(label, bg, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.type = 'button';
    Object.assign(btn.style, {
      background   : bg,
      color        : color,
      border       : bg === 'transparent' ? '1px solid #555' : 'none',
      borderRadius : '5px',
      padding      : '5px 12px',
      cursor       : 'pointer',
      fontSize     : '12px',
      fontWeight   : '500',
      whiteSpace   : 'nowrap',
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  function _dismissPrompt() {
    clearTimeout(_promptTimer);
    if (_promptEl) {
      _promptEl.remove();
      _promptEl = null;
    }
  }

  function _escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 6. NEVER-SAVE LIST (sessionStorage per host)
   * ═══════════════════════════════════════════════════════════════════════════ */

  const _NEVER_KEY = '__cred_never_save__';

  function _markNeverSave() {
    try { sessionStorage.setItem(_NEVER_KEY, '1'); } catch (_) {}
  }

  function _isNeverSave() {
    try { return sessionStorage.getItem(_NEVER_KEY) === '1'; } catch (_) { return false; }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 7. AUTOFILL — điền sẵn credentials vào form
   * ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Tự động điền username + password vào các field đã tìm được.
   * Kích hoạt React/Vue input events để framework nhận value.
   *
   * @param {HTMLInputElement} usernameEl
   * @param {HTMLInputElement} passwordEl
   * @param {string} username
   * @param {string} password
   */
  function autofillFields(usernameEl, passwordEl, username, password) {
    _setNativeValue(usernameEl, username);
    _setNativeValue(passwordEl, password);
    _log(`[Autofill] Filled credentials for "${username}"`);
  }

  /**
   * Set value theo cách React/Vue nhận được (bypass controlled component).
   * @param {HTMLInputElement} el
   * @param {string} value
   */
  function _setNativeValue(el, value) {
    if (!el || value === undefined) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Kích hoạt tất cả events mà React/Vue/Angular lắng nghe
    ['input', 'change', 'blur'].forEach((evtName) => {
      el.dispatchEvent(new Event(evtName, { bubbles: true }));
    });

    // Riêng cho React 16+: kích hoạt synthetic event
    try {
      const reactKey = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (reactKey) {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      }
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 8. AUTOFILL PROMPT — hiển thị gợi ý tài khoản đã lưu
   * ═══════════════════════════════════════════════════════════════════════════ */

  let _autofillPromptEl = null;

  /**
   * Hiển thị dropdown gợi ý tài khoản đã lưu khi user focus vào username field.
   * @param {HTMLInputElement} usernameEl
   * @param {HTMLInputElement|null} passwordEl
   * @param {CredEntry[]} entries
   */
  function showAutofillDropdown(usernameEl, passwordEl, entries) {
    _dismissAutofillDropdown();
    if (!entries.length) return;

    const rect = usernameEl.getBoundingClientRect();

    const dropdown = document.createElement('div');
    dropdown.id = '__cred_autofill_dropdown__';
    Object.assign(dropdown.style, {
      position   : 'fixed',
      top        : `${rect.bottom + window.scrollY + 2}px`,
      left       : `${rect.left + window.scrollX}px`,
      minWidth   : `${Math.max(rect.width, 220)}px`,
      zIndex     : String(CFG.PROMPT_Z_INDEX),
      background : '#1e1e2e',
      border     : '1px solid #4f8ef7',
      borderRadius: '8px',
      boxShadow  : '0 4px 20px rgba(0,0,0,0.6)',
      overflow   : 'hidden',
      fontFamily : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize   : '13px',
    });

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 12px;background:#16213e;color:#888;font-size:11px;border-bottom:1px solid #333';
    header.textContent = '🔑 Tài khoản đã lưu';
    dropdown.appendChild(header);

    // Entry rows
    for (const entry of entries) {
      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex', 'align-items:center', 'gap:10px',
        'padding:9px 12px', 'cursor:pointer', 'transition:background 0.15s',
        'border-bottom:1px solid #2a2a3e',
      ].join(';');

      row.addEventListener('mouseover', () => { row.style.background = '#2a2a4e'; });
      row.addEventListener('mouseout',  () => { row.style.background = 'transparent'; });

      const avatar = document.createElement('div');
      avatar.style.cssText = [
        'width:28px', 'height:28px', 'border-radius:50%',
        'background:#4f8ef7', 'display:flex', 'align-items:center',
        'justify-content:center', 'color:#fff', 'font-weight:bold',
        'font-size:13px', 'flex-shrink:0',
      ].join(';');
      avatar.textContent = (entry.username[0] || '?').toUpperCase();

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';

      const uname = document.createElement('div');
      uname.style.cssText = 'color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      uname.textContent = entry.username;

      const meta = document.createElement('div');
      meta.style.cssText = 'color:#666;font-size:11px;margin-top:1px';
      meta.textContent = entry.lastUsedAt
        ? `Dùng lần cuối: ${new Date(entry.lastUsedAt).toLocaleDateString('vi-VN')}`
        : 'Chưa sử dụng';

      info.appendChild(uname);
      info.appendChild(meta);

      const fillIcon = document.createElement('span');
      fillIcon.textContent = '↩';
      fillIcon.style.cssText = 'color:#4f8ef7;font-size:16px;flex-shrink:0';

      row.appendChild(avatar);
      row.appendChild(info);
      row.appendChild(fillIcon);

      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Không blur username field
        _dismissAutofillDropdown();
        
        //const plainPwd = _xorDecode(entry.passwordEnc);
        //autofillFields(usernameEl, passwordEl, entry.username, plainPwd);
        //storageIncrementUse(entry.username);

        chrome.runtime.sendMessage({
          type: 'REQUEST_AUTOFILL_VERIFY',
          username: entry.username,
          passwordEnc: entry.passwordEnc // Chỉ gửi bản mã hóa
        }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            _showToast('Xác thực thất bại hoặc bị hủy', 3000);
            return;
          }
          // Nhận được mật khẩu thật sau khi xác thực thành công -> Điền vào form
          autofillFields(usernameEl, passwordEl, entry.username, response.password);
          storageIncrementUse(entry.username);
          
          if (passwordEl) setTimeout(() => passwordEl.focus(), 50);
        });
      });

      dropdown.appendChild(row);
    }

    // Footer: quản lý
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:6px 12px;text-align:right;border-top:1px solid #2a2a3e';
    const manageLink = document.createElement('a');
    manageLink.href  = '#';
    manageLink.textContent = 'Quản lý mật khẩu…';
    manageLink.style.cssText = 'color:#4f8ef7;font-size:11px;text-decoration:none';
    manageLink.addEventListener('click', (e) => {
      e.preventDefault();
      _dismissAutofillDropdown();
      chrome.runtime.sendMessage({ type: 'OPEN_MANAGER' });
    });
    footer.appendChild(manageLink);
    dropdown.appendChild(footer);

    document.body.appendChild(dropdown);
    _autofillPromptEl = dropdown;

    // Click ngoài → đóng
    setTimeout(() => {
      document.addEventListener('mousedown', _outsideClickHandler, true);
    }, 0);
  }

  function _outsideClickHandler(e) {
    if (_autofillPromptEl && !_autofillPromptEl.contains(e.target)) {
      _dismissAutofillDropdown();
    }
  }

  function _dismissAutofillDropdown() {
    if (_autofillPromptEl) {
      _autofillPromptEl.remove();
      _autofillPromptEl = null;
      document.removeEventListener('mousedown', _outsideClickHandler, true);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 9. CORE FLOW — kết nối scanner + storage
   * ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Kiểm tra credentials có đủ tiêu chuẩn để lưu không.
   * @param {{ username: string, password: string }} creds
   * @returns {boolean}
   */
  function _isValidCreds(creds) {
    return (
      creds.isComplete &&
      creds.username.length >= CFG.MIN_USERNAME_LEN &&
      creds.password.length >= CFG.MIN_PASSWORD_LEN
    );
  }

  /**
   * So sánh credentials mới với bản đã lưu — tránh prompt trùng lặp.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<boolean>} true nếu KHÁC (cần lưu lại)
   */
  async function _isDifferentFromSaved(username, password) {
    const all  = await storageGetAll();
    const id   = _entryId(username);
    const saved = all[id];
    if (!saved) return true; // Chưa có → cần lưu
    const savedPlain = _xorDecode(saved.passwordEnc);
    return savedPlain !== password; // Đã có nhưng password thay đổi
  }

  /**
   * Xử lý sau khi bắt được credentials đầy đủ (từ captureOnSubmit).
   * @param {{ username: string, password: string }} creds
   */
  async function _onCredentialsCaptured(creds) {
    _log('[Flow] _onCredentialsCaptured called:', creds.username, '| complete:', creds.isComplete, '| step:', creds.loginStep);

    if (!_isValidCreds(creds)) {
      _log('[Flow] Bỏ qua: creds không hợp lệ (thiếu username/password hoặc quá ngắn)');
      return;
    }
    if (_isNeverSave()) {
      _log('[Flow] Bỏ qua: trang này đã được đánh dấu never-save');
      return;
    }

    try {
      const needSave = await _isDifferentFromSaved(creds.username, creds.password);
      if (!needSave) {
        _log('[Flow] Bỏ qua: credentials giống hệt bản đã lưu');
        return;
      }

      const isUpdate = (await storageGetAll())[_entryId(creds.username)] !== undefined;

      _log('[Flow] Gửi CREDENTIALS_DETECTED lên background...');
      chrome.runtime.sendMessage({
        type    : 'CREDENTIALS_DETECTED',   // ← đúng với background.js
        username: creds.username,
        password: creds.password,
        url     : location.origin + location.pathname,
        isUpdate,
      }, (res) => {
        if (chrome.runtime.lastError) {
          _log('[Flow] sendMessage error:', chrome.runtime.lastError.message);
          return;
        }
        _log('[Flow] Background xác nhận:', res);
      });

    } catch (err) {
      _log('[Flow] Check error:', err);
    }
  }

  /**
   * Thiết lập autofill khi user focus vào username field.
   * @param {object} scanResult - Kết quả từ CredentialScanner.scan()
   */
  async function _setupAutofill(scanResult) {
    const { bestUsername, bestPassword } = scanResult;
    if (!bestUsername) return;

    const allEntries = await storageGetAll();
    const entries = Object.values(allEntries)
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0));

    if (!entries.length) return;

    bestUsername.addEventListener('focus', () => {
      // Lọc theo những gì user đang gõ
      const query = (bestUsername.value || '').toLowerCase();
      const filtered = query
        ? entries.filter((e) => e.username.toLowerCase().includes(query))
        : entries;
      showAutofillDropdown(bestUsername, bestPassword, filtered);
    });

    bestUsername.addEventListener('input', () => {
      const query = (bestUsername.value || '').toLowerCase();
      const filtered = entries.filter((e) =>
        e.username.toLowerCase().includes(query)
      );
      _dismissAutofillDropdown();
      if (query.length === 0 || filtered.length > 0) {
        showAutofillDropdown(bestUsername, bestPassword, filtered);
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 10. TOAST NOTIFICATION
   * ═══════════════════════════════════════════════════════════════════════════ */

  function _showToast(message, durationMs = 3000) {
    const toast = document.createElement('div');
    Object.assign(toast.style, {
      position     : 'fixed',
      bottom       : '24px',
      right        : '24px',
      zIndex       : String(CFG.PROMPT_Z_INDEX),
      background   : '#1a1a2e',
      color        : '#e0e0e0',
      border       : '1px solid #4f8ef7',
      borderRadius : '8px',
      padding      : '10px 18px',
      fontFamily   : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize     : '13px',
      boxShadow    : '0 4px 16px rgba(0,0,0,0.5)',
      transition   : 'opacity 0.3s',
      opacity      : '1',
    });
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 350);
    }, durationMs);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 11. CHROME RUNTIME MESSAGE HANDLER
   *     Nhận lệnh từ popup / background script
   * ═══════════════════════════════════════════════════════════════════════════ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {

      // Popup hỏi: có credentials nào đã lưu cho host này không?
      case 'GET_SAVED_CREDENTIALS': {
        storageGetAll(msg.hostname).then((all) => {
          const list = Object.values(all).map((e) => ({
            username  : e.username,
            url       : e.url,
            createdAt : e.createdAt,
            updatedAt : e.updatedAt,
            useCount  : e.useCount,
            lastUsedAt: e.lastUsedAt,
            // KHÔNG trả password về popup — chỉ dùng nội bộ
          }));
          sendResponse({ ok: true, credentials: list });
        }).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true; // async response
      }

      // Popup yêu cầu xóa một entry
      case 'DELETE_CREDENTIAL': {
        storageDelete(msg.username, msg.hostname).then((deleted) => {
          sendResponse({ ok: true, deleted });
        }).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      // Popup yêu cầu xóa toàn bộ host
      case 'CLEAR_HOST': {
        storageClearHost(msg.hostname).then(() => {
          sendResponse({ ok: true });
        }).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }

      // Background yêu cầu autofill ngay (ví dụ: user click icon extension)
      case 'TRIGGER_AUTOFILL': {
        const sr = CredentialScanner.scan();
        _setupAutofill(sr).then(() => {
          if (sr.bestUsername) sr.bestUsername.focus();
          sendResponse({ ok: true });
        });
        return true;
      }

      // Lấy danh sách tất cả hosts
      case 'LIST_HOSTS': {
        storageListHosts().then((hosts) => {
          sendResponse({ ok: true, hosts });
        }).catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      case 'FILL_GENERATED_PWD': {
        try {
          // Dùng scanner để tìm, nếu không có fallback về querySelector cơ bản
          const sr = typeof CredentialScanner !== 'undefined' ? CredentialScanner.scan() : {};
          const pwdField = sr.bestPassword || document.querySelector('input[type="password"]');

          if (pwdField) {
            _setNativeValue(pwdField, msg.password);
            // Nếu tìm thấy username field, focus lại vào password để kích hoạt UI event
            pwdField.focus();
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Không tìm thấy trường mật khẩu trên trang.' });
          }
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        return true; // Bắt buộc cho async response
      }

      // Relay dữ liệu mật khẩu vừa tạo lên background để lưu
      case 'SAVE_GENERATED_PWD': {
        try {
          const sr = typeof CredentialScanner !== 'undefined' ? CredentialScanner.scan() : {};
          
          // Cố gắng bắt username hiện tại trên form. Nếu rỗng, tạo một ID tạm thời.
          const currentUsername = (sr.bestUsername && sr.bestUsername.value.trim()) 
            ? sr.bestUsername.value.trim() 
            : 'generated_' + Math.floor(Date.now() / 1000);

          // Gửi thông điệp chứa data thô lên background
          chrome.runtime.sendMessage({
            type    : 'BACKGROUND_SAVE_GENERATED',
            username: currentUsername,
            password: msg.password,
            url     : location.origin + location.pathname
          }, (bgRes) => {
            sendResponse(bgRes);
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        return true; // Bắt buộc cho async response qua lại giữa 3 môi trường
      }
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════════
   * 12. INIT — điểm khởi động chính
   * ═══════════════════════════════════════════════════════════════════════════ */

  function _log(...args) {
    if (typeof console !== 'undefined') console.debug('[CredStorage]', ...args);
  }


  /**
   * Khởi động toàn bộ hệ thống.
   * Gọi khi DOM đã sẵn sàng.
   */
  async function init() {
    _log('Initializing on', location.hostname);

    // Bước 1: Quét DOM lần đầu
    const scanResult = CredentialScanner.scan();
    _log('[Init] Login step:', scanResult.loginStep);

    // Bước 2: Thiết lập autofill dropdown
    await _setupAutofill(scanResult);

    // Bước 3: Lắng nghe submit để bắt credentials
    CredentialScanner.captureOnSubmit(async (creds) => {
      _log('[Captured] loginStep:', creds.loginStep, '| username:', creds.username, '| password len:', creds.password?.length, '| complete:', creds.isComplete);
      _log('[Captured] usernameSource:', creds.usernameSource, '| passwordSource:', creds.passwordSource);

      // Nếu creds chưa đủ (isComplete=false) nhưng có username → có thể đây là multi-step bước 1
      // captureOnSubmit đã tự lưu vào _multiStepState, chờ bước 2
      if (!creds.isComplete) {
        _log('[Captured] Credentials chưa đủ, bỏ qua lần này');
        return;
      }

      await _onCredentialsCaptured(creds);
    });

    // Bước 4: Observer cho SPA / multi-step — re-scan khi DOM thay đổi
    CredentialScanner.startObserver(async (newScan) => {
      _log('[Observer] DOM changed, step:', newScan.loginStep);

      // Nếu step mới xuất hiện field mới → attach autofill lại
      if (newScan.bestUsername) {
        await _setupAutofill(newScan);
      }
    }, 500);
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button, [type="submit"], [role="button"]');
      if (!btn) return;
    
      // Chờ 300ms cho AJAX hoàn thành, rồi mới đọc value
      setTimeout(async () => {
        const creds = CredentialScanner.extractCredentials();
        _log('[Click backup] creds:', creds.username, '| complete:', creds.isComplete);
        if (creds.isComplete) await _onCredentialsCaptured(creds);
      }, 300);
    }, true);
  }

  // Khởi động khi DOM sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM đã sẵn sàng (script inject muộn)
    setTimeout(init, CFG.AUTOFILL_DELAY_MS);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * 13. PUBLIC API 
   * ═══════════════════════════════════════════════════════════════════════════ */
  window.CredentialStorage = {
    storageGetAll,
    storageSave,
    storageDelete,
    storageClearHost,
    storageListHosts,
    storageIncrementUse,
    autofillFields,
    showSavePrompt,
    showAutofillDropdown,
    version: '1.0.0',
  };

})();