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
                page.updatedBy,
                page.updatedBy,
                updatedAt,
                updatedAt
            ];
            newData.push(aux);
        });
        let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageTypeFlag = 0`;
        await mysql_con.query(delete_sql, [appId]);
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
                    createdBy,
                    updatedBy,
                    createdAt,
                    updatedAt
                    ) 
                VALUES ?`;
                let query_result = await mysql_con.query(new_sql, [newData]);
                if (query_result.affectedRows == 0) {
                    console.log("INSERT AppPage Error1");
                    await mysql_con.rollback();
                    // failure log
                    await createLog(context, 'APPデザイナー', 'コピー', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                    return {
                        statusCode: 400,
                        headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Headers": "*",
                        },
                        body: JSON.stringify({
                            message: "Not found",
                            errorCode: 201
                        }),
                    };
                }
            }
        }
        catch (e) {
            throw new Exception(e);
        }
    }
    else {
        // 0件だった場合全て削除する
        try {
            let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageTypeFlag = 0`;
            await mysql_con.query(delete_sql, [appId]);
        }
        catch (e) {
            throw new Exception(e);
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
            page.updatedBy,
            page.updatedBy,
            updatedAt,
            updatedAt
        ];
        newData.push(aux);

    });

    let delete_sql = `DELETE FROM AppPage WHERE appId = ? AND appPageTypeFlag = 1`;
    await mysql_con.query(delete_sql, [appId]);


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
                        createdBy,
                        updatedBy,
                        createdAt,
                        updatedAt
                        ) 
                    VALUES ?`;
            let query_result = await mysql_con.query(new_sql, [newData]);
            if (query_result.affectedRows == 0) {
                console.log("INSERT AppPage Error2");
                await mysql_con.rollback();
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Not found",
                        errorCode: 201
                    }),
                };
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

async function updateBlockHistory(mysql_con, blocks, histories, appId, updatedBy) {
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
                    updatedBy = ?,
                    updatedAt = ?
                WHERE appId = ?`;
        console.log(new_sql);
        console.log([JSON.stringify(blockData), JSON.stringify(historyData), updatedBy, updatedBy, updatedAt, appId]);
        var result = await mysql_con.execute(new_sql, [JSON.stringify(blockData), JSON.stringify(historyData), updatedBy, updatedAt, appId]);
        if (result.affectedRows == 0) {
            console.log("UPDATE App Error");
            await mysql_con.rollback();
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "Not found",
                    errorCode: 201
                }),
            };
        }
    }
    catch (e) {
        console.log(e)
    }
}

//get aapprecords
// Get one record by primary key
async function getFromAppData(mysql_con, appId) {
    // Expand GET parameters
    let parameter = [];
    // get one record sql
    const free_pages_sql_data = `SELECT DISTINCT 
                                    appPageId, 
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
                                    appPageBlock AS blocks,
                                    memo,  
                                    updatedBy
                                FROM AppPage
                                WHERE appId = ? AND appPageTypeFlag = 0
                                ORDER BY appPageOrderNo;`;

    const common_pages_sql_data = `SELECT DISTINCT 
                                    appPageId AS appCommonPageId, 
                                    appPageOrderNo AS appCommonPageSubId,
                                    appId,
                                    appPageManagerName AS appCommonPageManagerName, 
                                    appPageURLName AS appCommonPageURLName, 
                                    appPageTitle AS appCommonPageTitle, 
                                    appPageDescription AS appCommonPageDescription, 
                                    appPageCustomClass AS appCommonPageCustomClass,
                                    updatedBy,
                                    appPageBlock AS blocks
                                FROM AppPage
                                WHERE appId = ? AND appPageTypeFlag = 1
                                ORDER BY appPageId;`;

    // const common_pages_sql_data = `SELECT *
    // FROM AppCommonPage
    // WHERE AppCommonPage.appId = ? 
    // ORDER BY appCommonPageSubId;`

    const settings_sql_data = `SELECT *
    FROM AppSetting
    WHERE AppSetting.appId = ?;`

    parameter.push(Number(appId));

    console.log("free_pages_sql_data:", free_pages_sql_data);
    console.log("common_pages_sql_data:", common_pages_sql_data);
    console.log("settings_sql_data:", common_pages_sql_data);
    console.log("query params:", parameter);

    try {


        let appSql = `SELECT App.eventId, appName, projectId, Domain.domainURL, appDesignBlocks, appDesignHistories FROM App INNER JOIN Event ON Event.eventId = App.eventId LEFT OUTER JOIN Domain ON App.appDomainId = Domain.domainId WHERE App.appId = ?`

        var [app_query_result, app_query_fields] = await mysql_con.query(appSql, parameter);
        var [free_pages_query_result, free_query_fields] = await mysql_con.query(free_pages_sql_data, parameter);
        var [common_pages_query_result, common_query_fields] = await mysql_con.query(common_pages_sql_data, parameter);
        var [settings_query_result, settings_query_fields] = await mysql_con.query(settings_sql_data, parameter);

        if (free_pages_query_result && common_pages_query_result && settings_query_result) {

            // var blocks_of_page = getBlocksFromFreePage(free_pages_query_result);
            // var blocks_of_common_page = getBlocksFromCommonPage(common_pages_query_result);

            // console.log("blocks_of_page");
            // console.log(blocks_of_page);

            // var uniqueFreePages = {};
            // var uniqueCommonPages = {};

            free_pages_query_result.forEach((element) => {
                if (!element.blocks) element.blocks = [];
                else {
                    element.blocks = [...element.blocks.records]
                }
            })
            common_pages_query_result.forEach((element) => {
                if (!element.blocks) element.blocks = [];
                else {
                    element.blocks = [...element.blocks.records]
                }
            })
            app_query_result[0].appId = appId;
            // get response
            return {
                "freePages": free_pages_query_result,
                "commonPages": common_pages_query_result,
                "settings": settings_query_result[0]?.appSettingQuery,
                "blocks": app_query_result[0].appDesignBlocks,
                "histories": app_query_result[0].appDesignHistories,
                "eventId": app_query_result[0].eventId,
                "appName": app_query_result[0].appName,
                "statusCode": 200,
            }

        } else {
            return {
                "statusCode": 400,
            }
        }
    } catch (error) {
        console.log("error:", error)
        return {
            "statusCode": 400,
        }
    } finally {
        if (mysql_con) await mysql_con.close();
    }
}
//get aapprecords


/**
* ManagerAppEditorCopy.
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
    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    const apiData = JSON.parse(event.body);
    console.log("postData");
    console.log(apiData);

    if (apiData?.from_app_id != '' && apiData?.to_app_id && apiData.from_project_id != '' && apiData.to_project_id != '') {
        let appId = apiData?.to_app_id;
        let updatedBy = apiData.updatedBy;
        logAccountId = updatedBy;
        console.log("appId:", appId);
        let mysql_con;
        let mysql_conRead;
        try {
            // mysql connect
            mysql_conRead = await mysql.createConnection(readDbConfig);
            //readfromAppData
            let appData = await getFromAppData(mysql_conRead, apiData?.from_app_id);
            console.log("appDataFromDB");
            console.log(appData);
            mysql_con = await mysql.createConnection(writeDbConfig);

            let toAppQuery = `SELECT eventId, appName FROM App WHERE appId = ?`;
            const [toAppQueryResult] = await mysql_con.query(toAppQuery, [appId]);
            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベントID";
            logData[0].beforeValue = appData.eventId;
            logData[0].afterValue = toAppQueryResult[0].eventId;
            logData[1] = {};
            logData[1].fieldName = "APP名";
            logData[1].beforeValue = appData.appName;
            logData[1].afterValue = toAppQueryResult[0].appName;

            //readfromAppData
            if (appData.statusCode == 200) {
                console.log(" appData", appData);
                console.log(" appData.freePages.length", appData?.freePages.length);
                console.log(" appData.commonPages.length", appData?.commonPages.length);
                // 自由ページの更新
                if (typeof appData.freePages !== 'undefined' && appData.freePages.length > 0) {
                    await updateFreePages(mysql_con, appData.freePages, appId);
                }
                // 共通ページの更新            
                if (typeof appData.commonPages !== 'undefined' && appData.commonPages.length > 0) {
                    await updateCommonPages(mysql_con, appData.commonPages, appId);
                }
                // 設定部分の更新
                if (typeof appData.settings !== 'undefined' && appData.settings) {
                    await updateSettings(mysql_con, appData.settings, appId);
                }
                // ブロック一覧と履歴情報の更新
                await updateBlockHistory(mysql_con, appData.blocks, appData.histories, appId, updatedBy);
            }
            var response = "Success";
            console.log("response:", response);
            mysql_con.commit();

            // success log
            await createLog(context, 'APPデザイナー', 'コピー', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: response,
            };
        } catch (error) {
            console.log(error);
            mysql_con.rollback();
            // failure log
            await createLog(context, 'APPデザイナー', 'コピー', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            if (mysql_conRead) await mysql_conRead.close();
        }
    } else {
        // failure log
        await createLog(context, 'APPデザイナー', 'コピー', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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