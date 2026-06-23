'use strict';

// Hàm tạo chuỗi ngẫu nhiên
function generateRandomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

document.addEventListener('DOMContentLoaded', async () => {
  const btnStart = document.getElementById('btnStartVerify');
  const statusText = document.getElementById('statusText');
  const subText = document.getElementById('subText');

  btnStart.addEventListener('click', async () => {
    try {
      // Ẩn nút đi và đổi dòng chữ để UX mượt hơn
      btnStart.style.display = 'none';
      subText.style.display = 'none';
      statusText.textContent = "Đang chờ Windows Hello...";

      // Kiểm tra xem đã có Passkey trong ổ đĩa chưa
      const data = await chrome.storage.local.get(['windowsHelloCredId']);

      if (!data.windowsHelloCredId) {
        // ==========================================
        // LẦN ĐẦU TIÊN: CHƯA CÓ PASSKEY -> TẠO MỚI
        // ==========================================
        statusText.textContent = "Thiết lập bảo mật lần đầu...";
        
        const credential = await navigator.credentials.create({
          publicKey: {
            challenge: generateRandomBytes(32),
            rp: { 
              name: "Trình quản lý mật khẩu", 
              id: chrome.runtime.id // ID của Extension
            },
            user: { 
              id: generateRandomBytes(16), 
              name: "LocalUser", 
              displayName: "Chủ thiết bị" 
            },
            pubKeyCredParams: [{ alg: -7, type: "public-key" }],
            authenticatorSelection: {
              authenticatorAttachment: "platform", // Bắt buộc dùng Windows Hello
              userVerification: "required"
            },
            timeout: 60000
          }
        });

        // Lưu ID của Passkey vào storage để dùng cho những lần sau
        const idArray = Array.from(new Uint8Array(credential.rawId));
        await chrome.storage.local.set({ windowsHelloCredId: idArray });

      } else {
        // ==========================================
        // CÁC LẦN SAU: ĐÃ CÓ PASSKEY -> XÁC THỰC
        // ==========================================
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
      }

      // Nếu code chạy đến đây (không văng lỗi) -> Vân tay/Khuôn mặt chuẩn xác!
      statusText.textContent = "Thành công!";
      statusText.style.color = "#a6e3a1"; // Đổi chữ sang màu xanh
      
      // Báo về Background và tự động đóng cửa sổ
      await chrome.runtime.sendMessage({ type: 'VERIFY_SUCCESS' });
      setTimeout(() => window.close(), 300); // Delay 300ms cho mượt

    } catch (err) {
      console.error("Lỗi WebAuthn:", err);
      
      statusText.textContent = "Xác thực thất bại hoặc bị hủy.";
      statusText.style.color = "#f38ba8"; // Đổi chữ sang màu đỏ
      
      // Báo lỗi về Background để trang web hiển thị thông báo
      await chrome.runtime.sendMessage({ type: 'VERIFY_FAILED' });
      
      // Tự động đóng popup sau 1.5 giây để user kịp đọc thông báo lỗi
      setTimeout(() => window.close(), 1500); 
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  // Lấy 2 trạng thái độc lập từ Option
  chrome.storage.local.get(['lightModeEnabled', 'largeTextEnabled'], (result) => {
    if (result.lightModeEnabled) {
      document.body.classList.add('light-mode');
    }
    if (result.largeTextEnabled) {
      document.body.classList.add('large-text');
    }
  });
});