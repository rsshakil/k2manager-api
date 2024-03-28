/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventCategoryUpdate.
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

    let jsonBody = event.queryStringParameters;
    let projectId = 0;
    projectId = jsonBody?.pid;

    if (event.pathParameters?.eventCategoryId) {
        let eventCategoryId = event.pathParameters.eventCategoryId;
        console.log("eventCategoryId:", eventCategoryId);
        let {
            eventId,
            categoryId,
            eventCategoryStartDate,
            eventCategoryEndDate,
            eventCategoryViewType,
            filterId,
            memo,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = updatedBy;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'イベント予約カテゴリー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'イベント予約カテゴリー', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        let validEventId;
        if (event?.requestContext?.authorizer?.eid) {
            validEventId = JSON.parse(event?.requestContext?.authorizer?.eid);
            // eidがない場合 もしくは 許可イベントIDに含まれていない場合
            if (!eventId || validEventId.indexOf(Number(eventId)) == -1) {
                // failure log
                await createLog(context, 'イベント予約カテゴリー', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
/*
        let newDate = new Date(eventCategoryEndDate * 1000);
        eventCategoryEndDate = Date.UTC(newDate.getFullYear(), newDate.getMonth(), newDate.getDate(), newDate.getHours(), newDate.getMinutes(), newDate.getSeconds()) / 1000 - 32400;
*/
        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM EventCategory WHERE eventId = ? AND eventCategoryId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventId, eventCategoryId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'イベント予約カテゴリー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[1].fieldName = "イベントID";
            logData[1].beforeValue = beforeResult[0].eventId;
            logData[1].afterValue = eventId;
            logData[2] = {};
            logData[2].fieldName = "予約カテゴリーID";
            logData[2].beforeValue = beforeResult[0].categoryId;
            logData[2].afterValue = categoryId;
            logData[3] = {};
            logData[3].fieldName = "イベント予約カテゴリーID";
            logData[3].beforeValue = beforeResult[0].eventCategoryId;
            logData[3].afterValue = eventCategoryId;
            logData[4] = {};
            logData[4].fieldName = "イベント予約カテゴリー開始日時";
            logData[4].beforeValue = beforeResult[0].eventCategoryStartDate;
            logData[4].afterValue = eventCategoryStartDate;
            logData[5] = {};
            logData[5].fieldName = "イベント予約カテゴリー終了日時";
            logData[5].beforeValue = beforeResult[0].eventCategoryEndDate;
            logData[5].afterValue = eventCategoryEndDate;
            logData[6] = {};
            logData[6].fieldName = "イベント予約カテゴリー表示種別";
            logData[6].beforeValue = beforeResult[0].eventCategoryViewType;
            logData[6].afterValue = eventCategoryViewType;
            logData[7] = {};
            logData[7].fieldName = "イベント予約カテゴリー表示選択条件フィルター";
            logData[7].beforeValue = beforeResult[0].filterId;
            logData[7].afterValue = filterId;
            logData[8] = {};
            logData[8].fieldName = "メモ";
            logData[8].beforeValue = beforeResult[0].memo;
            logData[8].afterValue = memo;

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE EventCategory SET 
                categoryId = ?,
                eventCategoryStartDate = ?,
                eventCategoryEndDate = ?,
                eventCategoryViewType = ?,
                filterId = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE eventId = ? AND eventCategoryId = ?;`;
            let sql_param = [
                categoryId,
                eventCategoryStartDate,
                eventCategoryEndDate,
                eventCategoryViewType,
                filterId,
                memo,
                updatedAt,
                updatedBy,
                eventId,
                eventCategoryId
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
            await createLog(context, 'イベント予約カテゴリー', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            await createLog(context, 'イベント予約カテゴリー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'イベント予約カテゴリー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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