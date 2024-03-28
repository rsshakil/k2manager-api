/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerSMSTemplateUpdate.
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
    const {
        projectId,
        smsTemplateId,
        eventCategoryId,
        smsTemplateTypeFlag,
        smsTemplateBody,
        memo,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    let mysql_con;
    try {
        // Get one record by primary key
        if (event.pathParameters && event.pathParameters?.eventId) {
            // get event id
            let eventId = event.pathParameters?.eventId;
            console.log("eventId:", eventId);

            // Expand GET parameters
            if (!projectId) {
                let error = "invalid parameter. Project ID not found.";
                // failure log
                await createLog(context, 'SMSテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
                // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
                if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                    // failure log
                    await createLog(context, 'SMSテンプレート', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                    return {
                        statusCode: 403,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Headers': '*',
                        },
                        body: JSON.stringify("Unauthorized"),
                    }
                }
            }

            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();

            // already exists
            if (smsTemplateId) {
                // beforeDataの作成
                let beforeSql = `SELECT * FROM SMSTemplate WHERE smsTemplateId = ?`;
                let [beforeResult] = await mysql_con.execute(beforeSql, [smsTemplateId]);
                // Found set already deleted
                if (beforeResult.length === 0) {
                    await mysql_con.rollback();
                    console.log("Found set already deleted");
                    // failure log
                    await createLog(context, 'SMSテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

                // ログ書き込み
                logData[0] = {};
                logData[0].fieldName = "プロジェクトID";
                logData[0].beforeValue = projectId;
                logData[0].afterValue = projectId;
                logData[1] = {};
                logData[1].fieldName = "SMSテンプレートタイプ";
                logData[1].beforeValue = beforeResult[0].smsTemplateTypeFlag;
                logData[1].afterValue = smsTemplateTypeFlag;
                logData[2] = {};
                logData[2].fieldName = "SMSテンプレート本文";
                logData[2].beforeValue = beforeResult[0].smsTemplateBody;
                logData[2].afterValue = smsTemplateBody;
                logData[3] = {};
                logData[3].fieldName = "SMSテンプレートメモ";
                logData[3].beforeValue = beforeResult[0].memo;
                logData[3].afterValue = memo;

                const updatedAt = Math.floor(new Date().getTime() / 1000);
                let sql_data = `UPDATE SMSTemplate SET
                    smsTemplateTypeFlag = ?,
                    smsTemplateBody = ?,
                    memo = ?,
                    updatedAt = ?,
                    updatedBy = ?
                    WHERE smsTemplateId = ?;`;
                let sql_param = [
                    smsTemplateTypeFlag,
                    smsTemplateBody,
                    memo,
                    updatedAt,
                    updatedBy,
                    smsTemplateId
                ];
                console.log("sql_data:", sql_data);
                console.log("sql_param:", sql_param);

                let [query_result] = await mysql_con.execute(sql_data, sql_param);
                await mysql_con.commit();

                // construct the response
                let response = {
                    records: query_result[0]
                };
                console.log("response:", response);
                // success log
                await createLog(context, 'SMSテンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 200,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify(response),
                };
            }
            else {
                // ログ書き込み
                logData[0] = {};
                logData[0].fieldName = "プロジェクトID";
                logData[0].beforeValue = "";
                logData[0].afterValue = projectId;
                logData[1] = {};
                logData[1].fieldName = "SMSテンプレートタイプ";
                logData[1].beforeValue = "";
                logData[1].afterValue = smsTemplateTypeFlag;
                logData[2] = {};
                logData[2].fieldName = "SMSテンプレート本文";
                logData[2].beforeValue = "";
                logData[2].afterValue = smsTemplateBody;
                logData[3] = {};
                logData[3].fieldName = "SMSテンプレートメモ";
                logData[3].beforeValue = "";
                logData[3].afterValue = memo;

                // insert data query
                let sql_data = `INSERT INTO SMSTemplate (
                    eventId,
                    eventCategoryId,
                    smsTemplateTypeFlag,
                    smsTemplateBody,
                    memo,
                    createdAt,
                    createdBy,
                    updatedAt,
                    updatedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`;
                // created date
                const createdAt = Math.floor(new Date().getTime() / 1000);
                let sql_param = [
                    eventId,
                    eventCategoryId,
                    smsTemplateTypeFlag,
                    smsTemplateBody,
                    memo,
                    createdAt,
                    updatedBy,
                    createdAt,
                    updatedBy
                ];
                console.log("sql_data:", sql_data);
                console.log("sql_param:", sql_param);

                const [query_result] = await mysql_con.execute(sql_data, sql_param);
                await mysql_con.commit();

                // construct the response
                let response = {
                    records: query_result[0]
                };
                console.log("response:", response);
                // success log
                await createLog(context, 'SMSテンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 200,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify(response),
                };
            }
        } else {
            // failure log
            await createLog(context, 'SMSテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
    } catch (error) {
        await mysql_con.rollback();
        console.log(error);
        // failure log
        await createLog(context, 'SMSテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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