/**
* A Lambda function that returns a static string
*/
const jwt = require('jsonwebtoken')
const ACCESS_TOKEN_SECRET = 'dDhKtAsk9PJZ2BkS5eZwQRQ'
const REFRESH_TOKEN_SECRET = 'AL4FJ4A29df0ao4af8aas3fsf8'
const jwtPattern = /^Bearer[ ]+([^ ]+)[ ]*$/i;

exports.handler = function(event, context, callback) {
    // console.log(event);
    var token = jwtPattern.exec(event.authorizationToken)[1];
    // console.log("token", token);
    // console.log("arn", event.methodArn);
    // console.log("context", context);
    

    // callback(null, generatePolicy('user', 'Allow', event.methodArn));
    let value;
    jwt.verify(token, ACCESS_TOKEN_SECRET, function(err, decoded) {
// console.log("decoded", decoded) // bar
        if (decoded != null) {
    // console.log("err", err) // bar
            let authrole = [];
            for (let i = 0; i < decoded.auth.length; i++) {
                authrole[i] = decoded.auth.charAt(i)
            }
            if (decoded.rid == null) {
                callback("rid is null");
            }
    // console.log("authrole", authrole);        
            if (err) {
                // value = generatePolicy('user', 'Deny', event.methodArn)
                // console.log("value1", value);
                callback(null, value);
            }
            else if (decoded?.accountId) {
                let methodArn = event.methodArn.split(':')
                // console.log("methodArn", methodArn);
                if (methodArn[5]) {
                    let pathArray = methodArn[5].split("/");
    // console.log("pathArray", pathArray);
                    let method;
                    let path = '';
                    let pathFlag = false;
                    for (let i = 0; i < pathArray.length; i++) {
                        if (pathArray[i] == 'GET' || pathArray[i] == 'POST' || pathArray[i] == 'PUT' || pathArray[i] == 'DELETE') {
                            method = pathArray[i];
                            pathFlag = true
                        }
                        else {
                            if (pathFlag == true) {
                                path = path + "/" + pathArray[i];
                            }
                        }
                    }
    // console.log("method", method);
                    let aListType = (path.slice(-1) == "/") ? true: false
                    let path2;
                    if (!aListType) {
                        path2 = path.slice(0, path.lastIndexOf("/")) + "/"
                    }
                    else {
                        path2 = path
                    }
                    
// console.log("path　='" + path + "'");
// console.log("a1 = ", path.slice(path.lastIndexOf("/"), path.length - path.lastIndexOf("/")));
// console.log("a2 = ", path.slice(path.lastIndexOf("/"), (path.length - path.lastIndexOf("/")) * -1 ));
// console.log("b = ", path.lastIndexOf("/"));
// console.log("c = ", path.length);
// console.log("d = ", path.length - path.lastIndexOf("/"));
                    let queryParam = (path.slice(path.lastIndexOf("/") + 1, path.length)) ? path.slice(path.lastIndexOf("/") + 1, path.length): ""
                    let rFlag = checkRoleAuthorization(decoded.accountId, authrole, decoded.rpid, decoded.reid, decoded.riid, path2, method, aListType, queryParam);
console.log("rFlag", rFlag);
                    if (rFlag) {
                        console.log("user allow");
                        value = generatePolicy('user', 'Allow', event.methodArn)
                        console.log("value", value);
                        value.context.accountId = decoded.accountId
                        value.context.rid = (decoded.rid != null)? JSON.stringify(decoded.rid): null
                        value.context.pid = (decoded.rpid != null)? JSON.stringify(decoded.rpid): null
                        value.context.eid = (decoded.reid != null)? JSON.stringify(decoded.reid): null
                        value.context.iid = (decoded.riid != null)? JSON.stringify(decoded.riid): null
                        value.context.authRole = decoded.auth
                        console.log(value.context);
                        // value.context = {
                        //     "accountId": decoded.accountId,
                        //     "pid": decoded.rpid,
                        //     "eid": decoded.reid,
                        //     "iid": decoded.riid
                        // };
                        console.log("value2", value);
                        callback(null, value);
                    } 
                    else {
                        console.log("user deny", decoded?.accountId);
                        callback(null, generatePolicy('user', 'Deny', event.methodArn));
                    }

                }
                else {
                    callback("Unauthorized");
                }
            }
            else {
                callback("Unauthorized");
            }            
        }
        else {
            callback("Unauthorized");
        }            
    });
// callback("Unauthorized");   // Return a 401 Unauthorized response
// callback(null, generatePolicy('user', 'Deny', event.methodArn));
// callback(null, generatePolicy('user', 'Allow', event.methodArn));


/*
switch (token) {
case 'allow':
callback(null, generatePolicy('user', 'Allow', event.methodArn));
break;
case 'deny':
callback(null, generatePolicy('user', 'Deny', event.methodArn));
break;
case 'unauthorized':
callback("Unauthorized");   // Return a 401 Unauthorized response
break;
default:
callback("Error: Invalid token"); // Return a 500 Invalid token response
}
*/
};
/*
    authRole

    0 === システム管理（ドメイン管理・アカウント設定・権限ロール設定・プロジェクト管理） 1 = 全権
    1 === システム管理（ログ） 1 = 全権
    2 === APP管理 1 = 全権
    3 === イベント管理 2. 閲覧のみ, 1 = 全権
    4 === イベントスケジューラー 2. 閲覧のみ 1 = 全権
    5 === スロット 2. 閲覧のみ 1 = 全権
    6 === データ管理 1 = 全権
    7 === 顧客情報閲覧 2. 部分閲覧 1 = 全権
    8 === 顧客情報管理 2. 編集 1 = 全権
    9 === CSVエクスポート 2. 閲覧とダウンロードのみ 1 = 全権
    10 === CSVインポート 2. 閲覧とダウンロードのみ 1 = 全権

*/



const checkRoleAuthorization = (accountId, authrole, rpid, reid, riid, path, method, aListType, queryParam) => {
    // console.log("path", path);
    // console.log("method", method);
    // console.log("aListType", aListType); // true == 最後尾がスラッシュ
    // console.log("queryParam", queryParam);
    let rFlag = false;
    // pathとメソッドを元に分岐処理（複雑なためif文で実行）
    // aListType true = パラメーターなし false = パラメーターあり
    // アカウント
    if (path == "/manager/account/" && method == "GET" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/account/" && method == "GET" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/account/" && method == "POST" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/account/" && method == "PUT" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/account/" && method == "DELETE" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    // ロール
    } else if (path == "/manager/role/" && method == "GET" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/role/" && method == "GET" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/role/" && method == "POST" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/role/" && method == "PUT" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/role/" && method == "DELETE" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    // ドメイン
    } else if (path == "/manager/domain/" && method == "GET" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/domain/" && method == "GET" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/domain/" && method == "POST" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/domain/" && method == "PUT" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/domain/" && method == "DELETE" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    // プロジェクト
    // プロジェクトの中で制御する
    // } else if (path == "/manager/project/" && method == "GET" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    // } else if (path == "/manager/project/" && method == "GET" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/project/" && method == "GET" && aListType == true) { rFlag = true
    } else if (path == "/manager/project/" && method == "GET" && aListType == false) { rFlag = true
    } else if (path == "/manager/project/" && method == "POST" && aListType == true) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/project/" && method == "POST" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/project/" && method == "PUT" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    } else if (path == "/manager/project/" && method == "DELETE" && aListType == false) { rFlag = (authrole[0] == "1")? true: false
    // プロジェクトデータ
    } else if (path == "/manager/project/data/" && method == "GET" && aListType == false) { rFlag = (authrole[6] >= "1")? true: false
    // イベント
    } else if (path == "/manager/event/" && method == "GET" && aListType == true) { rFlag = (authrole[3] >= "1")? true: false
    } else if (path == "/manager/event/" && method == "GET" && aListType == false) { rFlag = (authrole[3] == "1")? true: false
    } else if (path == "/manager/event/" && method == "POST" && aListType == true) { rFlag = (authrole[3] == "1")? true: false
    } else if (path == "/manager/event/" && method == "POST" && aListType == false) { rFlag = (authrole[3] == "1")? true: false
    } else if (path == "/manager/event/" && method == "PUT" && aListType == false) { rFlag = (authrole[3] == "1")? true: false
    } else if (path == "/manager/event/" && method == "DELETE" && aListType == false) { rFlag = (authrole[3] == "1")? true: false
    // イベントカテゴリー
    } else if (path == "/manager/event/category/" && method == "GET" && aListType == true) { rFlag = (authrole[4] >= "1")? true: false
    } else if (path == "/manager/event/category/" && method == "GET" && aListType == false) { rFlag = (authrole[4] >= "1")? true: false
    } else if (path == "/manager/event/category/" && method == "POST" && aListType == true) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/category/" && method == "PUT" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/category/" && method == "DELETE" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    // イベント施設
    } else if (path == "/manager/event/institute/" && method == "GET" && aListType == true) { rFlag = (authrole[4] >= "1")? true: false
    } else if (path == "/manager/event/institute/" && method == "GET" && aListType == false) { rFlag = (authrole[4] >= "1")? true: false
    } else if (path == "/manager/event/institute/" && method == "POST" && aListType == true) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/institute/" && method == "PUT" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/institute/" && method == "DELETE" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    // イベントアイテム
    } else if (path == "/manager/event/item/" && method == "GET" && aListType == true) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/item/" && method == "GET" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/item/" && method == "PUT" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    // イベントスロットテンプレート
    } else if (path == "/manager/event/slot/template/" && method == "GET" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/slot/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    // イベントカレンダー
    } else if (path == "/manager/event/institute/calendar/" && method == "GET" && aListType == true) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/institute/calendar/" && method == "GET" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    } else if (path == "/manager/event/institute/calendar/" && method == "PUT" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    // イベントデータ
    } else if (path == "/manager/event/mapping/" && method == "GET" && aListType == false) { rFlag = (authrole[4] >= "1")? true: false
    // イベントマッピングスロット
    } else if (path == "/manager/event/mapping/slot/" && method == "GET" && aListType == false) { rFlag = (authrole[5] >= "1")? true: false
    } else if (path == "/manager/event/mapping/slot/" && method == "PUT" && aListType == false) { rFlag = (authrole[5] == "1")? true: false
    // } else if (path == "/manager/event/mapping/slot/download/" && method == "GET" && aListType == false) { rFlag = (authrole[5] >= "1")? true: false
    // イベントバス
    } else if (path == "/manager/event/bus/" && method == "GET" && aListType == false) { rFlag = (authrole[4] >= "1")? true: false
    } else if (path == "/manager/event/bus/" && method == "PUT" && aListType == false) { rFlag = (authrole[4] == "1")? true: false
    // APP
    } else if (path == "/manager/app/" && method == "GET" && aListType == true) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/" && method == "GET" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/" && method == "POST" && aListType == true) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/" && method == "PUT" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/" && method == "DELETE" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/base/" && method == "GET" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/history/" && method == "GET" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/history/" && method == "PUT" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    // 予約カテゴリー
    } else if (path == "/manager/category/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/category/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/category/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/category/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/category/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // 施設
    } else if (path == "/manager/institute/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/institute/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/institute/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/institute/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/institute/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // アイテム
    } else if (path == "/manager/item/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/item/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/item/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/item/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/item/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // カウンセラー
    } else if (path == "/manager/counselor/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/counselor/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/counselor/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/counselor/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/counselor/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // バス路線
    } else if (path == "/manager/bus/route/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/bus/route/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/route/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/route/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/route/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // バス停
    } else if (path == "/manager/bus/stop/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/bus/stop/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/stop/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/stop/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/stop/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // バス便
    } else if (path == "/manager/bus/way/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/bus/way/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/way/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/way/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/bus/way/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // フィルター
    } else if (path == "/manager/filter/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/filter/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/filter/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/filter/" && method == "POST" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/filter/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/filter/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // フィールド
    } else if (path == "/manager/field/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/field/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/field/" && method == "POST" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/field/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/field/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/field/query/" && method == "GET" && aListType == true) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/field/query/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // 顧客
    } else if (path == "/manager/customer/" && method == "GET" && aListType == true) { rFlag = (authrole[7] >= "1")? true: false
    } else if (path == "/manager/customer/" && method == "GET" && aListType == false) { rFlag = (authrole[8] >= "1")? true: false
    } else if (path == "/manager/customer/" && method == "POST" && aListType == true) { rFlag = (authrole[8] == "1")? true: false
       // 顧客ビュー
    } else if (path == "/manager/customer/view/" && method == "GET" && aListType == true) { rFlag = (authrole[7] >= "1")? true: false
    // } else if (path == "/manager/customer/view/" && method == "GET" && aListType == false) { rFlag = (authrole[8] >= "1")? true: false
    // } else if (path == "/manager/customer/view/" && method == "POST" && aListType == true) { rFlag = (authrole[8] == "1")? true: false
    // 顧客テンプレート
    } else if (path == "/manager/customer/template/" && method == "GET" && aListType == true) { rFlag = (authrole[8] >= "1")? true: false
    } else if (path == "/manager/customer/template/" && method == "PUT" && aListType == true) { rFlag = (authrole[8] >= "1")? true: false
    // 顧客ビューテンプレート
    } else if (path == "/manager/customer/view/template/" && method == "GET" && aListType == true) { rFlag = true
    } else if (path == "/manager/customer/view/template/" && method == "GET" && aListType == false) { rFlag = true
    } else if (path == "/manager/customer/view/template/" && method == "POST" && aListType == true) { rFlag = (authrole[8] == "1")? true: false
    } else if (path == "/manager/customer/view/template/" && method == "POST" && aListType == false) { rFlag = (authrole[8] == "1")? true: false
    } else if (path == "/manager/customer/view/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[8] == "1")? true: false
    } else if (path == "/manager/customer/view/template/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // 顧客エディット　
    } else if (path == "/manager/customer/edit/" && method == "POST" && aListType == true) { rFlag = (authrole[8] >= "1")? true: false
    } else if (path == "/manager/customer/edit/" && method == "PUT" && aListType == false) { rFlag = (authrole[8] >= "1")? true: false
    // 顧客エディットテンプレート
    } else if (path == "/manager/customer/edit/template/" && method == "GET" && aListType == true) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/customer/edit/template/" && method == "GET" && aListType == false) { rFlag = (authrole[6] >= "1")? true: false
    } else if (path == "/manager/customer/edit/template/" && method == "POST" && aListType == true) { rFlag = (authrole[8] == "1")? true: false
    } else if (path == "/manager/customer/edit/template/" && method == "PUT" && aListType == true) { rFlag = (authrole[8] == "1")? true: false
    } else if (path == "/manager/customer/edit/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[8] == "1")? true: false
    } else if (path == "/manager/customer/edit/template/" && method == "DELETE" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // EMAIL
    } else if (path == "/manager/email/template/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/email/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // SMS
    } else if (path == "/manager/sms/template/" && method == "GET" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    } else if (path == "/manager/sms/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[6] == "1")? true: false
    // CSV Export
    } else if (path == "/manager/csv/export/" && method == "GET" && aListType == true) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/" && method == "GET" && aListType == false) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/" && method == "DELETE" && aListType == false) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/download/" && method == "GET" && aListType == false) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/download/" && method == "DELETE" && aListType == false) { rFlag = (authrole[9] == "1")? true: false // 必要か？
    // CSV Export Template
    } else if (path == "/manager/csv/export/template/" && method == "GET" && aListType == true) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/template/" && method == "GET" && aListType == false) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/template/" && method == "POST" && aListType == true) { rFlag = (authrole[9] == "1")? true: false
    } else if (path == "/manager/csv/export/template/" && method == "POST" && aListType == false) { rFlag = (authrole[9] == "1")? true: false
    } else if (path == "/manager/csv/export/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[9] == "1")? true: false
    } else if (path == "/manager/csv/export/template/" && method == "DELETE" && aListType == false) { rFlag = (authrole[9] == "1")? true: false
    } else if (path == "/manager/csv/export/template/generate/" && method == "POST" && aListType == false) { rFlag = (authrole[9] >= "1")? true: false
    } else if (path == "/manager/csv/export/" && method == "POST" && aListType == false) { rFlag = (authrole[9] == "1")? true: false
    // CSV Import
    } else if (path == "/manager/csv/import/" && method == "GET" && aListType == true) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/" && method == "GET" && aListType == false) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/" && method == "DELETE" && aListType == false) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/exec/" && method == "POST" && aListType == false) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/upload/" && method == "POST" && aListType == true) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/preview/" && method == "GET" && aListType == false) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/download/" && method == "GET" && aListType == false) { rFlag = (authrole[10] >= "1")? true: false
    } else if (path == "/manager/csv/import/template/download/" && method == "GET" && aListType == false) { rFlag = (authrole[10] >= "1")? true: false
    // CSV Import Template
    } else if (path == "/manager/csv/import/template/" && method == "GET" && aListType == true) { rFlag = (authrole[10] == "1")? true: false
    } else if (path == "/manager/csv/import/template/" && method == "GET" && aListType == false) { rFlag = (authrole[10] == "1")? true: false
    } else if (path == "/manager/csv/import/template/" && method == "POST" && aListType == true) { rFlag = (authrole[10] == "1")? true: false
    } else if (path == "/manager/csv/import/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[10] == "1")? true: false
    } else if (path == "/manager/csv/import/template/" && method == "DELETE" && aListType == false) { rFlag = (authrole[10] == "1")? true: false
    // Broadcast
    } else if (path == "/manager/broadcast/" && method == "GET" && aListType == true) { rFlag = (authrole[11] == "1")? true: false
    } else if (path == "/manager/broadcast/" && method == "GET" && aListType == false) { rFlag = (authrole[11] == "1")? true: false
    } else if (path == "/manager/broadcast/" && method == "PUT" && aListType == false) { rFlag = (authrole[11] == "1")? true: false
    } else if (path == "/manager/broadcast/" && method == "DELETE" && aListType == false) { rFlag = (authrole[11] == "1")? true: false
    } else if (path == "/manager/broadcast/user/" && method == "POST" && aListType == true) { rFlag = (authrole[11] == "1")? true: false
    } else if (path == "/manager/broadcast/template/" && method == "GET" && aListType == false) { rFlag = (authrole[11] == "1")? true: false
    } else if (path == "/manager/broadcast/template/" && method == "PUT" && aListType == false) { rFlag = (authrole[11] == "1")? true: false
    // APPデザイナー
    } else if (path == "/manager/app/editor/" && method == "GET" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/editor/" && method == "PUT" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/editor/" && method == "POST" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/editor/deploy/" && method == "PUT" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    } else if (path == "/manager/app/editor/deployecs/" && method == "PUT" && aListType == false) { rFlag = (authrole[2] == "1")? true: false
    // examination
    } else if (path == "/manager/examination/" && method == "DELETE" && aListType == false) { rFlag = (authrole[8] >= "1")? true: false
    // メール
    } else if (path == "/sender/email/" && method == "POST") { rFlag = true
    } else if (path == "/sender/sms/" && method == "POST") { rFlag = true
    // ファイルアップロード
    } else if (path == "/manager/file/upload/s3/" && method == "POST") { rFlag = true
    }
    // console.log("accountId", accountId);
    console.log("authrole", authrole);
    console.log("accountId = " + accountId + " : path = " + path + " : method = " + method + " : aListType = " + aListType + " : queryParam = " + queryParam + " : rFlag = " + rFlag);
    return rFlag;
    // return true;
};

// Help function to generate an IAM policy
var generatePolicy = function(principalId, effect, resource) {
    var authResponse = {};
    authResponse.principalId = principalId;
    if (effect && resource) {
        var policyDocument = {};
        policyDocument.Version = '2012-10-17'; 
        policyDocument.Statement = [];
        var statementOne = {};
        statementOne.Action = 'execute-api:Invoke'; 
        statementOne.Effect = effect;
        statementOne.Resource = resource;
        policyDocument.Statement[0] = statementOne;
        authResponse.policyDocument = policyDocument;
    }
    // Optional output with custom properties of the String, Number or Boolean type.
    authResponse.context = {
        // "stringKey": "stringval",
        // "numberKey": 123,
        // "booleanKey": true
    };
    return authResponse;
}
