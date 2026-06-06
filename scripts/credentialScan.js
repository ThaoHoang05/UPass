/**
 * credential-scan.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Quét DOM để nhận diện và ĐỌC GIÁ TRỊ các trường username / password.
 * Hỗ trợ:
 *   • DOM thường
 *   • Shadow DOM (open & closed via TreeWalker + host traversal)
 *   • <iframe> cùng origin
 *   • Multi-step login (step 1: chỉ username; step 2: chỉ password)
 *   • MutationObserver để theo dõi thay đổi DOM theo thời gian thực
 *   • Value Extractor: đọc giá trị thực từ input (kể cả React/Vue controlled)
 *   • captureOnSubmit: bắt credentials ngay khi user submit form
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
    'use strict';
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 1. HEURISTIC PATTERNS
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    const USERNAME_PATTERNS = {
      // Thuộc tính HTML
      attrPatterns: [
        /user[\s_-]?name/i,
        /e[\s_-]?mail/i,
        /^email$/i,
        /^login$/i,
        /^logon$/i,
        /^uid$/i,
        /^user$/i,
        /account[\s_-]?name/i,
        /identifier/i,
        /^phone$/i,
        /mobile/i,
        /^id$/i,
      ],
      // Giá trị autocomplete
      autocomplete: ['username', 'email', 'tel', 'login'],
      // type input hợp lệ (không phải password)
      inputTypes: ['text', 'email', 'tel', 'number', null, ''],
    };
  
    const PASSWORD_PATTERNS = {
      attrPatterns: [
        /pass[\s_-]?word/i,
        /^pass$/i,
        /^pwd$/i,
        /^psw$/i,
        /^passwd$/i,
        /secret/i,
        /pin/i,
        /^key$/i,
      ],
      autocomplete: [
        'current-password',
        'new-password',
        'password',
      ],
      inputTypes: ['password'],
    };
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 2. UTILITY HELPERS
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Lấy tất cả giá trị thuộc tính liên quan của một element để đối chiếu heuristic.
     */
    function getElementSignature(el) {
      return [
        el.id || '',
        el.name || '',
        el.className || '',
        el.getAttribute('placeholder') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('data-field') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('autocomplete') || '',
        el.getAttribute('label') || '',
        // label liên kết qua for/id
        (function () {
          if (!el.id) return '';
          const lbl = document.querySelector(`label[for="${el.id}"]`);
          return lbl ? lbl.textContent : '';
        })(),
      ]
        .join(' ')
        .toLowerCase();
    }
  
    function matchesPatterns(text, patterns) {
      return patterns.some((p) => p.test(text));
    }
  
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0
      );
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 3. FIELD CLASSIFIER
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Phân loại một <input> element là 'username', 'password', hoặc null.
     * @param {HTMLInputElement} el
     * @returns {'username'|'password'|null}
     */
    function classifyInput(el) {
      const type = (el.type || '').toLowerCase();
      const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
      const sig = getElementSignature(el);
  
      // ── Password rõ ràng nhất: type="password" ──
      if (type === 'password') return 'password';
  
      // ── Autocomplete tường minh ──
      if (PASSWORD_PATTERNS.autocomplete.includes(autocomplete)) return 'password';
      if (USERNAME_PATTERNS.autocomplete.includes(autocomplete)) return 'username';
  
      // ── Loại bỏ các input không phải text-like ──
      const skipTypes = ['submit', 'button', 'checkbox', 'radio', 'file',
                         'hidden', 'image', 'reset', 'color', 'range'];
      if (skipTypes.includes(type)) return null;
  
      // ── Heuristic theo tên/id/placeholder ──
      if (matchesPatterns(sig, PASSWORD_PATTERNS.attrPatterns)) return 'password';
      if (matchesPatterns(sig, USERNAME_PATTERNS.attrPatterns)) return 'username';
  
      return null;
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 4. COLLECTORS — DOM thường, Shadow DOM, iframe
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Thu thập tất cả <input> từ một root (Document | ShadowRoot | Element).
     * Đệ quy vào shadow roots tìm thấy.
     */
    function collectInputs(root, results, depth) {
      if (depth > 15) return; // bảo vệ vòng lặp vô hạn
      if (!root) return;
  
      const inputs = root.querySelectorAll
        ? root.querySelectorAll('input')
        : [];
  
      for (const input of inputs) {
        results.push(input);
      }
  
      // Tìm tất cả elements có shadow root (open)
      const allEls = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of allEls) {
        if (el.shadowRoot) {
          collectInputs(el.shadowRoot, results, depth + 1);
        }
      }
    }
  
    /**
     * Truy cập iframe cùng origin và thu thập inputs từ bên trong.
     * @param {Document} doc
     * @param {Array} results
     */
    function collectFromIframes(doc, results) {
      const frames = doc.querySelectorAll('iframe');
      for (const frame of frames) {
        try {
          const iDoc = frame.contentDocument || frame.contentWindow?.document;
          if (iDoc) {
            collectInputs(iDoc, results, 0);
            collectFromIframes(iDoc, results); // iframe lồng nhau
          }
        } catch (e) {
          // cross-origin iframe — bỏ qua (không thể truy cập)
        }
      }
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 5. MULTI-STEP LOGIN DETECTION
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Xác định đây có phải multi-step login hay không dựa trên:
     *   - Chỉ có 1 input visible và nó là username → step 1
     *   - Chỉ có 1 input visible và nó là password → step 2
     */
    function detectLoginStep(classified) {
      const visibleUsernames = classified.filter(
        (f) => f.type === 'username' && isVisible(f.element)
      );
      const visiblePasswords = classified.filter(
        (f) => f.type === 'password' && isVisible(f.element)
      );
  
      if (visibleUsernames.length >= 1 && visiblePasswords.length >= 1) {
        return 'single-page'; // form đầy đủ trên 1 trang
      }
      if (visibleUsernames.length >= 1 && visiblePasswords.length === 0) {
        return 'multi-step-username'; // step 1 — nhập username/email
      }
      if (visiblePasswords.length >= 1 && visibleUsernames.length === 0) {
        return 'multi-step-password'; // step 2 — nhập password
      }
      return 'unknown';
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 6. SCORE & RANK — chọn field tốt nhất khi có nhiều ứng viên
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Tính điểm ưu tiên cho một field được phân loại.
     * Điểm cao hơn = field đáng tin cậy hơn.
     */
    function scoreField(field) {
      let score = 0;
      const el = field.element;
      const type = (el.type || '').toLowerCase();
      const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  
      // type tường minh
      if (type === 'password') score += 50;
      if (type === 'email') score += 40;
      if (type === 'text') score += 10;
  
      // autocomplete tường minh
      if (['current-password', 'new-password'].includes(autocomplete)) score += 40;
      if (autocomplete === 'username' || autocomplete === 'email') score += 40;
  
      // visible
      if (isVisible(el)) score += 20;
  
      // nằm trong <form>
      if (el.closest('form')) score += 10;
  
      // có label liên kết
      if (el.id && document.querySelector(`label[for="${el.id}"]`)) score += 10;
  
      // name/id khớp pattern chính xác
      const sig = getElementSignature(el);
      if (/^(username|email|login|user)$/.test(el.name)) score += 15;
      if (/^(password|pass|pwd|passwd)$/.test(el.name)) score += 15;
  
      return score;
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 7. MAIN SCAN FUNCTION
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Quét toàn bộ trang và trả về kết quả nhận diện.
     *
     * @returns {{
     *   loginStep: string,
     *   usernameFields: Array<{element: HTMLInputElement, score: number, source: string}>,
     *   passwordFields: Array<{element: HTMLInputElement, score: number, source: string}>,
     *   bestUsername: HTMLInputElement|null,
     *   bestPassword: HTMLInputElement|null,
     *   allClassified: Array,
     *   scanTimestamp: string
     * }}
     */
    function scan() {
      const allInputs = [];
  
      // 1. DOM thường + Shadow DOM
      collectInputs(document, allInputs, 0);
  
      // 2. iframes
      collectFromIframes(document, allInputs);
  
      // Dedup (cùng element có thể bị thu thập 2 lần nếu query rộng)
      const unique = [...new Set(allInputs)];
  
      // 3. Phân loại
      const classified = [];
      for (const el of unique) {
        const type = classifyInput(el);
        if (!type) continue;
  
        // Xác định nguồn
        let source = 'document';
        try {
          const root = el.getRootNode();
          if (root instanceof ShadowRoot) source = 'shadow-dom';
          else if (root !== document) source = 'iframe';
        } catch (_) {}
  
        classified.push({
          element: el,
          type,
          score: 0, // sẽ tính sau
          source,
          visible: isVisible(el),
          autocomplete: el.getAttribute('autocomplete') || '',
          inputType: el.type || 'text',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.getAttribute('placeholder') || '',
        });
      }
  
      // 4. Tính score
      for (const f of classified) {
        f.score = scoreField(f);
      }
  
      // 5. Tách nhóm và sort
      const usernameFields = classified
        .filter((f) => f.type === 'username')
        .sort((a, b) => b.score - a.score);
  
      const passwordFields = classified
        .filter((f) => f.type === 'password')
        .sort((a, b) => b.score - a.score);
  
      // 6. Detect login step
      const loginStep = detectLoginStep(classified);
  
      return {
        loginStep,
        usernameFields,
        passwordFields,
        bestUsername: usernameFields[0]?.element ?? null,
        bestPassword: passwordFields[0]?.element ?? null,
        allClassified: classified,
        scanTimestamp: new Date().toISOString(),
      };
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 8. MUTATION OBSERVER — theo dõi thay đổi DOM (multi-step navigation)
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    let _observer = null;
    let _onChangeCallback = null;
    let _debounceTimer = null;
  
    /**
     * Bắt đầu theo dõi thay đổi DOM.
     * Khi DOM thay đổi (ví dụ: bước login tiếp theo xuất hiện),
     * sẽ tự động quét lại và gọi callback.
     *
     * @param {function(result): void} onChange - Callback nhận kết quả scan mới
     * @param {number} [debounceMs=400] - Thời gian debounce (ms)
     */
    function startObserver(onChange, debounceMs) {
      if (_observer) stopObserver();
  
      debounceMs = debounceMs ?? 400;
      _onChangeCallback = onChange;
  
      _observer = new MutationObserver(function (mutations) {
        // Lọc: chỉ xử lý nếu có input xuất hiện/biến mất hoặc attribute liên quan thay đổi
        const relevant = mutations.some(function (m) {
          if (m.type === 'childList') {
            const nodes = [...m.addedNodes, ...m.removedNodes];
            return nodes.some(
              (n) =>
                n.nodeName === 'INPUT' ||
                (n.querySelectorAll && n.querySelectorAll('input').length > 0)
            );
          }
          if (m.type === 'attributes') {
            const target = m.target;
            return (
              target.nodeName === 'INPUT' &&
              ['type', 'name', 'id', 'autocomplete', 'style', 'hidden'].includes(
                m.attributeName
              )
            );
          }
          return false;
        });
  
        if (!relevant) return;
  
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(function () {
          const result = scan();
          if (_onChangeCallback) _onChangeCallback(result);
        }, debounceMs);
      });
  
      _observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['type', 'name', 'id', 'autocomplete', 'style', 'hidden', 'class'],
      });
    }
  
    /**
     * Dừng theo dõi MutationObserver.
     */
    function stopObserver() {
      if (_observer) {
        _observer.disconnect();
        _observer = null;
      }
      clearTimeout(_debounceTimer);
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 9. FORM CONTEXT ANALYZER
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Phân tích ngữ cảnh form chứa các field đã tìm được.
     * Trả về thông tin submit button, action URL, method.
     *
     * @param {object} scanResult - Kết quả từ scan()
     * @returns {object}
     */
    function analyzeFormContext(scanResult) {
      const contexts = [];
      const processed = new Set();
  
      const targets = [
        scanResult.bestUsername,
        scanResult.bestPassword,
      ].filter(Boolean);
  
      for (const el of targets) {
        const form = el.closest('form');
        const key = form || el.parentElement;
        if (processed.has(key)) continue;
        processed.add(key);
  
        let submitBtn = null;
        const searchRoot = form || el.parentElement;
  
        if (searchRoot) {
          submitBtn =
            searchRoot.querySelector('[type="submit"]') ||
            searchRoot.querySelector('button:not([type="button"])') ||
            searchRoot.querySelector('[role="button"]');
        }
  
        contexts.push({
          form: form || null,
          action: form?.action || window.location.href,
          method: form?.method || 'POST',
          submitButton: submitBtn,
          submitText: submitBtn?.textContent?.trim() || '',
        });
      }
  
      return contexts;
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 10. VALUE EXTRACTOR
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    /**
     * Đọc giá trị thực của một <input> element.
     *
     * Vấn đề với React/Vue/Angular: các framework này lưu giá trị trong
     * internal fiber/vnode, không phải DOM .value trực tiếp khi dùng
     * controlled components. Ta cần đọc qua native value getter để bypass.
     *
     * @param {HTMLInputElement} el
     * @returns {string}
     */
    function readInputValue(el) {
      if (!el) return '';
  
      // Cách 1: Native getter (bypass React synthetic events & Vue reactivity)
      // React lưu giá trị tại nativeInputValueSetter hoặc Object.getOwnPropertyDescriptor
      try {
        const nativeGetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        );
        if (nativeGetter && nativeGetter.get) {
          const val = nativeGetter.get.call(el);
          if (typeof val === 'string') return val;
        }
      } catch (_) {}
  
      // Cách 2: Đọc trực tiếp .value (fallback cho DOM thuần)
      return el.value || '';
    }
  
    /**
     * Lấy giá trị username đã nhập từ element tốt nhất tìm được.
     * Trả về chuỗi rỗng nếu chưa có.
     *
     * @param {HTMLInputElement|null} el
     * @returns {string}
     */
    function extractUsername(el) {
      return readInputValue(el).trim();
    }
  
    /**
     * Lấy giá trị password đã nhập từ element tốt nhất tìm được.
     * KHÔNG trim password (khoảng trắng đầu/cuối là hợp lệ).
     *
     * @param {HTMLInputElement|null} el
     * @returns {string}
     */
    function extractPassword(el) {
      return readInputValue(el);
    }
  
    /**
     * Quét DOM và trả về ngay giá trị credentials hiện tại.
     *
     * Xử lý multi-step:
     *   - Nếu đang ở bước username (multi-step-username): chỉ có username
     *   - Nếu đang ở bước password (multi-step-password): chỉ có password;
     *     username được lấy từ _multiStepState nếu đã lưu từ bước trước
     *   - Nếu single-page: lấy cả hai ngay lập tức
     *
     * @returns {{
     *   username: string,
     *   password: string,
     *   loginStep: string,
     *   isComplete: boolean,
     *   usernameSource: string,
     *   passwordSource: string,
     *   scanTimestamp: string
     * }}
     */
    function extractCredentials() {
      const scanResult = scan();
      const { loginStep, bestUsername, bestPassword } = scanResult;
  
      let username = '';
      let password = '';
      let usernameSource = 'none';
      let passwordSource = 'none';
  
      if (loginStep === 'single-page') {
        // ── Trang đủ cả hai field ──
        username = extractUsername(bestUsername);
        password = extractPassword(bestPassword);
        usernameSource = bestUsername ? 'dom-field' : 'none';
        passwordSource = bestPassword ? 'dom-field' : 'none';
  
      } else if (loginStep === 'multi-step-username') {
        // ── Bước 1: chỉ thấy username field ──
        username = extractUsername(bestUsername);
        usernameSource = bestUsername ? 'dom-field' : 'none';
  
        // Lưu vào state để dùng ở bước sau
        if (username) {
          _multiStepState.username = username;
          _multiStepState.usernameTimestamp = Date.now();
        }
  
        // Password chưa có
        password = '';
        passwordSource = 'none';
  
      } else if (loginStep === 'multi-step-password') {
        // ── Bước 2: chỉ thấy password field ──
        password = extractPassword(bestPassword);
        passwordSource = bestPassword ? 'dom-field' : 'none';
  
        // Phục hồi username từ bước trước (trong vòng 10 phút)
        const AGE_LIMIT_MS = 10 * 60 * 1000;
        const stateAge = Date.now() - (_multiStepState.usernameTimestamp || 0);
        if (_multiStepState.username && stateAge < AGE_LIMIT_MS) {
          username = _multiStepState.username;
          usernameSource = 'multi-step-cache';
        } else {
          // Thử tìm username ẩn (hidden input, disabled field, aria-label text)
          username = _recoverHiddenUsername() || '';
          usernameSource = username ? 'dom-hidden' : 'none';
        }
      }
  
      const isComplete = username.length > 0 && password.length > 0;
  
      return {
        username,
        password,
        loginStep,
        isComplete,
        usernameSource,
        passwordSource,
        scanTimestamp: scanResult.scanTimestamp,
      };
    }
  
    /**
     * State nội bộ để lưu username qua các bước của multi-step login.
     * @private
     */
    const _multiStepState = {
      username: '',
      usernameTimestamp: 0,
    };
  
    /**
     * Cố gắng tìm username từ các nơi "ẩn" trên trang ở bước 2:
     *   - Input type=hidden có tên liên quan đến username
     *   - Element hiển thị email/username dưới dạng text (vd: Google login)
     *   - Input disabled chứa giá trị
     * @private
     * @returns {string}
     */
    function _recoverHiddenUsername() {
      // 1. Hidden inputs
      const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
      for (const inp of hiddenInputs) {
        const sig = getElementSignature(inp);
        if (matchesPatterns(sig, USERNAME_PATTERNS.attrPatterns)) {
          const val = readInputValue(inp).trim();
          if (val) return val;
        }
      }
  
      // 2. Disabled text inputs (Google-style: hiển thị email ở bước 2)
      const disabledInputs = document.querySelectorAll('input[disabled], input[readonly]');
      for (const inp of disabledInputs) {
        const type = (inp.type || '').toLowerCase();
        if (['text', 'email', ''].includes(type)) {
          const val = readInputValue(inp).trim();
          if (val && val.includes('@')) return val; // email rõ ràng nhất
          if (val) return val;
        }
      }
  
      // 3. Text node hiển thị email (vd: <div class="email-display">user@x.com</div>)
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (emailRegex.test(text)) {
          const match = text.match(emailRegex);
          if (match) return match[0];
        }
      }
  
      return '';
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 11. CAPTURE ON SUBMIT — bắt credentials khi user nhấn submit
     * ═══════════════════════════════════════════════════════════════════════════ */
    let _pendingCreds   = null;   // credentials tạm thời chờ xác nhận
    let _loginWatcher   = null;   // interval/observer theo dõi login thành công
    let _submitListeners = []; // lưu để cleanup
  
    /**
     * Đăng ký listener bắt credentials ngay khi user submit form.
     * Hỗ trợ:
     *   - <form> submit event
     *   - Click vào submit button (cho SPA không dùng <form>)
     *   - Enter keydown trên password field
     *
     * @param {function(credentials: object): void} onCapture
     *   Callback nhận object credentials đầy đủ khi submit được phát hiện.
     * @returns {function} unsub — gọi để hủy tất cả listeners
     */
    function captureOnSubmit(onCapture) {
      if (typeof onCapture !== 'function') {
        throw new TypeError('captureOnSubmit: onCapture phải là function');
      }
  
      // Snapshot credentials tại thời điểm submit
      function _capture(event) {
        // Đọc giá trị trước khi form reset/navigate
        const creds = extractCredentials();
  
        // Nếu chưa đủ (multi-step bước 1): lưu username và không gọi callback
        if (!creds.isComplete && creds.loginStep === 'multi-step-username') {
          if (creds.username) {
            _multiStepState.username = creds.username;
            _multiStepState.usernameTimestamp = Date.now();
          }
          return; // Chờ bước tiếp theo
        }
  
        if (creds.isComplete) {
          _pendingCreds = {
            ...creds,
            captureEvent: event?.type || 'unknown',
            captureTimestamp: new Date().toISOString(),
            originUrl: location.href,         // URL trang login
          };
          _waitForLoginSuccess(onCapture);    // bắt đầu theo dõi
        }
      }
  
      const listeners = [];
  
      // ── 1. Form submit events ──
      function _attachToForms(root) {
        const forms = root ? root.querySelectorAll('form') : [];
        for (const form of forms) {
          const handler = (e) => _capture(e);
          form.addEventListener('submit', handler);
          listeners.push({ el: form, type: 'submit', handler });
        }
      }
      _attachToForms(document);
  
      // ── 2. Submit button click ──
      function _attachToSubmitButtons(root) {
        const btns = root
          ? root.querySelectorAll(
              '[type="submit"], button:not([type="button"]), [role="button"]'
            )
          : [];
        for (const btn of btns) {
          const handler = (e) => _capture(e);
          btn.addEventListener('click', handler);
          listeners.push({ el: btn, type: 'click', handler });
        }
      }
      _attachToSubmitButtons(document);
  
      // ── 3. Enter key trên password / username field ──
      function _attachKeydownCapture() {
        const handler = (e) => {
          if (e.key === 'Enter') {
            const tag = e.target.tagName;
            const type = (e.target.type || '').toLowerCase();
            if (tag === 'INPUT' && ['text', 'email', 'password', 'tel'].includes(type)) {
              _capture(e);
            }
          }
        };
        document.addEventListener('keydown', handler, true);
        listeners.push({ el: document, type: 'keydown', handler, capture: true });
      }
      _attachKeydownCapture();
  
      // ── 4. Observer: tự attach vào form/button mới xuất hiện (SPA) ──
      const domObserver = new MutationObserver(function (mutations) {
        for (const m of mutations) {
          if (m.type === 'childList') {
            for (const node of m.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.tagName === 'FORM') {
                const handler = (e) => _capture(e);
                node.addEventListener('submit', handler);
                listeners.push({ el: node, type: 'submit', handler });
              }
              // Tìm form/button con
              _attachToForms(node.querySelectorAll ? node : null);
              _attachToSubmitButtons(node.querySelectorAll ? node : null);
            }
          }
        }
      });
      domObserver.observe(document.body, { childList: true, subtree: true });
  
      // Hàm hủy đăng ký
      function unsub() {
        for (const { el, type, handler, capture } of listeners) {
          el.removeEventListener(type, handler, capture || false);
        }
        domObserver.disconnect();
        listeners.length = 0;
      }
      let _pendingCreds   = null;   // credentials tạm thời chờ xác nhận
      let _loginWatcher   = null;   // interval/observer theo dõi login thành công
  
      _submitListeners.push(unsub);
      return unsub;
    }

    /**
 * Theo dõi sau khi user submit, chờ dấu hiệu login thành công.
 * Khi phát hiện thành công → gọi onCapture với pending creds.
 *
 * Dấu hiệu login thành công (bất kỳ một trong các điều kiện):
 *   1. URL thay đổi sang domain khác hoặc path khác (redirect sau login)
 *   2. Password field biến mất khỏi DOM
 *   3. Trang load lại (beforeunload + pageshow)
 *
 * @param {function} onCapture
 */
function _waitForLoginSuccess(onCapture) {
  // Hủy watcher cũ nếu có
  if (_loginWatcher) {
    clearInterval(_loginWatcher);
    _loginWatcher = null;
  }

  const startUrl        = location.href;
  const startTime       = Date.now();
  const TIMEOUT_MS      = 30_000;  // bỏ theo dõi sau 30s

  // ── Cách 1: Theo dõi URL change (SPA dùng History API) ──
  // và password field biến mất (trang re-render sau login)
  _loginWatcher = setInterval(() => {
    if (Date.now() - startTime > TIMEOUT_MS) {
      _clearLoginWatcher();
      return;
    }

    if (_detectLoginSuccess(startUrl)) {
      _confirmLoginSuccess(onCapture);
    }
  }, 300);

  // ── Cách 2: Trang navigate thật (full page reload) ──
  // content.js sẽ chết và khởi động lại, background giữ creds
  // → content.js mới gửi PAGE_LOADED_AFTER_LOGIN để background kích hoạt popup
  window.addEventListener('beforeunload', () => {
    // Gửi signal cho background: "tôi sắp die, có pending creds"
    if (_pendingCreds) {
      chrome.runtime.sendMessage({
        type    : 'CREDENTIALS_SUBMITTED',
        username: _pendingCreds.username,
        password: _pendingCreds.password,
        url     : _pendingCreds.originUrl,
        isUpdate: false,
      });
    }
  }, { once: true });
}

/**
 * Phát hiện login thành công dựa trên thay đổi DOM/URL.
 * @param {string} startUrl - URL lúc submit
 * @returns {boolean}
 */
function _detectLoginSuccess(startUrl) {
  // ── Điều kiện 1: URL đã thay đổi (SPA redirect) ──
  const urlChanged = location.href !== startUrl;

  // ── Điều kiện 2: Không còn password field visible trên trang ──
  const scanResult   = scan();
  const hasPassword  = scanResult.passwordFields.some(f => isVisible(f.element));
  const hadPassword  = true; // Tại thời điểm submit chắc chắn có

  const passwordGone = !hasPassword;

  // ── Điều kiện 3: Có dấu hiệu "dashboard" / "home" trong URL ──
  const successUrlPatterns = [
    /dashboard/i, /home/i, /feed/i, /app\//i,
    /account/i,  /profile/i, /welcome/i,
  ];
  const urlLooksLikeSuccess = successUrlPatterns.some(p => p.test(location.href));

  // Kết luận: URL thay đổi VÀ (password biến mất HOẶC URL trông như success)
  return urlChanged && (passwordGone || urlLooksLikeSuccess);
}

function _confirmLoginSuccess(onCapture) {
  _clearLoginWatcher();
  if (!_pendingCreds) return;

  const creds      = _pendingCreds;
  _pendingCreds    = null;

  // Gọi callback bây giờ — đây là thời điểm đúng
  onCapture(creds);
}

function _clearLoginWatcher() {
  if (_loginWatcher) {
    clearInterval(_loginWatcher);
    _loginWatcher = null;
  }
}
  
    /**
     * Hủy tất cả captureOnSubmit listeners đang hoạt động.
     */
    function stopAllCapture() {
      for (const unsub of _submitListeners) unsub();
      _submitListeners = [];
    }
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 12. PUBLIC API
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    const CredentialScanner = {
      /**
       * Quét DOM một lần và trả về kết quả nhận diện fields.
       * @returns {object}
       */
      scan,
  
      /**
       * Quét và phân tích thêm ngữ cảnh form.
       * @returns {{ scan: object, formContexts: object[] }}
       */
      scanWithContext() {
        const result = scan();
        return {
          scan: result,
          formContexts: analyzeFormContext(result),
        };
      },
  
      /**
       * Quét DOM và đọc giá trị credentials hiện tại.
       * Tự động xử lý multi-step (lưu/phục hồi username giữa các bước).
       *
       * @returns {{
       *   username: string,
       *   password: string,
       *   loginStep: string,
       *   isComplete: boolean,
       *   usernameSource: string,
       *   passwordSource: string,
       *   scanTimestamp: string
       * }}
       */
      extractCredentials,
  
      /**
       * Bắt credentials ngay khi user submit (form submit / button click / Enter).
       * Trả về hàm unsub() để hủy listeners.
       *
       * @param {function(credentials): void} onCapture
       * @returns {function} unsub
       */
      captureOnSubmit,
  
      /** Hủy tất cả captureOnSubmit đang hoạt động. */
      stopAllCapture,
  
      /**
       * Theo dõi DOM liên tục, hữu ích cho multi-step login.
       * @param {function} onChange
       * @param {number} [debounceMs]
       */
      startObserver,
  
      /** Dừng theo dõi MutationObserver. */
      stopObserver,
      confirmPendingCredentials(onCapture) {
        if (_pendingCreds) {
          _confirmLoginSuccess(onCapture);
        }
      }
    };
  
    /* ═══════════════════════════════════════════════════════════════════════════
     * 13. EXPORT
     * ═══════════════════════════════════════════════════════════════════════════ */
  
    // UMD-lite: hỗ trợ CommonJS, AMD, và global browser
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = CredentialScanner;
    } else if (typeof define === 'function' && define.amd) {
      define([], function () { return CredentialScanner; });
    } else {
      global.CredentialScanner = CredentialScanner;
    }
  
  })(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
  