/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventCategoryDelete.
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

    let jsonBody = event.queryStringParameters;
    let projectId = 0;
    projectId = jsonBody?.pid;

    if (event.pathParameters?.eventCategoryId) {
        let eventCategoryId = event.pathParameters?.eventCategoryId;
        console.log("eventCategoryId:", eventCategoryId);
        logAccountId = JSON.parse(event.body).deletedBy;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        let eventId = jsonBody.eid;
        let validEventId;
        if (event?.requestContext?.authorizer?.eid) {
            validEventId = JSON.parse(event?.requestContext?.authorizer?.eid);
            // eidがない場合 もしくは 許可イベントIDに含まれていない場合
            if (!eventId || validEventId.indexOf(Number(eventId)) == -1) {
                // failure log
                await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // 削除データの取得
            // beforeDataの作成
            let beforeSql = `SELECT * FROM EventCategory WHERE eventCategoryId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventCategoryId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "イベントID";
            logData[1].beforeValue = beforeResult[0].eventId;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "予約カテゴリーID";
            logData[2].beforeValue = beforeResult[0].categoryId;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "イベント予約カテゴリーID";
            logData[3].beforeValue = beforeResult[0].eventCategoryId;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "イベント予約カテゴリー開始日時";
            logData[4].beforeValue = beforeResult[0].eventCategoryStartDate;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "イベント予約カテゴリー終了日時";
            logData[5].beforeValue = beforeResult[0].eventCategoryEndDate;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "イベント予約カテゴリー表示種別";
            logData[6].beforeValue = beforeResult[0].eventCategoryViewType;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "イベント予約カテゴリー表示選択条件フィルター";
            logData[7].beforeValue = beforeResult[0].filterId;
            logData[7].afterValue = "";
            logData[8] = {};
            logData[8].fieldName = "メモ";
            logData[8].beforeValue = beforeResult[0].memo;
            logData[8].afterValue = "";

            // 下にイベント施設がぶら下がっていた場合削除に失敗する
            let sql_data = `SELECT COUNT(eventInstituteId) AS count FROM EventInstitute WHERE eventCategoryId = ?`;
            var [query_result] = await mysql_con.query(sql_data, [eventCategoryId]);
            if (query_result[0].count >= 1) {
                console.log("invalid parameter");
                // failure log
                await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "categories are used in institute.",
                        errorCode: 116
                    }),
                };
            }
            // カテゴリー削除
            let sql_data2 = `DELETE from EventCategory WHERE eventCategoryId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [eventCategoryId]);

            await mysql_con.commit();
            // success log
            await createLog(context, 'イベント予約カテゴリー', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
            };
        } catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'イベント予約カテゴリー', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
