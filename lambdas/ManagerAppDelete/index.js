
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerAppDelete.
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
            WithDecryption: true
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
        charset: process.env.DBCHARSET
    };

    let projectId = 0;

    if (event.pathParameters?.appId) {
        let appId = event.pathParameters.appId;
        console.log("appId:", appId);
        logAccountId = JSON.parse(event.body).deletedBy;
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
           await createLog(context, 'APP', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
               await createLog(context, 'APP', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        let mysql_con;
        try {
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();

            // Appを取得して、そのAppに紐づいているリソースを解放する
            //
            let sql_data1 = `SELECT
            eventId,
            appName,
            appCode,
            appStatus,
            appInitializeStatus,
            appBasicFlag,
            appBasicUser,
            appBasicPassword,
            appDomainId,
            appAuthApiId,
            App.memo,
            d1.domainURL as appDomainURL,
            d2.domainURL as appAuthDomainURL
            FROM App
            LEFT OUTER JOIN Domain d1 ON App.appDomainId = d1.domainId
            LEFT OUTER JOIN Domain d2 ON App.appAuthDomainId = d2.domainId
            WHERE appId = ?`;
            var [query_result1] = await mysql_con.query(sql_data1, [appId]);
            console.log(query_result1);
            // Found set already deleted
            if (query_result1.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
               await createLog(context, 'APP', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already deleted",
                        errorCode: 101
                    }),
                };
            }

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベントID";
            logData[0].beforeValue = query_result1[0].eventId;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "APP名";
            logData[1].beforeValue = query_result1[0].appName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "APPドメイン";
            logData[2].beforeValue = query_result1[0].appDomainId;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "APPステータス";
            logData[3].beforeValue = query_result1[0].appStatus;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "BASIC認証フラグ";
            logData[4].beforeValue = query_result1[0].appBasicFlag;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "BASIC認証ユーザー名";
            logData[5].beforeValue = query_result1[0].appBasicUser;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "BASIC認証パスワード";
            logData[6].beforeValue = query_result1[0].appBasicPassword;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = query_result1[0].memo;
            logData[7].afterValue = "";

            if (query_result1 && query_result1[0]) {
                var record = query_result1[0];
                if (record.appCode) {
                    if (!record.appAuthDomainURL && record.appDomainURL) {
                        record.appAuthDomainURL = record.appDomainURL.replace(/\./, "-auth.");
                    }

                    let inProgress = await checkProgress(record.appCode, record.appInitializeStatus);
                    if (inProgress) {
                        console.log("App initialize/update in progress");
                        await mysql_con.rollback();
                        // failure log
                        await createLog(context, 'APP', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

                    await deleteApi(record.appCode, record.appAuthDomainURL, record.appAuthApiId, record.appDomainURL);
                    await deleteApp(record.appCode, record.appDomainURL);
                }
            }

            // 該当Appのレコードをテーブルから削除する
            //
            let sql_data2 = `DELETE from App WHERE appId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [appId]);

            await mysql_con.commit();
            // success log
           await createLog(context, 'APP', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
            };
        } catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
           await createLog(context, 'APP', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
    }
    else {
        console.log("invalid parameter");
        // failure log
       await createLog(context, 'APP', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({ "message": "invalid parameter" }),
        };
    }
};

/**
 * Appのリソースを解放する
 */
async function deleteApp(appName, appDomainURL) {
    let payload = {
        "command": [
            "/bin/bash", "-c", `cd /root/k2app && git pull && git checkout ${process.env.ENV} && git pull && ./delete-app.sh "${appName}" "${appDomainURL}"`
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
 * Apiのリソースを解放する
 */
async function deleteApi(appCode, appAuthDomainURL, appAuthApiId, appDomainURL) {
    let payload = {
        "command": [
            "/bin/bash", "-c", `cd /root/k2app && git pull && git checkout ${process.env.ENV} && git pull && ./delete-api.sh "${appCode}" "${appAuthDomainURL}" "${appAuthApiId}" "${appDomainURL}"`
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