/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
*/
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

async function updateFreePages(mysql_con, data, appId) {

    let updateData = [];
    let updateIds = [];
    let newData = [];

    const updatedAt = Math.floor(new Date().getTime() / 1000);
    if (data.length != 0) {
        data.forEach((page) => {
            page.blocks = { "records": page.blocks.length > 0 ? page.blocks : [] }
            if (typeof page.appPageId !== 'undefined') {
                // this means we need to update the existing record and not create a new one.
                const aux = [
                    page.appPageOrderNo,
                    page.appPageManagerName,
                    page.appPageURLName,
                    page.appPageTitle,
                    page.appPageDescription,
                    page.appPageRootFlag,
                    page.appPageStepType,
                    page.appPageStepValue,
                    page.appPageAuthFlag,
                    JSON.stringify(page.appPageTransitionSource),
                    page.appPageCustomClass,
                    JSON.stringify(page.blocks),
                    page.appPageLoadingFlag,
                    JSON.stringify(page.appPageLoadingStopFlag),
                    page.updatedBy
                ];
                updateData.push(aux);
                updateIds.push(page.appPageId);
            }
            else {
                // We need to create new record
                const aux = [
                    appId,
                    page.appPageOrderNo,
                    page.appPageManagerName,
                    page.appPageURLName,
                    page.appPageTitle,
                    page.appPageDescription,
                    page.appPageRootFlag,
                    page.appPageStepType,
                    page.appPageStepValue,
                    page.appPageAuthFlag,
                    JSON.stringify(page.appPageTransitionSource),
                    page.appPageCustomClass,
                    JSON.stringify(page.blocks),
                    0,
                    page.appPageLoadingFlag,
                    JSON.stringify(page.appPageLoadingStopFlag),
                    page.updatedBy,
                    page.updatedBy,
                    updatedAt,
                    updatedAt
                ];
                newData.push(aux);
            }
        });
        // console.log("updateData");
        // console.log(updateData);
        // console.log("newData");
        // console.log(newData);
        // console.log(updateData.length)
        if (updateIds.length > 0) {
            let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageId NOT IN (?) AND appPageTypeFlag = 0`;
            await mysql_con.query(delete_sql, [appId, updateIds]);
        }
        else {
            let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageTypeFlag = 0`;
            await mysql_con.query(delete_sql, [appId]);
        }
        try {
            console.log("updateData", updateData);
            if (newData.length > 0) {
                let new_sql = `INSERT INTO AppPage ( 
                    appId,
                    appPageOrderNo, 
                    appPageManagerName, 
                    appPageURLName, 
                    appPageTitle, 
                    appPageDescription,
                    appPageRootFlag,
                    appPageStepType,
                    appPageStepValue,
                    appPageAuthFlag,
                    appPageTransitionSource,
                    appPageCustomClass,
                    appPageBlock,
                    appPageTypeFlag,
                    appPageLoadingFlag,
                    appPageLoadingStopFlag,
                    createdBy,
                    updatedBy,
                    createdAt,
                    updatedAt
                    ) 
                VALUES ?`;
                await mysql_con.query(new_sql, [newData]);
            }

            if (updateData.length > 0) {
                for (let i = 0; i < updateData.length; ++i) {
                    let new_sql = `UPDATE AppPage
                            SET 
                            appPageOrderNo = ?, 
                            appPageManagerName = ?, 
                            appPageURLName = ?, 
                            appPageTitle = ?, 
                            appPageDescription = ?,
                            appPageRootFlag = ?,
                            appPageStepType = ?,
                            appPageStepValue = ?,
                            appPageAuthFlag = ?,
                            appPageTransitionSource = ?,
                            appPageCustomClass = ?,
                            appPageBlock = ?,
                            appPageLoadingFlag = ?,
                            appPageLoadingStopFlag = ?,
                            updatedBy = ?,
                            updatedAt = ${updatedAt}
                        WHERE appPageId = ${updateIds[i]}`;
                    // console.log(new_sql);
                    var result = await mysql_con.query(new_sql, [...updateData[i]]);
                    // console.log([...updateData[i], updatedAt])
                    // console.log("result");
                    // console.log(result);
                }

            }

        }
        catch (e) {
            console.log(e)
        }
    }
    else {
        // 0件だった場合全て削除する
        try {
            let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageTypeFlag = 0`;
            await mysql_con.query(delete_sql, [appId]);
        }
        catch (e) {
            console.log(e)
        }
    }
}

async function updateCommonPages(mysql_con, data, appId) {
    
    let updateData = [];
    let updateIds = [];
    let newData = [];
    
    const updatedAt = Math.floor(new Date().getTime() / 1000);
    
    data.forEach((page) => {
        page.blocks = { "records": page.blocks.length > 0 ? page.blocks : [] }
        if (typeof page.appCommonPageId !== 'undefined') {
            // this means we need to update the existing record and not create a new one
// console.log("page", page);
            const aux = [    
                    page.appCommonPageSubId, 
                    page.appCommonPageManagerName, 
                    page.appCommonPageURLName, 
                    page.appCommonPageTitle, 
                    page.appCommonPageDescription,
                    JSON.stringify(page.blocks),
                    page.appCommonPageCustomClass,
                    page.appPageLoadingFlag,
                    JSON.stringify(page.appPageLoadingStopFlag),
                    page.updatedBy
                ];
// console.log("AUX", aux);
            updateData.push(aux);
            updateIds.push(page.appCommonPageId);
        }
        else {
            // We need to create new record
            const aux = [    
                    appId,
                    page.appCommonPageSubId, 
                    page.appCommonPageManagerName, 
                    page.appCommonPageURLName, 
                    page.appCommonPageTitle, 
                    page.appCommonPageDescription,
                    JSON.stringify(page.blocks),
                    page.appCommonPageCustomClass,
                    1,
                    page.appPageLoadingFlag,
                    JSON.stringify(page.appPageLoadingStopFlag),
                    page.updatedBy,
                    page.updatedBy,
                    updatedAt,
                    updatedAt
                ];
            newData.push(aux);
        }
    });
    // console.log("updateData");
    // console.log(updateData);
    // console.log("newData");
    // console.log(newData);
    // console.log(updateData.length)
    if (updateIds.length > 0) {
    let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageId NOT IN (?) AND appPageTypeFlag = 1`;
        await mysql_con.query(delete_sql, [appId, updateIds]);
    }
    
    try {
    
        if (newData.length > 0) {
            let new_sql = `INSERT INTO AppPage ( 
                        appId,
                        appPageOrderNo, 
                        appPageManagerName, 
                        appPageURLName, 
                        appPageTitle, 
                        appPageDescription,
                        appPageBlock,
                        appPageCustomClass,
                        appPageTypeFlag,
                        appPageLoadingFlag,
                        appPageLoadingStopFlag,
                        createdBy,
                        updatedBy,
                        createdAt,
                        updatedAt
                        ) 
                    VALUES ?`;
            await mysql_con.query(new_sql, [newData]);
        }
        
        if (updateData.length > 0) {
            for (let i = 0; i < updateData.length; ++i) {
                let new_sql = `UPDATE AppPage
                        SET 
                        appPageOrderNo = ?, 
                        appPageManagerName = ?, 
                        appPageURLName = ?, 
                        appPageTitle = ?, 
                        appPageDescription = ?,
                        appPageBlock = ?,
                        appPageCustomClass = ?,
                        appPageTypeFlag = 1,
                        appPageLoadingFlag = ?,
                        appPageLoadingStopFlag = ?,
                        updatedBy = ?,
                        updatedAt = ${updatedAt}
                        
                    WHERE appPageId = ${updateIds[i]}`;
console.log("updateData[i]", updateData[i]);
console.log("...updateData[i]", ...updateData[i]);
                var result = await mysql_con.query(new_sql, [...updateData[i]]);
                // console.log([...updateData[i], updatedAt])
                // console.log("result");
                // console.log(result);
            }
        }
    }
    catch (e) {
    console.log(e)
    }
}

async function updateSettings(mysql_con, data, appId) {
    
    const updatedAt = Math.floor(new Date().getTime() / 1000);
    console.log("updateSettings");
    console.log(data);
    console.log(appId);
    try {
        if (data) {
            let insertSql = `INSERT IGNORE INTO AppSetting (appId, appSettingQuery, createdAt, createdBy, updatedAt, updatedBy)
                                                    VALUES (?, ?, ?, ?, ?, ?);`
            var resultInsert = await mysql_con.query(insertSql, [appId, JSON.stringify(data), updatedAt, data.updatedBy, updatedAt, data.updatedBy]);
            let new_sql = `UPDATE AppSetting
                        SET 
                        appSettingQuery = ?, 
                        updatedBy = ?,
                        updatedAt = ?
                    WHERE appId = ?`;
            console.log(new_sql);
            console.log([JSON.stringify(data), data.updatedBy, updatedAt, appId]);
            var result = await mysql_con.query(new_sql, [JSON.stringify(data), data.updatedBy, updatedAt, appId]);
            
        }
    }
    catch (e) {
    console.log(e)
    }
}

async function updateBlockHistory(mysql_con, blocks, histories, appId) {
    const updatedAt = Math.floor(new Date().getTime() / 1000);
    console.log("updateBlockHistory");
    console.log("blocks", blocks);
    console.log("histories", histories);
    console.log(appId);
    try {
        let blockData = (blocks) ? blocks : [];
        let historyData = (histories) ? histories : [];
        // updatedByが来ていない
        let new_sql = `UPDATE App
                    SET 
                    appDesignBlocks = ?, 
                    appDesignHistories = ?, 
                    updatedAt = ?
                WHERE appId = ?`;
        console.log(new_sql);
        console.log([JSON.stringify(blockData), JSON.stringify(historyData), updatedAt, appId]);
        var result = await mysql_con.query(new_sql, [JSON.stringify(blockData), JSON.stringify(historyData), updatedAt, appId]);
    }
    catch (e) {
        console.log(e)
    }
}

async function createAppHistory(mysql_con, appData, appId, logAccountId) {
    const updatedAt = Math.floor(new Date().getTime() / 1000);
    try {
        let selectVersion = `SELECT MAX(appHistoriesVersion) + 1 AS version FROM AppHistories WHERE appId = ?`
        var [cntData] = await mysql_con.query(selectVersion, [appId]);
        let versions = 1;
        if (cntData[0].version != null && cntData[0].version >= 1) {
            versions = cntData[0].version
        }
        // updatedByが来ていない
        let new_sql = `INSERT INTO AppHistories(appId, appHistoriesVersion, appHistoriesJsonData, createdAt, createdBy, updatedAt, updatedBy) VALUES(?, ?, ?, ?, ?, ?, ?)`;
        var result = await mysql_con.query(new_sql, [
            appId,
            versions,
            JSON.stringify(appData),
            updatedAt,
            logAccountId,
            updatedAt,
            logAccountId
        ]);
    }
    catch (e) {
        console.log(e)
    }
}


/**
* ManagerAppEditorUpdate.
* 
* @param {*} event 
* @returns {json} response
*/
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logData = [];
    let logAccountId;
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'DBINFO_' + process.env.ENV,
            WithDecryption: true,
        };
        const ssmparam = await ssm.getParameter(ssmreq).promise();
        const dbinfo = JSON.parse(ssmparam.Parameter.Value);
        process.env.DBWRITEENDPOINT = dbinfo.DBWRITEENDPOINT;
        process.env.DBREADENDPOINT = dbinfo.DBREADENDPOINT;
        process.env.DBUSER = dbinfo.DBUSER;
        process.env.DBPASSWORD = dbinfo.DBPASSWORD;
        process.env.DBDATABSE = dbinfo.DBDATABSE;
        process.env.DBPORT = dbinfo.DBPORT;
        process.env.DBCHARSET = dbinfo.DBCHARSET;
        process.env.DBINFO = true;
    }

    // Database info
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };

    if (event.pathParameters?.appId) {
        let appId = event.pathParameters.appId;
        console.log("appId:", appId);
        const appData = JSON.parse(event.body);
        console.log("appData");
        console.log(appData);

        logAccountId = event.requestContext.authorizer.accountId;
        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);

            let appQuery = `SELECT eventId, appName FROM App WHERE appId = ?`;
            const [appQueryResult] = await mysql_con.query(appQuery, [appId]);

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベントID";
            logData[0].beforeValue = appQueryResult[0].eventId;
            logData[0].afterValue = appQueryResult[0].eventId;
            logData[1] = {};
            logData[1].fieldName = "APP名";
            logData[1].beforeValue = appQueryResult[0].appName;
            logData[1].afterValue = appQueryResult[0].appName;

            // if (typeof appData.freePages !== 'undefined' && appData.freePages.length > 0){
            console.log(" appData", appData);
            console.log(" appData.freePages", appData.freePages);
            console.log(" appData.commonPages", appData.commonPages);
            // 自由ページの更新
            await updateFreePages(mysql_con, appData.freePages, appId);
            // }

            // 共通ページの更新
            if (typeof appData.commonPages !== 'undefined' && appData.commonPages.length > 0) {
                await updateCommonPages(mysql_con, appData.commonPages, appId);
            }

            // 設定部分の更新
            if (typeof appData.settings !== 'undefined' && appData.settings) {
                await updateSettings(mysql_con, appData.settings, appId);
            }

            // ブロック一覧と履歴情報の更新
            await updateBlockHistory(mysql_con, appData.blocks, appData.histories, appId);

            await createAppHistory(mysql_con, appData, appId, logAccountId);

            var response = "Success";
            console.log("response:", response);
            mysql_con.commit();
            // success log
            await createLog(context, 'APPデザイナー', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: response,
            };
        } catch (error) {
            mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'APPデザイナー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(error),
            };
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    } else {
        // failure log
        await createLog(context, 'APPデザイナー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({
                "message": "invalid parameter"
            }),
        };
    }
};
async function createLog(context, _target, _type, _result, _code, ipAddress, accountId, logData = null) {
    let params = {
        FunctionName: "createLog-" + process.env.ENV,
        InvocationType: "Event",
        Payload: JSON.stringify({
            logGroupName: context.logGroupName,
            logStreamName: context.logStreamName,
            _target: _target,
            _type: _type,
            _result: _result,
            _code: _code,
            ipAddress: ipAddress,
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}
