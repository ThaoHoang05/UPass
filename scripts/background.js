'use strict';

// Bộ nhớ đệm lưu trữ thông tin đăng nhập tạm thời theo từng Tab ID
// Cấu trúc: { [tabId]: { username, password, url, isUpdate } }
const pendingCredentials = {};

// Lắng nghe tất cả các tín hiệu từ Content Script (quét form) và từ giao diện Popup gửi về
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Xác định tabId gửi đến (từ nội dung trang web hoặc truyền thủ công từ popup)
  const tabId = message.tabId || sender.tab?.id;

  switch (message.type) {

    // 1. NHẬN DIỆN: Content Script phát hiện hành vi Đăng nhập/Đổi mật khẩu thành công
    case 'CREDENTIALS_DETECTED':
      if (tabId) {
        pendingCredentials[tabId] = {
          username: message.username,
          password: message.password,
          url     : message.url,
          isUpdate: message.isUpdate || false,
        };

        // Chủ động tạo một cửa sổ Windows độc lập (dạng Prompt giống Chrome) để hỏi lưu
        chrome.windows.create({
          url    : `scripts/popup.html?tabId=${tabId}`,
          type   : 'popup',
          width  : 380,
          height : 310,
          focused: true,
        });
      }
      sendResponse({ ok: true });
      break;

    // 2. TRUY XUẤT: Cửa sổ Popup mở lên và xin dữ liệu tài khoản để hiển thị
    case 'PROMPT_GET_CREDS':
      if (tabId && pendingCredentials[tabId]) {
        sendResponse({ ok: true, creds: pendingCredentials[tabId] });
      } else {
        sendResponse({ ok: false, error: 'No data' });
      }
      break;

    // 3. THỰC THI LƯU: Người dùng bấm đồng ý lưu mật khẩu trên giao diện popup
    case 'PROMPT_SAVE':
      if (tabId && pendingCredentials[tabId]) {
        const targetCred = pendingCredentials[tabId];

        // Thuật toán mã hóa XOR (đồng bộ với content.js)
        const _XOR_KEY    = 'cr3d$t0r@g3_k3y!';
        const _xorEncode  = (str) => {
          if (!str) return str;
          let res = '';
          for (let i = 0; i < str.length; i++) {
            res += String.fromCharCode(
              str.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length)
            );
          }
          return btoa(res);
        };

        const host = new URL(targetCred.url).hostname.replace(/^www\./, '');
        const key  = `cred_${host}`;
        const id   = targetCred.username.toLowerCase().trim();

        chrome.storage.local.get(key, (data) => {
          let domainData = data[key] || {};

          // Ghi dữ liệu chuẩn form Autofill của content.js (đã mã hóa passwordEnc)
          domainData[id] = {
            username   : targetCred.username,
            passwordEnc: _xorEncode(targetCred.password),
            url        : targetCred.url,
            createdAt  : domainData[id]?.createdAt || new Date().toISOString(),
            updatedAt  : new Date().toISOString(),
            useCount   : domainData[id]?.useCount  || 0,
          };

          chrome.storage.local.set({ [key]: domainData }, () => {
            delete pendingCredentials[tabId]; // Xóa bộ nhớ đệm
            sendResponse({ ok: true });
          });
        });

        return true; // async response
      }
      sendResponse({ ok: false, error: 'No pending credentials' });
      break;

    // 4. TỪ CHỐI: Người dùng bấm Bỏ qua hoặc Không bao giờ lưu trang này
    case 'PROMPT_DISMISS':
      if (tabId) {
        if (message.never && pendingCredentials[tabId]) {
          try {
            const domain = new URL(pendingCredentials[tabId].url).hostname;
            // Ghi domain vào blacklist để content script không hỏi lại
            chrome.storage.local.get({ blacklist: [] }, (data) => {
              const blacklist = data.blacklist;
              if (!blacklist.includes(domain)) {
                blacklist.push(domain);
                chrome.storage.local.set({ blacklist });
              }
            });
          } catch (e) {
            console.error('[BG] Blacklist error:', e);
          }
        }
        delete pendingCredentials[tabId]; // Xóa bộ nhớ đệm tạm
      }
      sendResponse({ ok: true });
      break;

    // 5. TRANG MỚI LOAD: content.js báo trang vừa load xong sau khi login
    //    → kiểm tra xem có pending creds không, nếu có thì mở popup hỏi lưu
    case 'PAGE_LOADED_AFTER_LOGIN': {
      const loginTabId = sender.tab?.id;
      const pending    = loginTabId ? pendingCredentials[loginTabId] : null;

      if (pending) {
        // Có pending creds từ lần submit trước → mở popup hỏi lưu ngay
        chrome.windows.create({
          url    : `scripts/popup.html?tabId=${loginTabId}`,
          type   : 'popup',
          width  : 380,
          height : 310,
          focused: true,
        });
        sendResponse({ ok: true, hasPending: true });
      } else {
        sendResponse({ ok: true, hasPending: false });
      }
      return true; // async response
    }
    case 'BACKGROUND_SAVE_GENERATED': {
      const targetCred = message;

      // Thuật toán mã hóa XOR tái sử dụng
      const _XOR_KEY    = 'cr3d$t0r@g3_k3y!';
      const _xorEncode  = (str) => {
        if (!str) return str;
        let res = '';
        for (let i = 0; i < str.length; i++) {
          res += String.fromCharCode(
            str.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length)
          );
        }
        return btoa(res);
      };

      try {
        const host = new URL(targetCred.url).hostname.replace(/^www\./, '');
        const key  = `cred_${host}`;
        const id   = targetCred.username.toLowerCase();

        chrome.storage.local.get(key, (data) => {
          let domainData = data[key] || {};

          domainData[id] = {
            username   : targetCred.username,
            passwordEnc: _xorEncode(targetCred.password),
            url        : targetCred.url,
            createdAt  : domainData[id]?.createdAt || new Date().toISOString(),
            updatedAt  : new Date().toISOString(),
            useCount   : domainData[id]?.useCount || 0,
          };

          chrome.storage.local.set({ [key]: domainData }, () => {
            sendResponse({ ok: true });
          });
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }

      return true; // Giữ cổng kết nối để trả callback
    }
  }
});