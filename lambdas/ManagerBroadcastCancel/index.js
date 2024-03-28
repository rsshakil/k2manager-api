/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const CS = require('@aws-sdk/client-scheduler');
const schedulerClient = new CS.SchedulerClient({ region: "ap-northeast-1" });
const PREFIX_GROUP_NAME = "ScheduleGroupForProject";
const PREFIX_SCHEDULE_NAME = "ScheduleForBroadcast";

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBroadcastCancel.
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

    if (event.pathParameters?.broadcastId) {
        let broadcastId = event.pathParameters.broadcastId;
        console.log("broadcastId:", broadcastId);
        const {
            projectId,
            deletedBy,
        } = JSON.parse(event.body);
        logAccountId = deletedBy;

        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, '一斉送信', '取り消し', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, '一斉送信', '取り消し', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // 一斉送信データの取得
            // beforeDataの作成
            let beforeSql = `SELECT Broadcast.*, BroadcastTemplate.broadcastTemplateId FROM Broadcast INNER JOIN BroadcastTemplate ON Broadcast.broadcastId = BroadcastTemplate.broadcastId WHERE Broadcast.broadcastId = ? AND Broadcast.projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [broadcastId, projectId]);
            // Found set already canceled
            if (beforeResult.length !== 0 && beforeResult[0].broadcastStatus === 2) {
                console.log("Found set already canceled");
                await mysql_con.rollback();
                // failure log
                await createLog(context, '一斉送信', '取り消し', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already canceled",
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
            logData[1].fieldName = "一斉送信ID";
            logData[1].beforeValue = beforeResult[0].broadcastId;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "一斉送信種別";
            logData[2].beforeValue = beforeResult[0].broadcastType;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "一斉送信ステータス";
            logData[3].beforeValue = beforeResult[0].broadcastStatus;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "一斉送信予約日時";
            logData[4].beforeValue = beforeResult[0].broadcastScheduleDatetime;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "一斉送信編集日時";
            logData[5].beforeValue = beforeResult[0].broadcastEditDatetime;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "一斉送信取り消し日時";
            logData[6].beforeValue = beforeResult[0].broadcastCancelDatetime;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "一斉送信送信人数";
            logData[7].beforeValue = beforeResult[0].broadcastCount;
            logData[7].afterValue = "";

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE Broadcast SET
                broadcastStatus = ?,
                broadcastCancelDatetime = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE broadcastId = ? AND projectId = ?;`;
            let sql_param = [
                2,
                updatedAt,
                updatedAt,
                deletedBy,
                broadcastId,
                projectId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);

            // define scheduler group name
            const groupName = PREFIX_GROUP_NAME + projectId + "-" + process.env.ENV;
            // define schedule name
            const scheduleName = PREFIX_SCHEDULE_NAME + beforeResult[0].broadcastTemplateId + "-" + process.env.ENV;

            // get schedule
            let schedulerList = await schedulerClient.send(new CS.ListSchedulesCommand({ GroupName: groupName, NamePrefix: scheduleName }));
            // console.log("=========== schedulerList", schedulerList);
            // group does not exist
            if (schedulerList.Schedules.length !== 0) {
                try {
                    // delete schedule
                    await schedulerClient.send(new CS.DeleteScheduleCommand({
                        Name: scheduleName,
                        GroupName: groupName
                    }));
                } catch (error) {
                    // nop
                }
            }

            await mysql_con.commit();
            // success log
            await createLog(context, '一斉配信', '取り消し', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            await createLog(context, '一斉配信', '取り消し', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, '一斉配信', '取り消し', '失敗', '400', event.requestContext.identity.sourceIp, null, null, logData);
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