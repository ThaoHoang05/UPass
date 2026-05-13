function receiveMessageFromContentScript() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'loginData') {
            console.log('Đã nhận thông tin đăng nhập từ content script:', message.data);
            // Update UI with message.data if needed
            sendResponse({ status: 'received', message: 'Popup đã nhận dữ liệu' });
        }
    });
}

function sendMessageToContentScript(actionMsg){
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: actionMsg }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                } else {
                    console.log('Phản hồi từ content script:', response);
                }
            });
        }
    });
}

// Hàm khởi tạo khi popup đc mở
function init(){
    receiveMessageFromContentScript();
    
    const acceptBtn = document.getElementById('accept');
    const rejectBtn = document.getElementById('reject');
    
    acceptBtn.addEventListener('click',() => {
        sendMessageToContentScript('ACCEPT');
    });
    
    rejectBtn.addEventListener('click',() => {
        sendMessageToContentScript('REJECT');
    });
}

init();