'use strict';

let _vaultData = [];

const getElements = () => ({
  elVaultBody: document.getElementById('vaultBody'),
  elSearchInp: document.getElementById('searchInp'),
  elEmptyState: document.getElementById('emptyState')
});

// ==========================================
// 1. CÁC HÀM TIỆN ÍCH DÙNG CHUNG
// ==========================================

// Hàm giải mã XOR
const _XOR_KEY = 'cr3d$t0r@g3_k3y!';
const _xorDecode = (encoded) => {
  if (!encoded) return '';
  try {
    const str = atob(encoded);
    let res = '';
    for (let i = 0; i < str.length; i++) {
      res += String.fromCharCode(str.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length));
    }
    return res;
  } catch (_) { return encoded; }
};

// Hàm sinh bộ đệm ngẫu nhiên
function generateRandomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Hàm gọi trực tiếp Windows Hello (Chỉ dùng được trong trang của Extension)
async function verifyWindowsHello() {
  try {
    const data = await chrome.storage.local.get(['windowsHelloCredId']);
    
    // Nếu chưa từng tạo Passkey, mặc định cho phép xem (tùy thuộc vào logic của bạn)
    if (!data.windowsHelloCredId) {
      console.warn("Chưa cài đặt Windows Hello, cho qua.");
      return true; 
    }

    const credIdBuffer = new Uint8Array(data.windowsHelloCredId).buffer;

    await navigator.credentials.get({
      publicKey: {
        challenge: generateRandomBytes(32),
        allowCredentials: [{
          type: "public-key",
          id: credIdBuffer
        }],
        userVerification: "required",
        timeout: 60000
      }
    });

    return true; // Xác thực thành công
  } catch (err) {
    console.error("Xác thực thất bại:", err);
    return false; // Bị hủy hoặc sai sinh trắc học
  }
}

// ==========================================
// 2. KHỞI TẠO VÀ RENDER DỮ LIỆU
// ==========================================

function init() {
  chrome.storage.local.get(null, (data) => {
    let parsedVault = [];

    for (const key in data) {
      if (key.startsWith('cred_')) {
        const domain = key.replace('cred_', ''); 
        const accounts = data[key];

        for (const usernameId in accounts) {
          const accountData = accounts[usernameId];
          
          parsedVault.push({
            url: domain,       
            username: accountData.username || usernameId, 
            // KHÔNG GIẢI MÃ Ở ĐÂY. Giữ nguyên bản mã hóa.
            // Phòng hờ tài khoản cũ chưa mã hóa, ta chuyển nó sang base64 tạm.
            passwordEnc: accountData.passwordEnc || btoa(accountData.password || ''),
            originalKey: key,
            originalId: usernameId
          });
        }
      }
    }

    _vaultData = parsedVault;
    performRender(_vaultData);
  });
}

function performRender(items) {
  const { elVaultBody, elEmptyState } = getElements();
  if (!elVaultBody) return;

  elVaultBody.innerHTML = '';
  
  if (!items || items.length === 0) {
    if (elEmptyState) elEmptyState.style.display = 'block';
    return;
  }
  
  if (elEmptyState) elEmptyState.style.display = 'none';

  items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="site-name" title="${item.url}">${item.url}</span>
      </td>
      <td class="mono">${item.username}</td>
      <td>
        <div class="pwd-container">
          <input type="password" class="pwd-input mono" value="••••••••" data-enc="${item.passwordEnc}" readonly>
          <button class="btn-action btn-toggle" title="Xem mật khẩu">👁</button>
        </div>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn-action btn-delete" title="Xóa tài khoản">🗑️</button>
        </div>
      </td>
    `;

    // Nút Ẩn/Hiện mật khẩu
    const btnToggle = tr.querySelector('.btn-toggle');
    const inputPwd = tr.querySelector('.pwd-input');
    
    btnToggle.addEventListener('click', async () => {
      // 1. Nếu đang hiển thị chữ rõ ràng -> Bấm để Ẩn đi (Không cần xác thực)
      if (inputPwd.type === 'text') {
        inputPwd.type = 'password';
        inputPwd.value = '••••••••'; // Ghi đè lại bằng dấu chấm
        btnToggle.textContent = '👁';
        return;
      }

      // 2. Nếu đang ẩn -> Bấm để Xem -> Bắt buộc xác thực
      btnToggle.textContent = '⏳';
      btnToggle.disabled = true; // Khóa nút trong lúc chờ

      const isVerified = await verifyWindowsHello();

      if (isVerified) {
        // Xác thực thành công: Đọc chuỗi mã hóa, giải mã và hiển thị
        const encryptedPwd = inputPwd.getAttribute('data-enc');
        inputPwd.value = _xorDecode(encryptedPwd);
        inputPwd.type = 'text';
        btnToggle.textContent = '🙈';
      } else {
        // Xác thực thất bại hoặc Hủy
        alert('Không thể xác minh danh tính. Không thể xem mật khẩu!');
        btnToggle.textContent = '👁';
      }

      btnToggle.disabled = false; // Mở khóa nút
    });

    // Xóa tài khoản (Giữ nguyên logic của bạn)
    const btnDelete = tr.querySelector('.btn-delete');
    btnDelete.addEventListener('click', () => {
      if (confirm(`Xóa tài khoản ${item.username} của trang [ ${item.url} ]?`)) {
        chrome.storage.local.get(item.originalKey, (res) => {
           let domainData = res[item.originalKey];
           if (domainData && domainData[item.username]) {
               delete domainData[item.originalId]; 
               
               if (Object.keys(domainData).length === 0) {
                   chrome.storage.local.remove(item.originalKey);
               } else {
                   let update = {};
                   update[item.originalKey] = domainData;
                   chrome.storage.local.set(update);
               }
           }
        });

        _vaultData = _vaultData.filter(i => !(i.url === item.url && i.username === item.username));
        triggerSearch();
      }
    });

    elVaultBody.appendChild(tr);
  });
}

function triggerSearch() {
  const { elSearchInp } = getElements();
  const query = elSearchInp ? elSearchInp.value.toLowerCase().trim() : '';
  
  if (!query) {
    performRender(_vaultData);
    return;
  }
  
  const filtered = _vaultData.filter(item => {
    return (item.url && item.url.toLowerCase().includes(query)) || 
           (item.username && item.username.toLowerCase().includes(query));
  });
  
  performRender(filtered);
}

document.addEventListener('DOMContentLoaded', () => {
  const { elSearchInp } = getElements();
  if (elSearchInp) elSearchInp.addEventListener('input', triggerSearch);
  init();
});

chrome.storage.local.get(null, (data) => console.log("Dữ liệu Options đọc được:", data));