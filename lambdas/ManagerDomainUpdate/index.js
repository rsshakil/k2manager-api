/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerDomainUpdate.
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

    if (event.pathParameters?.domainId) {
        let domainId = event.pathParameters.domainId;
        console.log("domainId:", domainId);
        const {
            domainName,
            domainURL,
            memo,
            updatedBy,
        } = JSON.parse(event.body);
        logAccountId = updatedBy;

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();

            // 以降必要になるので、変更前のURLを取っておく
            //
            let currentDomainURL = '';
            let beforeSql = `SELECT * from Domain WHERE domainId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [domainId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'ドメイン', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[0].fieldName = "ドメイン名";
            logData[0].beforeValue = beforeResult[0].domainName;
            logData[0].afterValue = domainName;
            logData[1] = {};
            logData[1].fieldName = "ドメインURL";
            logData[1].beforeValue = beforeResult[0].domainURL;
            logData[1].afterValue = domainURL.toLowerCase();
            logData[2] = {};
            logData[2].fieldName = "メモ";
            logData[2].beforeValue = beforeResult[0].memo;
            logData[2].afterValue = memo;

            if (beforeResult && beforeResult[0] && beforeResult[0].domainURL) {
                currentDomainURL = beforeResult[0].domainURL;
            }

            if (currentDomainURL != domainURL.toLowerCase()) {
                // このドメインID利用中の場合は、ドメインURLの変更を許すと、App側で不整合が発生してしまう
                //
                let sql_data1 = `SELECT COUNT(appId) AS count FROM App WHERE (appDomainId = ? OR appAuthDomainId = ? OR appAPIDomainId = ?)`;
                var [query_result1] = await mysql_con.query(sql_data1, [domainId, domainId, domainId]);
                if (query_result1[0].count >= 1) {
                    console.log("domain are used in app.");
                    // failure log
                    await createLog(context, 'ドメイン', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                    return {
                        statusCode: 400,
                        headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Headers": "*",
                        },
                        body: JSON.stringify({
                            message: "domain are used in app.",
                            errorCode: 112
                        }),
                    };
                }
            }

            let sql_data = `UPDATE Domain SET domainName = ?, domainURL = ?, memo = ?, updatedAt = ?, updatedBy = ? WHERE domainId = ?;`;
            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_param = [
                domainName,
                domainURL.toLowerCase(),
                memo,
                updatedAt,
                updatedBy,
                domainId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     console.log("Found set already deleted");
            //     await mysql_con.rollback();
            //     // failure log
            //     await createLog(context, 'ドメイン', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            //     return {
            //         statusCode: 400,
            //         headers: {
            //             "Access-Control-Allow-Origin": "*",
            //             "Access-Control-Allow-Headers": "*",
            //         },
            //         body: JSON.stringify({
            //             message: "Found set already deleted",
            //             errorCode: 102
            //         }),
            //     };
            // }

            // 旧ドメインURLと新ドメインURLが異なっていれば、以下を行う
            // ・旧ドメインのリソースを解放
            // ・新ドメインのリソースを作成
            //
            if (currentDomainURL != domainURL.toLowerCase()) {
                await deleteDomain(currentDomainURL);
                await setupDomain(domainURL.toLowerCase());
            }
            let authDomainURL = domainURL.toLowerCase().replace(/\./, "-auth.");
            let currentAuthDomainURL = currentDomainURL.replace(/\./, "-auth.");
            if (currentAuthDomainURL != authDomainURL) {
                await deleteDomain(currentAuthDomainURL);
                await setupDomain(authDomainURL);
            }

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'ドメイン', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'ドメイン', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'ドメイン', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
    console.log("params: ", params);

    let res = await lambda.invoke(params).promise();
    console.log("res: ", res);
}

/**
 * ドメインのリソースを更新する
 */
async function setupDomain(domainURL) {
    let payload = {
        "action": "UPSERT",
        "customDomain": domainURL
    };

    let params = {
        Payload: JSON.stringify(payload),
        FunctionName: "DomainSetup-" + process.env.ENV,
        InvocationType: "RequestResponse"
    };
    console.log("params: ", params);

    let res = await lambda.invoke(params).promise();
    console.log("res: ", res);

    const {
        statusCode,
        body
    } = JSON.parse(res.Payload);

    if (statusCode != 200) {
        throw (body);
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