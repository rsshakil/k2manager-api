/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerAppCreate.
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
    
    let projectId = null;
    let mysql_con;
    try {
        let {
            eventId,
            appName,
            appDomainId,
            appAPIDomainId,
            appAuthDomainId,
            appStatus,
            appBasicFlag,
            appBasicUser,
            appBasicPassword,
            memo,
            createdBy,
            updatedBy,
            switchFlag,
            defaultCommonPages
        } = JSON.parse(event.body);
        logAccountId = createdBy;
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            projectId = event?.requestContext?.authorizer?.pid
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!event.queryStringParameters?.pid || validProjectId.indexOf(Number(event.queryStringParameters?.pid)) == -1) {
                // failure log
                await createLog(context, 'APP', '作成', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                };
            }
        }

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "イベントID";
        logData[0].beforeValue = "";
        logData[0].afterValue = eventId;
        logData[1] = {};
        logData[1].fieldName = "APP名";
        logData[1].beforeValue = "";
        logData[1].afterValue = appName;
        logData[2] = {};
        logData[2].fieldName = "APPドメイン";
        logData[2].beforeValue = "";
        logData[2].afterValue = appDomainId;
        logData[3] = {};
        logData[3].fieldName = "APPステータス";
        logData[3].beforeValue = "";
        logData[3].afterValue = appStatus;
        logData[4] = {};
        logData[4].fieldName = "BASIC認証フラグ";
        logData[4].beforeValue = "";
        logData[4].afterValue = appBasicFlag;
        logData[5] = {};
        logData[5].fieldName = "BASIC認証ユーザー名";
        logData[5].beforeValue = "";
        logData[5].afterValue = appBasicUser;
        logData[6] = {};
        logData[6].fieldName = "BASIC認証パスワード";
        logData[6].beforeValue = "";
        logData[6].afterValue = appBasicPassword;
        logData[7] = {};
        logData[7].fieldName = "メモ";
        logData[7].beforeValue = "";
        logData[7].afterValue = memo;

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        /*
        // 利用中のドメインを指定できない
        //
        appDomainId = (appDomainId == "") ? 0 : appDomainId;
        appAuthDomainId = (appAuthDomainId == "") ? 0 : appAuthDomainId;
        let sql_data00 = `SELECT
        COUNT(appId)
        AS count
        FROM App
        WHERE (appDomainId = ? OR appDomainId = ? OR appAuthDomainId = ? OR appAuthDomainId = ?) AND appDomainId != 0 AND appAuthDomainId != 0`;
        var [query_result00] = await mysql_con.query(sql_data00, [appDomainId, appDomainId, appAuthDomainId, appAuthDomainId]);

        if (query_result00[0].count >= 1) {
            console.log("domain are used in app.");
            // failure log
            await createLog(context, 'APP', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "domain are used in app.",
                    errorCode: 109
                }),
            };
        }
        */

        // 変更後ドメインの利用先APPを取得
        if (appDomainId) {
            if (!switchFlag) {
                let sql_data_domain = `SELECT App.appId FROM App INNER JOIN Domain ON App.appDomainId = Domain.domainId WHERE App.appDomainId = ?`;
                var [query_result_domain] = await mysql_con.query(sql_data_domain, [appDomainId]);
                // console.log("============ query_result_domain", query_result_domain);

                // 変更後ドメインが使用されている場合は確認モーダル表示
                if (query_result_domain.length !== 0) {
                    await mysql_con.rollback();
                    return {
                        statusCode: 200,
                        headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Headers": "*",
                        },
                        body: JSON.stringify({
                            message: "The specified domain is already in use.",
                            errorCode: 601
                        }),
                    };
                }
            }
        }

        // 利用中のドメインなら、利用中APPからドメインを外す
        await releaseDomain(mysql_con, appDomainId, appAuthDomainId);

        // regist view code
        let params = {
            FunctionName: "getviewcode2-" + process.env.ENV,
            InvocationType: "RequestResponse"
        };
        let codeData = await lambda.invoke(params).promise();
        console.log("Lambda Invoked:", codeData);
        let appCode = JSON.parse(codeData.Payload);
        console.log("appCode: ", appCode);

        // insert data query
        let sql_data = `INSERT INTO App (
            eventId,
            appName,
            appCode,
            appStatus,
            appBasicFlag,
            appBasicUser,
            appBasicPassword,
            appDomainId,
            appAPIDomainId,
            appAuthDomainId,
            appBaseCurrentId,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            eventId,
            appName,
            appCode,
            appStatus,
            appBasicFlag,
            appBasicUser,
            appBasicPassword,
            appDomainId,
            appAPIDomainId,
            appAuthDomainId,
            1,
            memo,
            createdAt,
            createdBy,
            createdAt,
            updatedBy
        ];
        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);
        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        if (query_result.affectedRows === 0) {
            // failure log
            await createLog(context, 'APP', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 404,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "no data"
                }),
            };
        }
        console.log("query_result", query_result);
        let appId = query_result.insertId
        // AppPageを生成する
        if (defaultCommonPages && defaultCommonPages.length >= 1) {
            let newData = [];
            defaultCommonPages.forEach((page) => {
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
                        page.appPageLoadingFlag,
                        JSON.stringify(page.appPageLoadingStopFlag),
                        page.updatedBy,
                        page.updatedBy,
                        createdAt,
                        createdAt
                    ];
                newData.push(aux);
            });
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
        // AppとAPIのリソースを作成する
        let appDomainURL = '';
        if (appDomainId) {
            let sql_data1 = `SELECT domainURL from Domain WHERE domainId = ?`;
            var [query_result1] = await mysql_con.query(sql_data1, [appDomainId]);
            console.log(query_result1);
            if (query_result1 && query_result1[0] && query_result1[0].domainURL) {
                appDomainURL = query_result1[0].domainURL;
            }
        }
        await setupApp(appCode, appBasicFlag, appBasicUser, appBasicPassword, appDomainURL, appStatus);

        let appAuthDomainURL = '';
        if (appAuthDomainId) {
            let sql_data2 = `SELECT domainURL from Domain WHERE domainId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [appAuthDomainId]);
            console.log(query_result2);
            if (query_result2 && query_result2[0] && query_result2[0].domainURL) {
                appAuthDomainURL = query_result2[0].domainURL;
            }
        }
        if (!appAuthDomainURL && appDomainURL) {
            appAuthDomainURL = appDomainURL.replace(/\./, "-auth.");
        }
        await setupApi(appCode, appAuthDomainURL, appDomainURL);

        await mysql_con.commit();

        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'APP', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
        // failure log
        await createLog(context, 'APP', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
};

/**
 * ドメインに紐づいているリソースを解放する
 */
async function deleteDomain(domainURL) {
    let payload = {
        "customDomain": domainURL
    };

    let params = {
        Payload: JSON.stringify(payload),
        FunctionName: "DomainDelete-" + process.env.ENV,
        InvocationType: "RequestResponse"
    };
    console.log("params:", params);

    let res = await lambda.invoke(params).promise();
    console.log("res: ", res);
}

/**
 * Appのリソースを作成する
 */
async function setupApp(appCode, appBasicFlag, appBasicUser, appBasicPassword, appDomainURL, appStatus) {
    //if (!appBasicUser) appBasicUser = "dummy";
    //if (!appBasicPassword) appBasicPassword = "dummy";

    let payload = {
        "command": [
            "/bin/bash", "-c", `cd /root/k2app && git pull && git checkout ${process.env.ENV} && git pull && ./setup-app.sh "${appCode}" "${appBasicFlag}" "${appBasicUser}" "${appBasicPassword}" "${appDomainURL}" "${appStatus}"`
        ]
    };

    let params = {
        Payload: JSON.stringify(payload),
        FunctionName: "RunEcsTask-" + process.env.ENV,
        InvocationType: "Event"
    };
    console.log("params: ", params);

    let res = await lambda.invoke(params).promise();
    console.log("res: ", res);
}

/**
 * APIのリソースを作成する
 */
async function setupApi(appCode, appAuthDomainURL, appDomainURL) {
    let payload = {
        "command": [
            "/bin/bash", "-c", `cd /root/k2app && git pull && git checkout ${process.env.ENV} && git pull && ./setup-api.sh "${appCode}" "${appAuthDomainURL}" "${appDomainURL}"`
        ]
    };

    let params = {
        Payload: JSON.stringify(payload),
        FunctionName: "RunEcsTask-" + process.env.ENV,
        InvocationType: "Event"
    };
    console.log("params: ", params);

    let res = await lambda.invoke(params).promise();
    console.log("res: ", res);
}

async function releaseDomain(mysql_con, appDomainId, appAuthDomainId) {
    if (appDomainId) {
        let sql_data = `UPDATE App
            SET appDomainId = NULL
            WHERE appDomainId = ?`;
        let [query_result] = await mysql_con.query(sql_data, [appDomainId]);
        console.log(query_result);
        if (query_result.affectedRows > 0) {
            console.log("Released appDomainId from other App");
        }
    }

    if (appAuthDomainId) {
        let sql_data = `UPDATE App
            SET appAuthDomainId = NULL
            WHERE appAuthDomainId = ?`;
        let [query_result] = await mysql_con.query(sql_data, [appAuthDomainId]);
        console.log(query_result);
        if (query_result.affectedRows > 0) {
            console.log("Released appAuthDomainId from other App");
        }
    }
}

async function createLog(context, _target, _type, _result, _code, ipAddress, projectId, accountId, logData = null) {
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
            projectId: projectId,
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}
