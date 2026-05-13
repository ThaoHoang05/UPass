let loginAsset ={
    url: null,
    username: null,
    password: null
}
let loginForm = null;
/*
    CHỨC NĂNG LẤY THÔNG TIN ĐĂNG NHẬP HIỆN TẠI TRÊN TRÌNH DUYỆT VÀ GỬI VỀ POPUP 
*/
function getClosestForm(passwordField){
    if(passwordField){
        const closestForm = passwordField.closest('form');
        if(closestForm) {
            loginForm = closestForm;
        }
        else console.error('Không tìm thấy form chứa trường mật khẩu');
    }else console.error('Không tìm thấy trường mật khẩu trên trang');
}

function getLoginAsset(){
    // Simply use window.location.href to get the current URL
    const URL = window.location.href;
    
    const passwordField = document.querySelector('input[type="password"]');
    if (passwordInput) {
        passwordInput.addEventListener('input', function(event) {
            const currentPassword = event.target.value; 
            loginAsset.password = currentPassword; // Update the password in loginAsset as the user types
        });
    }
    getClosestForm(passwordField);
    
    if(passwordField && loginForm) { // Changed closestForm to loginForm
        let usernameField = null;
        const inputFields = Array.from(loginForm.querySelectorAll('input:not([type="password"])')); // Converted to Array
        
        usernameField = inputFields.find((input) => {
            const auto = input.getAttribute('autocomplete') || "";
            return auto.includes('username') || auto.includes('email');
        });

        if(!usernameField) {
            // Backup search logic
            usernameField = inputFields.find(input => {
                const type = input.type.toLowerCase();
                const nameId = (input.name + input.id).toLowerCase();
                return type === 'email' || ['user', 'email', 'login', 'account'].some(kw => nameId.includes(kw));
            });
        }
        
        if (!usernameField) {
            const allFormInputs = Array.from(loginForm.querySelectorAll('input')); // Changed form to loginForm
            const passIndex = allFormInputs.indexOf(passwordField);
            
            for (let i = passIndex - 1; i >= 0; i--) {
                const type = allFormInputs[i].type.toLowerCase();
                if (type === 'text' || type === 'email') {
                    usernameField = allFormInputs[i];
                    break;
                }
            }
        }

        if (usernameField && passwordField) {
            loginAsset.url = URL;
            usernameField.addEventListener('input', function(event) {
                const currentUsername = event.target.value; 
                loginAsset.username = currentUsername; // Update the username in loginAsset as the user types
            });
        } else {
            console.error('Không tìm thấy trường tên đăng nhập hợp lệ');
        }
    }
}

function saveData(){
    
}

function rejectToSave(){

}

function sendMessageToPopup(data){
    chrome.runtime.sendMessage({ action: 'loginData', data: data }, (response) => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
        } else {
            console.log('Dữ liệu đã được gửi đến popup:', response);
        }
    });
}

function init(){
   getLoginAsset();
   sendMessageToPopup('FETCH_DATA_COMPLETE');
}

init();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ACCEPT') {
        saveData();
        sendResponse({ status: 'success', message: 'Dữ liệu đã được lưu' });
    }
    else if (message.action === 'REJECT') {
        rejectToSave();
        sendResponse({ status: 'success', message: 'Dữ liệu đã bị từ chối' });
    }
});