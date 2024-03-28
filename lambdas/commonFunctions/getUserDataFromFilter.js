const fieldColumnMapper = require('./mapperObject');

// body は 顧客と予約テーブルのデータ
exports.getUserDataFromFilter = (filter, body, fields = []) => {
    return checkFilterCirculator(filter, body, fields);
};

var deps = 0;
function checkFilterCirculator(filter, body, fields) {
    var result = true;
    var latestCheck = true;
    let check;

    // console.log("body", body)
    if (result === false && deps === 0) {
        return false;
    }

    for (let i = 0; i < filter.length; i++) {
        //For condition
        if (filter.length == 3 && (filter[1] != "and" && filter[1] != "or")) {
            check = conditionMatch(filter, body, fields);
            latestCheck = check;
        }
        //GoTo nested array
        else {
            let row = filter[i];
            // console.log("checkRow ", row);

            // AND ORだった場合
            if (!Array.isArray(row)) {
                // console.log("xxx -------- 1 ", latestCheck);
                ++deps;

                //(cond1 && cond2) : If left part is false then return false.
                //Because no need to check right part as we know (false & true/false) = false
                if (row == "and") {
                    if (latestCheck === false) {
                        --deps;
                        result = false;
                        return result;
                    }
                }
                //(cond1 || cond2) : If left part is true then return true.
                //Because no need to check right part as we know (true || true/false) = true
                else {
                    if (latestCheck === true) {
                        --deps;
                        return true
                    }
                }
            }
            // 条件の場合 (For condition)
            else if (row[1] != "and" && row[1] != "or") {
                check = conditionMatch(row, body, fields);
                latestCheck = check;
            }
            // 子供条件だった場合
            else {
                // console.log("xxx -------- 3 start");
                ++deps;
                check = checkFilterCirculator(row, body, fields);
                // console.log("xxx -------- 3 row", check);
                latestCheck = check;
            }
        }
    }
    --deps;
    return latestCheck;
}

//Function to check is given condition matched or not
function conditionMatch(conditionArray = [], body, fields = []) {
    let key = conditionArray[0];
    const operation = conditionArray[1];
    const value = conditionArray[2];

    if (key.includes('.')) {
        const arr = key.split('.')
        key = arr[1];
    }

    let row = fields.find((row) => row.fieldCode == key)
    console.log('key', key);
    console.log('row', row);

    //Get fieldValue 
    let fieldValueRaw = body[key];
    let filterValueRaw = value;

    if (fieldValueRaw === undefined) fieldValueRaw = body['orgField_' + key];

    if (fieldValueRaw === undefined && row) {
        if (row.fieldColumnName && row.fieldColumnName.includes('.')) {
            let new_key = row.fieldColumnName.split(".")[1];
            console.log('new_key', new_key);

            fieldValueRaw = body[new_key];
            if (fieldValueRaw === undefined) fieldValueRaw = body['orgField_' + new_key];
        }
    }

    if (fieldValueRaw === undefined || fieldValueRaw === null) fieldValueRaw = '';


    // if (body.customerId == 367831) {
    //     console.log('filter code same ', value)
    //     console.log('Finalval >>>>>>> body', body);
    //     console.log('Finalval >>>>>>> fieldValueRaw', fieldValueRaw);

    //     console.log('Finalval >>>>>>> filter_Value', value);
    //     console.log('Finalval >>>>>>> filterValueRaw', filterValueRaw);
    // }

    console.log("filterValue =====================1 before ", filterValueRaw);
    console.log("fieldValue =====================2 before ", fieldValueRaw);

    let [filterValue, fieldValue] = dataMold(row.fieldType, filterValueRaw, fieldValueRaw, operation, body);

    console.log("filterValue =====================1", filterValue);
    console.log("fieldValue =====================2", fieldValue);

    //filterValue = null means it is blank/notblank condition, so need to keep null for further checking
    if (filterValueRaw === null) filterValue = filterValueRaw;

    if ([4, 5, 6, 7].includes(row.fieldType) && operation != "regex") {
        if (/^\d+$/.test(fieldValue)) fieldValue = Number(fieldValue);
        if (/^\d+$/.test(filterValue)) filterValue = Number(filterValue);
    }

    const check = match(filterValue, fieldValue, operation, row.fieldType);

    return check;
}


//Function to modify fieldValue & filterValue in the same format according to fieldType
function dataMold(fieldType, filterValue, fieldValue, operation, body) {
    let moldFilterValue = '', moldFieldValue = '';
    switch (fieldType) {
        case 0:      //0 = テキスト型 (text type)
        case 1:      //1 = テキストエリア型 (textarea type)
        case 2:      //2 = 結合テキスト型 (combined text type)
        case 3:      //3 = リスト型 (list type)
        case 4:      //4 = YesNo型 (YesNo type)
        case 101:
        case 200:
            if (fieldValue != null && fieldValue != undefined) moldFieldValue = fieldValue;
            if (filterValue != null && filterValue != undefined) moldFilterValue = getFilterKeyValue(filterValue, operation, body);
            break;
        case 5:      //5 = 日付型 (date type)
        case 100:
            //Match with dateString value like 20230808 =date 20230808 
            if (["=date", "<>date", "<date", ">date", "<=date", ">=date", "samedate", "notsamedate"].includes(operation)) {
                if (fieldValue) moldFieldValue = formatDate(new Date(fieldValue * 1000), 'yyyyMMdd'); //user inputted value (1623234340) => 20230830

                if (filterValue) {
                    moldFilterValue = getFilterKeyValue(filterValue, operation, body);

                    if (moldFilterValue) {
                        if (operation == "samedate" || operation == "notsamedate") {
                            moldFilterValue = formatDate(new Date(moldFilterValue * 1000), 'yyyyMMdd'); //other input value (2023/03/01) => 20230301
                        } else {
                            moldFilterValue = formatDate(new Date(moldFilterValue), 'yyyyMMdd'); //filter cond value (2023/03/01) => 20230301
                        }
                    }
                }
            }
            //Match with timestamp value like 1698332345 = 1698332345 
            else if (["same", "notsame"].includes(operation)) {
                if (fieldValue) moldFieldValue = fieldValue;
                moldFilterValue = getFilterKeyValue(filterValue, operation, body);
            }
            //Match with timestamp value like 1698332345 = 1698332345 
            else {
                if (fieldValue) moldFieldValue = fieldValue;

                if (Array.isArray(filterValue)) {
                    moldFilterValue = [];
                    for (let i = 0; i < filterValue.length; i++) moldFilterValue.push(Math.floor((new Date(filterValue[i]).getTime()) / 1000)); //need to convert to unixtimestamp because it is filter value & its looks like "2023-08-30T03:00:00.000Z"
                }
                else if (filterValue) {
                    moldFilterValue = getFilterKeyValue(filterValue, operation, body);

                    if (moldFilterValue) moldFilterValue = Math.floor((new Date(moldFilterValue).getTime()) / 1000) //need to convert to unixtimestamp because it is filter value & its looks like "2023-08-30T03:00:00.000Z
                }
            }
            break;
        case 6:       //6 = 時間型 (time type)
            // Convert to Int type for comparing integers
            if (fieldValue !== null && fieldValue !== undefined && !isNaN(fieldValue) && fieldValue != '') {
                moldFieldValue = Number.parseInt(fieldValue);
            }

            if (Array.isArray(filterValue)) {
                moldFilterValue = [];
                for (let i = 0; i < filterValue.length; i++) moldFilterValue.push(filterValue[i]);
            }
            else if (filterValue != null && filterValue != undefined) {
                moldFilterValue = getFilterKeyValue(filterValue, operation, body);
            }
            break;
        case 7:        //7 = 数値型 (numeric type)
            //For val = null/undefined value if check val.length, then it will produce wrong result 
            //thats why initilize the variable with empty string.
            if (fieldValue === null || fieldValue === undefined) {
                moldFieldValue = "";
            }
            //if value is number string then convert it into a number for the following operators
            else if (["=", "<>", "<", ">", "<=", ">=", "between"].includes(operation) && !isNaN(parseFloat(fieldValue))) {
                moldFieldValue = Number(fieldValue);
            }
            else {
                moldFieldValue = fieldValue;
            }

            if (Array.isArray(filterValue)) {
                moldFilterValue = [];
                for (let i = 0; i < filterValue.length; i++) moldFilterValue.push(filterValue[i])
            }
            else if (filterValue) {
                moldFilterValue = getFilterKeyValue(filterValue, operation, body);
            }
            break;
    }

    //console.log("moldFilterValue****", moldFilterValue);
    // console.log("moldFieldValue", moldFieldValue);
    return [moldFilterValue, moldFieldValue];
}


function getFilterKeyValue(filterValue, operation, body) {
    let moldFilterValue = filterValue;

    if (["same", "notsame", "samedate", "notsamedate"].includes(operation)) {
        const filterValueKey = filterValue;
        moldFilterValue = body[filterValueKey];

        if (moldFilterValue === undefined) moldFilterValue = body['orgField_' + filterValue];

        if (moldFilterValue === undefined) {
            let getKeyFromMapper = fieldColumnMapper[filterValue];
            if (getKeyFromMapper && getKeyFromMapper.includes(".")) {
                let newFinalKey = getKeyFromMapper.split(".")[1];
                console.log('newFinalKey', newFinalKey);
                moldFilterValue = body[newFinalKey];
            }
        }
    }

    if (moldFilterValue === undefined || moldFilterValue === null) moldFilterValue = '';

    return moldFilterValue;
}

//Function to match between fieldValue & filterValue by operator type
function match(filterValue, fieldValue, operation, fieldFieldType) {
    console.log("operation === ", operation);
    console.log("💓💓💓💓💓💓💓💓💓💓💓💓💓 filterValue ", filterValue);
    console.log("💓💓💓💓💓💓💓💓💓💓💓💓💓 fieldValue ", fieldValue);

    let check = false;
    switch (operation) {
        case "=":
            // ---- is empty
            if (filterValue === null) {
                // list type
                if (fieldValue && Array.isArray(fieldValue)) {
                    if (fieldValue.length === 0) {
                        check = true;
                    }
                    else {
                        const selectedItem = fieldValue.find(x => x.checked);
                        if (!selectedItem) check = true;
                    }
                }
                else {
                    if (fieldValue === '' || fieldValue === undefined || fieldValue.length === 0) {
                        check = true;
                    }
                }
            }
            // boolean type
            else if (typeof filterValue === 'boolean') {
                // boolean === boolean
                if (typeof fieldValue === 'boolean') {
                    if (fieldValue !== "" && fieldValue == filterValue) {
                        check = true;
                    }
                }
                // 以下の配列形式で設定されてくる。idの部分がYesNoの選択値
                // [0]:{id: '0', checked: true}
                else if (fieldValue && Array.isArray(fieldValue)) {
                    // fieldValueの[0]のidとfilterValueの両方数値にキャストして比較する
                    try {
                        if (Number.parseInt(fieldValue[0].id) === Number(filterValue)) {
                            check = true;
                        }
                    } catch {
                        console.log("unexpected type field value");
                    }
                }
                else {
                    // fieldValueが 0, 1 のため両方数値にキャストして比較する
                    if (filterValue === true) filterValue = 1
                    else if (filterValue === false) filterValue = 0

                    try {
                        if (Number.parseInt(fieldValue) === filterValue) {
                            check = true;
                        }
                    } catch {
                        console.log("unexpected type field value");
                    }
                }
            }
            // list type
            else if (fieldValue && Array.isArray(fieldValue)) {
                for (let index = 0; index < fieldValue.length; index++) {
                    const element = fieldValue[index];
                    // ID, VALUE形式 (リスト型チェックボックスなど)
                    if (element.id) {
                        if (element.id == filterValue && element.checked) {
                            check = true;
                            break;
                        }
                    }
                    else {
                        // 配列形式 (択一選択セレクトボックス、booleanセレクトボックス)
                        if (element == filterValue) {
                            check = true;
                            break;
                        }
                    }
                }
            }
            //other types
            else if (fieldValue == filterValue) {
                check = true;
            }
            break;
        case "<>":
            // is not empty
            if (filterValue === null) {
                console.log('true from === nulll');
                // list type
                if (fieldValue && Array.isArray(fieldValue)) {
                    if (fieldValue.length !== 0) {
                        for (let index = 0; index < fieldValue.length; index++) {
                            const element = fieldValue[index];
                            if (element.checked) {
                                check = true;
                                break;
                            }
                        }
                    }
                }
                else {
                    if (fieldValue !== '' && fieldValue !== undefined && fieldValue.length !== 0) {
                        check = true;
                    }
                }
            }
            // boolean type
            else if (typeof filterValue === 'boolean') {
                // boolean === boolean
                if (typeof fieldValue === 'boolean') {
                    if (fieldValue !== "" && fieldValue !== filterValue) {
                        check = true;
                    }
                }
                // 以下の配列形式で設定されてくる。idの部分がYesNoの選択値
                // [0]:{id: '0', checked: true}
                else if (fieldValue && Array.isArray(fieldValue)) {
                    // fieldValueの[0]のidとfilterValueの両方数値にキャストして比較する
                    try {
                        if (Number.parseInt(fieldValue[0].id) !== Number(filterValue)) {
                            check = true;
                        }
                    } catch {
                        console.log("unexpected type field value");
                    }
                }
                else {
                    // fieldValueが 0, 1 のため両方数値にキャストして比較する
                    if (filterValue === true) filterValue = 1
                    else if (filterValue === false) filterValue = 0

                    try {
                        if (Number.parseInt(fieldValue) !== filterValue) {
                            check = true;
                        }
                    } catch {
                        console.log("unexpected type field value");
                    }
                }
            }
            // list type
            else if (fieldValue && Array.isArray(fieldValue)) {
                let tempChecked = false;
                for (let index = 0; index < fieldValue.length; index++) {
                    const element = fieldValue[index];
                    // ID, VALUE形式 (リスト型チェックボックスなど)
                    if (element.id == filterValue && element.checked) {
                        tempChecked = true;
                        break;
                    }
                    else {
                        // 配列形式 (択一選択セレクトボックス、booleanセレクトボックス)
                        if (element == filterValue) {
                            tempChecked = true;
                            break;
                        }
                    }
                }
                if (tempChecked == false) {
                    check = true;
                }
            }
            //other types
            else if (fieldValue != filterValue) {
                check = true;
            }
            break;
        case "<":
            if (fieldValue !== "" && fieldValue < filterValue) {
                check = true;
            }
            break;
        case ">":
            if (fieldValue !== "" && fieldValue > filterValue) {
                check = true;
            }
            break;
        case "<=":
            if (fieldValue !== "" && fieldValue <= filterValue) {
                check = true;
            }
            break;
        case ">=":
            if (fieldValue !== "" && fieldValue >= filterValue) {
                check = true;
            }
            break;
        case "contains":
            if (fieldValue && fieldValue.includes(filterValue)) {
                check = true;
            }
            break;
        case "notcontains":
            if (fieldValue && !fieldValue.includes(filterValue)) {
                check = true;
            }
            else if (!fieldValue) {//user has no record;
                check = true;
            }
            break;
        case "startswith":
            if (fieldValue && fieldValue.startsWith(filterValue)) {
                check = true;
            }
            break;
        case "endswith":
            if (fieldValue && fieldValue.endsWith(filterValue)) {
                check = true;
            }
            break;
        case "between":
            if (fieldValue !== "" && (fieldValue >= filterValue[0] && fieldValue <= filterValue[1])) {
                check = true;
            }
            break;
        case "minlength":
            if (typeof fieldValue !== "string") fieldValue = String(fieldValue);

            if (fieldValue && (fieldValue.length >= filterValue)) {
                check = true;
            }
            break;
        case "maxlength":
            if (typeof fieldValue !== "string") fieldValue = String(fieldValue);

            if (fieldValue && (fieldValue.length <= filterValue)) {
                check = true;
            }
            else if (!fieldValue) {  //In casse of null/undefined it will be true
                check = true;
            }
            break;
        case "same":
            if (fieldValue === filterValue) check = true;
            break;
        case "notsame":
            if (fieldValue !== filterValue) check = true;
            break;
        case "listinclude":
            if (filterValue && fieldValue && Array.isArray(fieldValue)) {
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
                if (fieldValue && Array.isArray(fieldValue)) {
                    for (let j = 0; j < fieldValue.length; j++) {
                        if (filterValue == fieldValue[j].id && fieldValue[j].checked) {
                            check = false;
                            break;
                        }
                    }
                }
            }
            break;
        case "regex":
            if (typeof fieldValue !== "string") fieldValue = String(fieldValue);

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
                // 半角文字列 = Half-width (katakana + alphanumeric + symbols) (According to Haga san)
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
                // 全角文字列 = Full-width (katakana + alphanumeric + symbols) (According to Haga san)
                case "8":
                    if (!fieldValue || fieldValue.match(/^[^\x20-\x7e]*$/)) {
                        check = true
                    }
                    break;
                // 電話番号
                case "9":
                    if (!fieldValue || fieldValue.match(/^0[0-9]{1,4}-[0-9]{2,5}-[0-9]{2,5}$/)) {
                        check = true
                    }
                    break;
                // 郵便番号
                case "10":
                    if (!fieldValue || fieldValue.match(/^[0-9]{3}-[0-9]{4}$/)) {
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
        case "=date":
            // 日付計算
            if (fieldValue && fieldValue == filterValue) {
                check = true;
            }
            break;
        case "<>date":
            // 日付計算
            if (fieldValue && fieldValue != filterValue) {
                check = true;
            } else if (!fieldValue) {
                check = true;
            }
            break;
        case "<date":
            // 日付計算
            if (fieldValue && fieldValue < filterValue) {
                check = true;
            }
            break;
        case ">date":
            // 日付計算
            if (fieldValue && fieldValue > filterValue) {
                check = true;
            }
            break;
        case "<=date":
            // 日付計算
            if (fieldValue && fieldValue <= filterValue) {
                check = true;
            }
            break;
        case ">=date":
            // 日付計算
            if (fieldValue && fieldValue >= filterValue) {
                check = true;
            }
            break;
        case "samedate":
            if (fieldValue === filterValue) check = true;
            break;
        case "notsamedate":
            if (fieldValue !== filterValue) check = true;
            break;

        default: check = false;
    }
    // console.log("💓💓 check ", check);
    return check;
}

function formatDate(date, format) {
    format = format.replace(/yyyy/g, date.getFullYear());
    format = format.replace(/MM/g, ('0' + (date.getMonth() + 1)).slice(-2));
    format = format.replace(/dd/g, ('0' + date.getDate()).slice(-2));
    format = format.replace(/HH/g, ('0' + date.getHours()).slice(-2));
    format = format.replace(/mm/g, ('0' + date.getMinutes()).slice(-2));
    format = format.replace(/ss/g, ('0' + date.getSeconds()).slice(-2));
    format = format.replace(/SSS/g, ('00' + date.getMilliseconds()).slice(-3));
    return format;
};
