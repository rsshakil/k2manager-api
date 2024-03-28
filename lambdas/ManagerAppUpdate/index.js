/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerAppUpdate.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logData = [];
    let logAccountId;
    let appInitStatus = 0;

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
        console.log("appId: ", appId);
        let {
            eventId,
            appName,
            appStatus,
            appBasicFlag,
            appBasicUser,
            appBasicPassword,
            appDomainId,
            appAPIDomainId,
            appAuthDomainId,
            memo,
            updatedBy,
            switchFlag,
        } = JSON.parse(event.body);
        logAccountId = updatedBy;

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();

            // 現在の情報を取得する
            let {
                appNameCurrent,
                eventIdCurrent,
                appCode,
                appAuthApiId,
                appBasicFlagCurrent,
                appBasicUserCurrent,
                appBasicPasswordCurrent,
                appStatusCurrent,
                appInitializeStatusCurrent,
                memoCurrent,
                appDomainURLCurrent,
                appAuthDomainURLCurrent,
                appDomainIdCurrent,
                appAuthDomainIdCurrent
            } = await getCurrent(mysql_con, appId);

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベントID";
            logData[0].beforeValue = eventIdCurrent;
            logData[0].afterValue = eventId;
            logData[1] = {};
            logData[1].fieldName = "APP名";
            logData[1].beforeValue = appNameCurrent;
            logData[1].afterValue = appName;
            logData[2] = {};
            logData[2].fieldName = "APPドメイン";
            logData[2].beforeValue = appDomainIdCurrent;
            logData[2].afterValue = appDomainId;
            logData[3] = {};
            logData[3].fieldName = "APPステータス";
            logData[3].beforeValue = appStatusCurrent;
            logData[3].afterValue = appStatus;
            logData[4] = {};
            logData[4].fieldName = "BASIC認証フラグ";
            logData[4].beforeValue = appBasicFlagCurrent;
            logData[4].afterValue = appBasicFlag;
            logData[5] = {};
            logData[5].fieldName = "BASIC認証ユーザー名";
            logData[5].beforeValue = appBasicUserCurrent;
            logData[5].afterValue = appBasicUser;
            logData[6] = {};
            logData[6].fieldName = "BASIC認証パスワード";
            logData[6].beforeValue = appBasicPasswordCurrent;
            logData[6].afterValue = appBasicPassword;
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = memoCurrent;
            logData[7].afterValue = memo;

            // Found set already deleted
            if (!appCode) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'APP', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already deleted",
                        errorCode: 201
                    }),
                };
            }

            let inProgress = await checkProgress(appCode, appInitializeStatusCurrent);
            if (inProgress) {
                console.log("App initialize/update in progress");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'APP', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "App initialize/update in progress",
                        errorCode: 203
                    }),
                };
            }

            // 変更後ドメインの利用先APPを取得
            if (appDomainId != appDomainIdCurrent) {
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
            await releaseDomain(mysql_con, appDomainId, appAuthDomainId, appDomainIdCurrent, appAuthDomainIdCurrent);

            // 新URLを取得する
            let {
                appDomainURL,
                appAuthDomainURL
            } = await getURLs(mysql_con, appDomainId, appAuthDomainId);

            // リソース更新（スクリプト呼び出し）の要否を確認する
            let checkParam = {
                appBasicFlag,
                appBasicUser,
                appBasicPassword,
                appDomainURL,
                appAuthDomainURL,
                appStatus,
                appBasicFlagCurrent,
                appBasicUserCurrent,
                appBasicPasswordCurrent,
                appDomainURLCurrent,
                appAuthDomainURLCurrent,
                appStatusCurrent
            };
            let {
                appNeedUpdate,
                apiNeedUpdate
            } = await checkUpdate(checkParam);

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            // DB更新用に、クエリとパラメータを準備する
            let sql_data;
            if (appNeedUpdate) {
                sql_data = `UPDATE App SET
                    eventId = ?,
                    appName = ?,
                    appStatus = ?,
                    appBasicFlag = ?,
                    appBasicUser = ?,
                    appBasicPassword = ?,
                    appDomainId = ?,
                    appAPIDomainId = ?,
                    appAuthDomainId = ?,
                    appInitializeStatus = 0,
                    memo = ?,
                    updatedAt = ?,
                    updatedBy = ?
                    WHERE appId = ?;`;
            }
            else {
                sql_data = `UPDATE App SET
                    eventId = ?,
                    appName = ?,
                    appStatus = ?,
                    appBasicFlag = ?,
                    appBasicUser = ?,
                    appBasicPassword = ?,
                    appDomainId = ?,
                    appAPIDomainId = ?,
                    appAuthDomainId = ?,
                    memo = ?,
                    updatedAt = ?,
                    updatedBy = ?
                    WHERE appId = ?;`;
            }

            let sql_param = [
                eventId,
                appName,
                appStatus,
                appBasicFlag,
                appBasicUser,
                appBasicPassword,
                appDomainId,
                appAPIDomainId,
                appAuthDomainId,
                memo,
                updatedAt,
                updatedBy,
                appId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            // DBを更新する
            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     console.log("Found set already deleted");
            //     await mysql_con.rollback();
            //     // failure log
            //     await createLog(context, 'APP', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            //     return {
            //         statusCode: 400,
            //         headers: {
            //             "Access-Control-Allow-Origin": "*",
            //             "Access-Control-Allow-Headers": "*",
            //         },
            //         body: JSON.stringify({
            //             message: "Found set already deleted",
            //             errorCode: 201
            //         }),
            //     };
            // }

            // AppとAPIのリソースを更新する
            if (appNeedUpdate) {
                await updateApp(appCode,
                    appBasicFlag, appBasicUser, appBasicPassword, appDomainURL,
                    appBasicFlagCurrent, appBasicUserCurrent, appBasicPasswordCurrent, appDomainURLCurrent,
                    appStatus, appStatusCurrent);
            }
            if (apiNeedUpdate) {
                await updateApi(appCode,
                    appAuthDomainURL, appAuthApiId, appAuthDomainURLCurrent,
                    appDomainURL, appDomainURLCurrent);
            }

            appInitStatus = appNeedUpdate ? 10 : 100;
            await updateInitializeStatus(mysql_con, appId, appInitStatus);

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'APP', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            console.log(error);
            // failure log
            await createLog(context, 'APP', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'APP', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
async function updateApp(appCode, appBasicFlag, appBasicUser, appBasicPassword, appDomainURL, appBasicFlagCurrent, appBasicUserCurrent, appBasicPasswordCurrent, appDomainURLCurrent, appStatus, appStatusCurrent)
{
    console.log("updateApp params: ", {appCode, appBasicFlag, appBasicUser, appBasicPassword, appDomainURL, appBasicFlagCurrent, appBasicUserCurrent, appBasicPasswordCurrent, appDomainURLCurrent, appStatus, appStatusCurrent});
    //return;

    //if (!appBasicUser) appBasicUser = "UNCHANGED";
    //if (!appBasicPassword) appBasicPassword = "UNCHANGED";
    //if (!appDomainURL) appDomainURL = "UNCHANGED";

    let payload = {
        "command": [
            "/bin/bash", "-c", `cd /root/k2app && git pull && git checkout ${process.env.ENV} && git pull && ./update-app.sh "${appCode}" "${appBasicFlag}" "${appBasicUser}" "${appBasicPassword}" "${appDomainURL}" "${appBasicFlagCurrent}" "${appBasicUserCurrent}" "${appBasicPasswordCurrent}" "${appDomainURLCurrent}" "${appStatus}" "${appStatusCurrent}"`
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
async function updateApi(appCode, appAuthDomainURL, appAuthApiId, appAuthDomainURLCurrent, appDomainURL, appDomainURLCurrent)
{
    console.log("updateApi params: ", {appCode, appAuthDomainURL, appAuthApiId, appAuthDomainURLCurrent, appDomainURL, appDomainURLCurrent});
    //return;

    //if (!appAuthDomainURL) appAuthDomainURL = "UNCHANGED";

    let payload = {
        "command": [
            "/bin/bash", "-c", `cd /root/k2app && git pull && git checkout ${process.env.ENV} && git pull && ./update-api.sh "${appCode}" "${appAuthDomainURL}" "${appAuthApiId}" "${appAuthDomainURLCurrent}" "${appDomainURL}" "${appDomainURLCurrent}"`
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

async function getCurrent(mysql_con, appId)
{
    let sql_data = `SELECT
        appName AS appNameCurrent,
        eventId AS eventIdCurrent,
        appCode,
        appAuthApiId,
        appBasicFlag AS appBasicFlagCurrent,
        appBasicUser AS appBasicUserCurrent,
        appBasicPassword AS appBasicPasswordCurrent,
        appStatus AS appStatusCurrent,
        appInitializeStatus AS appInitializeStatusCurrent,
        App.memo AS memoCurrent,
        d1.domainURL AS appDomainURLCurrent,
        d2.domainURL AS appAuthDomainURLCurrent,
        d1.domainId AS appDomainIdCurrent,
        d2.domainId AS appAuthDomainIdCurrent
        FROM App
        LEFT OUTER JOIN Domain d1 ON App.appDomainId = d1.domainId
        LEFT OUTER JOIN Domain d2 ON App.appAuthDomainId = d2.domainId
        WHERE appId = ?`;

    var [query_result] = await mysql_con.query(sql_data, [appId]);
    console.log(query_result);

    let retval = {};
    if (query_result && query_result[0]) {
        retval = query_result[0];

        if (!retval.appDomainURLCurrent) retval.appDomainURLCurrent = '';
        if (!retval.appAuthDomainURLCurrent) retval.appAuthDomainURLCurrent = '';

        if (!retval.appAuthDomainURLCurrent && retval.appDomainURLCurrent) {
            retval.appAuthDomainURLCurrent = retval.appDomainURLCurrent.replace(/\./, "-auth.");
        }
    }

    return retval;
}

async function getURLs(mysql_con, appDomainId, appAuthDomainId)
{
    let appDomainURL = '';
    if (appDomainId) {
        let sql_data1 = `SELECT domainURL from Domain WHERE domainId = ?`;
        var [query_result1] = await mysql_con.query(sql_data1, [appDomainId]);
        console.log(query_result1);
        if (query_result1 && query_result1[0] && query_result1[0].domainURL) {
            appDomainURL = query_result1[0].domainURL;
        }
    }

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

    console.log("getURLs: ", {appDomainURL, appAuthDomainURL});

    return {
        appDomainURL,
        appAuthDomainURL
    };
}

async function checkUpdate(checkParam)
{
    let {
        appBasicFlag,
        appBasicUser,
        appBasicPassword,
        appDomainURL,
        appAuthDomainURL,
        appStatus,
        appBasicFlagCurrent,
        appBasicUserCurrent,
        appBasicPasswordCurrent,
        appDomainURLCurrent,
        appAuthDomainURLCurrent,
        appStatusCurrent
    } = checkParam;

    let appNeedUpdate = 0;
    let apiNeedUpdate = 0;

    if (appBasicFlag != appBasicFlagCurrent) {
        appNeedUpdate = 1;
        if (appBasicFlagCurrent) {
            // undo current setting
        }
        if (appBasicFlag) {
            // do new setting
        }
    }
    else if (appBasicUser != appBasicUserCurrent) {
        appNeedUpdate = 1;
        // update setting or undo+do
    }
    else if (appBasicPassword != appBasicPasswordCurrent) {
        appNeedUpdate = 1;
        // update setting or undo+do
    }

    if (appDomainURL != appDomainURLCurrent) {
        appNeedUpdate = 1;
        apiNeedUpdate = 1;
        if (appDomainURLCurrent) {
            // undo current setting
        }
        if (appDomainURL) {
            // do new setting
        }
    }

    if (appAuthDomainURL != appAuthDomainURLCurrent) {
        apiNeedUpdate = 1;
        if (appAuthDomainURLCurrent) {
            // undo current setting
        }
        if (appAuthDomainURL) {
            // do new setting
        }
    }

    // if (appStatus != appStatusCurrent) {
    //     appNeedUpdate = 1;
    //     if (appStatus) {
    //         // enable
    //     }
    //     else {
    //         // disable
    //     }
    // }

    console.log("checkUpdate: ", {appNeedUpdate, apiNeedUpdate});

    return {
        appNeedUpdate,
        apiNeedUpdate
    };
}

async function releaseDomain(mysql_con, appDomainId, appAuthDomainId, appDomainIdCurrent, appAuthDomainIdCurrent)
{
    if (appDomainId != appDomainIdCurrent && appDomainId) {
        let sql_data = `UPDATE App
            SET appDomainId = NULL
            WHERE appDomainId = ?`;
        let [query_result] = await mysql_con.query(sql_data, [appDomainId]);
        console.log(query_result);
        if (query_result.affectedRows > 0) {
            console.log("Released appDomainId from other App");
        }
    }

    if (appAuthDomainId != appAuthDomainIdCurrent && appAuthDomainId) {
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

/**
* このAPPの処理が進行中かを確認
*/
async function checkProgress(appCode, appInitializeStatusCurrent) {
    console.log("checkProgress for appCode: ", appCode);
    console.log("appInitializeStatusCurrent: ", appInitializeStatusCurrent);

    const progressArr = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    if (progressArr.includes(appInitializeStatusCurrent)) {
        console.log("Previous work in progress !!!");
        return true;
    }

    const errArr = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
    if (errArr.includes(appInitializeStatusCurrent)) {
        console.log("Previous work had error !!!");
        return false;
    }

    // ここまで来たら、appInitializeStatusCurrent が必ず 100 になっている。
    // Cloudfront のデプロイが進行中かもしれないし、完了しているかもしれない。

    // const params = {
    //     appCode: appCode
    // };
    // //console.log("params: ", params);
    // const findAppCf = require('findAppCf');
    // const cf = await findAppCf.handler(params);

    const params = {
        FunctionName: "findAppCf",
        InvocationType: "RequestResponse",
        Payload: JSON.stringify({
           appCode: appCode
        }),
    };
    const res = await lambda.invoke(params).promise();
    const cf = JSON.parse(res.Payload);

    console.log("cf: ");
    console.dir(cf, { depth: null });

    if (!cf) {
        // マッチするCloudfront Distributionが存在しない。
        // 手動でCloudfrontを削除した場合など。
        // ここで、「進行中」としてしまうと、APPの更新ができなくなる。
        //
        console.log("No matching Cloudfront distribution.");
        return false;
    }

    if (cf.Status != "Deployed") {
        console.log("Cloudfront distribution not deployed yet");
        return true;
    }

    console.log("Cloudfront distribution already deployed");
    return false;
}

async function updateInitializeStatus(mysql_con, appId, status=100)
{
    console.log("Going to update app initialize status to ", status);

    try {
        let appQuery = `UPDATE App SET appInitializeStatus = ? WHERE appId = ?`;
        await mysql_con.query(appQuery, [status, appId]);
        console.log("Updated app initialize status to ", status);
    }
    catch(error) {
        console.log("Failed to update app initialize status");
        throw error;
    }
}
