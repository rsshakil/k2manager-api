var result = true;
//var orResult = true;
var latestCheck = true;

var deps = 0;

exports.checkFilter =  (filter, body) => {
    // console.log("checkFilter start ===================");
    result = true;
    latestCheck = true;
    let value = checkFilterCirculer(filter, body);
    // console.log(" value ==== '" + value + "'");
	return value;
}
function checkFilterCirculer (filter, body) {

    // console.log("body", body);
    let check;
// console.log("filter@@@@@@@@@@@@@", filter)
    if (result === false && deps === 0) {
        return false;
    }
    for (let i = 0; i < filter.length; i++) {
        if(filter.length == 3 && (filter[1] != "and" && filter[1] != "or")) {
            let row = filter;
            // let key = (row[0].length == 8)? row[0] : row[0].substr(-8);
            let key = row[0];
            let operation = row[1];
            let value = row[2];
            let filterValue;
            let fieldValue;
            // console.log("body[key]", body[key]);
            // console.log("key", key);
            if (key.includes(".")) {
                key = key.slice((key.lastIndexOf(".")) + 1, key.length)
            }
            [filterValue, fieldValue] = dataMold(body[key].fieldType, value, body[key].fieldValue);
            check = match(filterValue, fieldValue, operation, body);
            // console.log("----------check " + key, check)
            // console.log("xxx -------- 0 ", check);
            // console.log("----------check", check)
// console.log("----------check ==== " + key , check)
// console.log("----------filterValue ==== " + key , filterValue)
// console.log("----------fieldValue ==== " + key , fieldValue)
            latestCheck = check;
        }else {
            let row = filter[i];
            // console.log("checkRow ", row);      
            // AND ORだった場合
            if (!Array.isArray(row)) {
                // console.log("xxx -------- 1 ", latestCheck);
                ++deps;
                if (row == "and") {
                    if (latestCheck === false) {
                        result = false;
                        return result;
                    }
                }
                else {
                    if (latestCheck === true) {
                        return true
                    }
                }
            }
            // 条件の場合
            else if (row[1] != "and" && row[1] != "or") {
                // let key = (row[0].length == 8)? row[0] : row[0].substr(-8);
                let key = row[0];
                let operation = row[1];
                let value = row[2];
                let filterValue;
                let fieldValue;
                if (key.includes(".")) {
                    key = key.slice((key.lastIndexOf(".")) + 1, key.length)
                }
                [filterValue, fieldValue] = dataMold(body[key].fieldType, value, body[key].fieldValue);
                // console.log("xxx -------- 2 start");
                check = match(filterValue, fieldValue, operation, body);
                // console.log("----------check " + key, check)
                latestCheck = check;
                // console.log("xxx -------- 2 ", check);
            }
            // 子供条件だった場合
            else {
                // console.log("xxx -------- 3 start");
                ++deps;
                check = checkFilterCirculer(row, body);
                // console.log("xxx -------- 3 ", check);
                latestCheck = check;
            }
        }
    }
    --deps;
    return latestCheck;
}


function dataMold (fieldType, filterValue,  fieldValue) {
    let moldFilterValue, moldFieldValue;
    switch (fieldType) {
        case 0:
        case 1: 
        case 2: 
        case 3: 
        case 4: 
            moldFilterValue = filterValue;
            moldFieldValue = fieldValue;
            break;
        case 5: 
            if (Array.isArray(filterValue)) {
                moldFilterValue = [];
                for (let i = 0; i < filterValue.length; i++) moldFilterValue.push(Math.floor((new Date(filterValue[i]).getTime()) / 1000))
            }
            else {
                moldFilterValue = Math.floor((new Date(filterValue).getTime()) / 1000);
            }
            moldFieldValue = (fieldValue + 32400);
            break;
        case 6: 
            if (Array.isArray(filterValue)) {
                moldFilterValue = [];
                for (let i = 0; i < filterValue.length; i++) moldFilterValue.push(filterValue[i]);
            }
            else {
                moldFilterValue = filterValue;
            }
            // Convert to Int type for comparing integers
            moldFieldValue = Number.parseInt(fieldValue);
            break;
        case 7: 
            if (Array.isArray(filterValue)) {
                moldFilterValue = [];
                for (let i = 0; i < filterValue.length; i++) moldFilterValue.push(filterValue[i])
            }
            else {
                moldFilterValue = filterValue;
            }
            moldFieldValue = fieldValue;
            break;
    }
    return [moldFilterValue, moldFieldValue];
}

function match (filterValue, fieldValue, operation, body) {
    // console.log("filterValue === ", filterValue);
    // console.log("fieldValue === ", fieldValue);
    // console.log("filterValue === ", typeof filterValue);
    // console.log("fieldValue === ", typeof fieldValue);
    // console.log("operation === ", operation);
    
    let check = false;
    switch (operation) {
        case "=": 
            if (fieldValue == filterValue) check = true;
            else check = false
            break;
        case "<>":
            if (fieldValue != filterValue) check = true;
            else check = false
            break;
        case "<":
            if (fieldValue) {
                if (fieldValue < filterValue) check = true;
                else check = false
            } 
            else {
                check = false
            }
            break;
        case "<=":
            if (fieldValue) {
                if (fieldValue <= filterValue) check = true;
                else check = false
            } 
            else {
                check = false
            }
            break;
        case ">":
            if (fieldValue) {
                if (fieldValue > filterValue) check = true;
                else check = false
            } 
            else {
                check = false
            }
            break;
        case ">=":
            if (fieldValue) {
                if (fieldValue >= filterValue) check = true;
                else check = false
            } 
            else {
                check = false
            }
            break;
        case "isblank":
            if (fieldValue == "") {
                check = true;
            } 
            else {
                check = false
            }
            break;
        case "isnotblank":
            if (fieldValue != "") {
                check = true;
            } 
            else {
                check = false
            }
            break;
        case "contains":
            if (fieldValue.includes(filterValue)) {
                check = true;
            } 
            else {
                check = false
            }
            break;
        case "notcontains":
            if (!fieldValue.includes(filterValue)) {
                check = true;
            } 
            else {
                check = false
            }
            break;
        case "startswith":
            if (fieldValue.startsWith(filterValue)) {
                check = true;
            } 
            else {
                check = false
            }
            break;
        case "endswith":
            if (fieldValue.endsWith(filterValue)) {
                check = true;
            } 
            else {
                check = false
            }
            break;
        case "between":
            if (fieldValue) {
                if (fieldValue <= filterValue[0] && fieldValue >= filterValue[1]) {
                    check = true;
                } 
                else {
                    check = false
                }
                break;
            }
        case "minlength":
            if (fieldValue && (fieldValue.length >= filterValue)) {
                check = true;
            }
            break;
        case "maxlength":
            if (fieldValue && (fieldValue.length <= filterValue)) {
                check = true;
            }
            break;
        case "same":
            if (fieldValue) {
                let sameFieldValue = body[filterValue].fieldValue
                if (fieldValue == sameFieldValue) {
                    check = true;
                }
            }
            break;
        case "notsame":
            if (fieldValue) {
                let sameFieldValue = body[filterValue].fieldValue
                if (fieldValue != sameFieldValue) {
                    check = true;
                }
            }
            break;

        case "listinclude":
            if (filterValue) {
                for (let j = 0; j < fieldValue.length; j++) {
                    if (filterValue == fieldValue[j].id && fieldValue[j].checked) {
                        check = true;
                        break;
                    }
                }
            }
            break;
        case "listnotinclude":
            if (filterValue) {
                check = true;
                for (let j = 0; j < fieldValue.length; j++) {
                    if (filterValue == fieldValue[j].id && fieldValue[j].checked) {
                        check = false;
                        break;
                    }
                }
            }
            break;
        case "regex":
            switch (filterValue) {
                // 半角数字のみ
                case "1":
                    if (!fieldValue || fieldValue.match(/^[0-9]*$/)) {
                        check = true
                    }
                    break;
                // 半角英語のみ
                case "2":
                    if (!fieldValue || fieldValue.match(/^[a-zA-Z]*$/)) {
                        check = true
                    }
                    break;
                // 半角英数字のみ
                case "3":
                    if (!fieldValue || fieldValue.match(/^[0-9a-zA-Z]*$/)) {
                        check = true
                    }
                    break;
                // 半角英数字と記号（-,.）のみ
                case "4":
                    if (!fieldValue || fieldValue.match(/^[a-zA-Z0-9!-/:-@¥[-`{-~]*$/)) {
                        check = true
                    }
                    break;
                // 半角カタカナのみ
                case "5":
                    if (!fieldValue || fieldValue.match(/^[ｧ-ﾝﾞﾟ\-]*$/)) {
                        check = true
                    }
                    break;
                // 半角文字列
                case "6":
                    if (!fieldValue || fieldValue.match(/^[ｧ-ﾝﾞﾟa-zA-Z0-9!-/:-@¥[-`{-~]*$/)) {
                        check = true
                    }
                    break;
                // 全角カタカナのみ
                case "7":
                    if (!fieldValue || fieldValue.match(/^[ァ-ンヴー]*$/)) {
                        check = true
                    }
                    break;
                // 全角文字列
                case "8":
                    if (!fieldValue || fieldValue.match(/^[^\x20-\x7e]*$/)) {
                        check = true
                    }
                    break;
                // 電話番号
                case "9":
                    if (!fieldValue || fieldValue.match(/^0[-\d]{9,12}$/)) {
                        check = true
                    }
                    break;
                // 郵便番号
                case "10":
                    if (!fieldValue || fieldValue.match(/^\d{3}-?\d{4}$/)) {
                        check = true
                    }
                    break;
                // メールアドレス
                case "11":
                    if (!fieldValue || fieldValue.match(/^[A-Za-z0-9]{1}[A-Za-z0-9_.-]*@{1}[A-Za-z0-9_.-]+.[A-Za-z0-9]+$/)) {
                        check = true
                    }
                    break;
            }
            break;
    }
    return check;
}