'use strict';

let _vaultData = [];

const getElements = () => ({
  elVaultBody: document.getElementById('vaultBody'),
  elSearchInp: document.getElementById('searchInp'),
  elEmptyState: document.getElementById('emptyState')
});

function init() {
  // 💡 THUẬT TOÁN GIẢI MÃ KHỚP VỚI BACKGROUND & CONTENT
  const _XOR_KEY = 'cr3d$t0r@g3_k3y!';
  const _xorDecode = (encoded) => {
    try {
      const str = atob(encoded);
      let res = '';
      for (let i = 0; i < str.length; i++) {
        res += String.fromCharCode(str.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length));
      }
      return res;
    } catch (_) { return encoded; }
  };

  chrome.storage.local.get(null, (data) => {
    let parsedVault = [];

    for (const key in data) {
      if (key.startsWith('cred_')) {
        const domain = key.replace('cred_', ''); 
        const accounts = data[key];

        for (const usernameId in accounts) {
          const accountData = accounts[usernameId];
          
          // Nếu có pass mã hóa thì giải mã, không thì lấy pass thường
          let pwd = accountData.passwordEnc ? _xorDecode(accountData.passwordEnc) : (accountData.password || '***');

          parsedVault.push({
            url: domain,       
            username: accountData.username || usernameId, 
            password: pwd,
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
          <input type="password" class="pwd-input mono" value="${item.password}" readonly>
          <button class="btn-action btn-toggle">👁</button>
        </div>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn-action btn-delete" title="Xóa tài khoản">🗑️</button>
        </div>
      </td>
    `;

    // Ẩn/Hiện mật khẩu
    const btnToggle = tr.querySelector('.btn-toggle');
    const inputPwd = tr.querySelector('.pwd-input');
    btnToggle.addEventListener('click', () => {
      if (inputPwd.type === 'password') {
        inputPwd.type = 'text';
        btnToggle.textContent = '🙈';
      } else {
        inputPwd.type = 'password';
        btnToggle.textContent = '👁';
      }
    });

    // Xóa tài khoản
    const btnDelete = tr.querySelector('.btn-delete');
    btnDelete.addEventListener('click', () => {
      if (confirm(`Xóa tài khoản ${item.username} của trang [ ${item.url} ]?`)) {
        
        // Gọi lại data cũ để xóa đúng user đó
        chrome.storage.local.get(item.originalKey, (res) => {
           let domainData = res[item.originalKey];
           if (domainData && domainData[item.username]) {
               delete domainData[item.originalId]; // Xóa user
               
               // Nếu domain này không còn user nào, xóa luôn cả key domain
               if (Object.keys(domainData).length === 0) {
                   chrome.storage.local.remove(item.originalKey);
               } else {
                   // Vẫn còn user khác thì cập nhật lại
                   let update = {};
                   update[item.originalKey] = domainData;
                   chrome.storage.local.set(update);
               }
           }
        });

        // Xóa tạm trên UI
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