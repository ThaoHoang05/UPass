/*
    CHỨC NĂNG LƯU MẬT KHẨU 
*/
function getCurrentTab(callback) {
    let queryOptions = { active: true, lastFocusedWindow: true };
    chrome.tabs.query(queryOptions, ([tab]) => {
      if (chrome.runtime.lastError)
      console.error(chrome.runtime.lastError);
      // `tab` will either be a `tabs.Tab` instance or `undefined`.
      callback(tab);
    });
  }

function getLoginAsset(){
    const URL = getCurrentTab((tab) => {
        if(tab !== undefined){
            console.log(tab.url);
            return tab.url;
        }
        else console.error('Không thể lấy URL của tab hiện tại');
    });
    const passwordField = document.querySelector('input[type="password"]');
    if(passwordField){
    const closetForm = passwordField.closest('form');
    if(!closetForm)console.error('Không tìm thấy form chứa trường mật khẩu');
    else {
        let usernameField = null;
        const inputFields = closetForm.querySelectorAll('input:not[type="password"]'); 
        usernameField = inputFields.find((input)=>{
            const auto = input.getAttribute('autocomplete') || "";
            return auto.includes('username') || auto.includes('email');
        });
        if(!usernameField)console.error('Không tìm thấy trường tên đăng nhập trong form chứa trường mật khẩu');
        else {
            usernameField = potentialInputs.find(input => {
                const type = input.type.toLowerCase();
                const nameId = (input.name + input.id).toLowerCase();
                return type === 'email' || ['user', 'email', 'login', 'account'].some(kw => nameId.includes(kw));
            });
        }
        if (!usernameField) {
            const allFormInputs = Array.from(form.querySelectorAll('input'));
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
            const loginAsset = {
                url: URL,
                username: usernameField.value,
                password: passwordField.value
            };
            console.log('Login Asset:', loginAsset);
            return loginAsset;
        }
    }
    }else console.error('Không tìm thấy trường mật khẩu trên trang');
}

function saveData(){
    
}

function rejectToSave(){

}

function sendMessageToPopup(){
}

function listenMessageFromPopup(){

}