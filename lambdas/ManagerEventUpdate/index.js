/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventUpdate.
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

    if (event.pathParameters?.eventId) {
        let eventId = event.pathParameters.eventId;
        console.log("eventId:", eventId);
        const {
            projectId,
            eventName,
            eventOverview,
            eventDescription,
            eventStartDate,
            eventEndDate,
            eventFiscalStartDate,
            eventFiscalEndDate,
            eventImageURL1,
            eventImageURL2,
            eventImageURL3,
            eventCustomerDeleteFlag,
            eventCustomerDeleteValue,
            eventMailFlag,
            eventReminderSendFlag,
            eventReminderSendValue,
            token1FieldId,
            token2FieldId,
            token3FieldId,
            memo,
            updatedBy,
        } = JSON.parse(event.body);
        logAccountId = updatedBy;

        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'イベント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
                await createLog(context, 'イベント', '更新', '失敗', '403', event.requestContext.identity.sourceIp, logAccountId, logData);
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

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Event WHERE eventId = ? AND projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'イベント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[1].fieldName = "イベントコード";
            logData[1].beforeValue = "";
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "イベント名";
            logData[2].beforeValue = beforeResult[0].eventName;
            logData[2].afterValue = eventName;
            logData[3] = {};
            logData[3].fieldName = "イベント説明";
            logData[3].beforeValue = beforeResult[0].eventOverview;
            logData[3].afterValue = eventOverview;
            logData[4] = {};
            logData[4].fieldName = "イベント説明";
            logData[4].beforeValue = beforeResult[0].eventDescription;
            logData[4].afterValue = eventDescription;
            logData[5] = {};
            logData[5].fieldName = "イベント開始日";
            logData[5].beforeValue = beforeResult[0].eventStartDate;
            logData[5].afterValue = eventStartDate;
            logData[6] = {};
            logData[6].fieldName = "イベント終了日";
            logData[6].beforeValue = beforeResult[0].eventEndDate;
            logData[6].afterValue = eventEndDate;
            logData[7] = {};
            logData[7].fieldName = "イベント年度開始日";
            logData[7].beforeValue = beforeResult[0].eventFiscalStartDate;
            logData[7].afterValue = eventFiscalStartDate;
            logData[8] = {};
            logData[8].fieldName = "イベント年度終了日";
            logData[8].beforeValue = beforeResult[0].eventFiscalEndDate;
            logData[8].afterValue = eventFiscalEndDate;
            logData[9] = {};
            logData[9].fieldName = "イベント顧客データ削除設定";
            logData[9].beforeValue = beforeResult[0].eventCustomerDeleteFlag;
            logData[9].afterValue = eventCustomerDeleteFlag;
            logData[10] = {};
            logData[10].fieldName = "イベント顧客データ削除指定日数";
            logData[10].beforeValue = beforeResult[0].eventCustomerDeleteValue;
            logData[10].afterValue = eventCustomerDeleteValue;
            logData[11] = {};
            logData[11].fieldName = "メールフラグ";
            logData[11].beforeValue = beforeResult[0].eventMailFlag;
            logData[11].afterValue = eventMailFlag;
            logData[12] = {};
            logData[12].fieldName = "リマインドメール送信設定";
            logData[12].beforeValue = beforeResult[0].eventReminderSendFlag;
            logData[12].afterValue = eventReminderSendFlag;
            logData[13] = {};
            logData[13].fieldName = "リマインドメール送信指定日数";
            logData[13].beforeValue = beforeResult[0].eventReminderSendValue;
            logData[13].afterValue = eventReminderSendValue;
            logData[14] = {};
            logData[14].fieldName = "トークン1";
            logData[14].beforeValue = beforeResult[0].token1FieldId;
            logData[14].afterValue = token1FieldId;
            logData[15] = {};
            logData[15].fieldName = "トークン2";
            logData[15].beforeValue = beforeResult[0].token2FieldId;
            logData[15].afterValue = token2FieldId;
            logData[16] = {};
            logData[16].fieldName = "トークン3";
            logData[16].beforeValue = beforeResult[0].token3FieldId;
            logData[16].afterValue = token3FieldId;
            logData[17] = {};
            logData[17].fieldName = "イベント画像1";
            logData[17].beforeValue = beforeResult[0].eventImageURL1;
            logData[17].afterValue = eventImageURL1;
            logData[18] = {};
            logData[18].fieldName = "イベント画像2";
            logData[18].beforeValue = beforeResult[0].eventImageURL2;
            logData[18].afterValue = eventImageURL2;
            logData[19] = {};
            logData[19].fieldName = "イベント画像3";
            logData[19].beforeValue = beforeResult[0].eventImageURL3;
            logData[19].afterValue = eventImageURL3;
            logData[20] = {};
            logData[20].fieldName = "メモ";
            logData[20].beforeValue = beforeResult[0].memo;
            logData[20].afterValue = memo;

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE Event SET
                eventName = ?,
                eventOverview = ?,
                eventDescription = ?,
                eventStartDate = ?,
                eventEndDate = ?,
                eventFiscalStartDate = ?,
                eventFiscalEndDate = ?,
                eventImageURL1 = ?,
                eventImageURL2 = ?,
                eventImageURL3 = ?,
                eventCustomerDeleteFlag = ?,
                eventCustomerDeleteValue = ?,
                eventMailFlag = ?,
                eventReminderSendFlag = ?,
                eventReminderSendValue = ?,
                token1FieldId = ?,
                token2FieldId = ?,
                token3FieldId = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE eventId = ? AND projectId = ?;`;
            let sql_param = [
                eventName,
                eventOverview,
                eventDescription,
                eventStartDate,
                eventEndDate,
                eventFiscalStartDate,
                eventFiscalEndDate,
                eventImageURL1,
                eventImageURL2,
                eventImageURL3,
                eventCustomerDeleteFlag,
                eventCustomerDeleteValue,
                eventMailFlag,
                eventReminderSendFlag,
                eventReminderSendValue,
                token1FieldId,
                token2FieldId,
                token3FieldId,
                memo,
                updatedAt,
                updatedBy,
                eventId,
                projectId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     console.log("Found set already deleted");
            //     await mysql_con.rollback();
            //     // failure log
            //     await createLog(context, 'イベント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'イベント', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'イベント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'イベント', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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