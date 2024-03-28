/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();

process.env.TZ = "Asia/Tokyo";
const BUCKET = 'k2adminimages';

/**
 * ManagerEventDelete.
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
    let jsonBody = event.queryStringParameters;
    projectId = jsonBody?.pid;

    if (event.pathParameters?.eventId) {
        console.log("eventId: ", event.pathParameters?.eventId);
        logAccountId = JSON.parse(event.body).deletedBy;
        // Expand GET parameters
        console.log("event.queryStringParameters:", jsonBody);
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'イベント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'イベント', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let eventId = event.pathParameters?.eventId;
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();

            // 利用している場合削除できない
            // APP
            let sql_data = `SELECT COUNT(appId) AS count FROM App WHERE eventId = ?`;
            var [query_result] = await mysql_con.query(sql_data, [eventId]);
            if (query_result[0].count >= 1) {
                console.log("This data cannot be deleted because it is used in an app");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'イベント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "event are used in an app.",
                        errorCode: 109
                    }),
                };
            }

            // 削除データの取得
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Event WHERE eventId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'イベント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "イベントID";
            logData[1].beforeValue = beforeResult[0].eventId;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "イベントコード";
            logData[2].beforeValue = beforeResult[0].eventCode;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "イベント名";
            logData[3].beforeValue = beforeResult[0].eventName;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "イベント説明";
            logData[4].beforeValue = beforeResult[0].eventOverview;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "イベント説明";
            logData[5].beforeValue = beforeResult[0].eventDescription;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "イベント開始日";
            logData[6].beforeValue = beforeResult[0].eventStartDate;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "イベント終了日";
            logData[7].beforeValue = beforeResult[0].eventEndDate;
            logData[7].afterValue = "";
            logData[8] = {};
            logData[8].fieldName = "イベント年度開始日";
            logData[8].beforeValue = beforeResult[0].eventFiscalStartDate;
            logData[8].afterValue = "";
            logData[9] = {};
            logData[9].fieldName = "イベント年度終了日";
            logData[9].beforeValue = beforeResult[0].eventFiscalEndDate;
            logData[9].afterValue = "";
            logData[10] = {};
            logData[10].fieldName = "イベント顧客データ削除設定";
            logData[10].beforeValue = beforeResult[0].eventCustomerDeleteFlag;
            logData[10].afterValue = "";
            logData[11] = {};
            logData[11].fieldName = "イベント顧客データ削除指定日数";
            logData[11].beforeValue = beforeResult[0].eventCustomerDeleteValue;
            logData[11].afterValue = "";
            logData[12] = {};
            logData[12].fieldName = "メールフラグ";
            logData[12].beforeValue = beforeResult[0].eventMailFlag;
            logData[12].afterValue = "";
            logData[13] = {};
            logData[13].fieldName = "リマインドメール送信設定";
            logData[13].beforeValue = beforeResult[0].eventReminderSendFlag;
            logData[13].afterValue = "";
            logData[14] = {};
            logData[14].fieldName = "リマインドメール送信指定日数";
            logData[14].beforeValue = beforeResult[0].eventReminderSendValue;
            logData[14].afterValue = "";
            logData[15] = {};
            logData[15].fieldName = "ログイン数";
            logData[15].beforeValue = beforeResult[0].loginUserCount;
            logData[15].afterValue = "";
            logData[16] = {};
            logData[16].fieldName = "予約数";
            logData[16].beforeValue = beforeResult[0].reservationUserCount;
            logData[16].afterValue = "";
            logData[17] = {};
            logData[17].fieldName = "キャンセル数";
            logData[17].beforeValue = beforeResult[0].cancelUserCount;
            logData[17].afterValue = "";
            logData[18] = {};
            logData[18].fieldName = "トークン1";
            logData[18].beforeValue = beforeResult[0].token1FieldId;
            logData[18].afterValue = "";
            logData[19] = {};
            logData[19].fieldName = "トークン2";
            logData[19].beforeValue = beforeResult[0].token2FieldId;
            logData[19].afterValue = "";
            logData[20] = {};
            logData[20].fieldName = "トークン3";
            logData[20].beforeValue = beforeResult[0].token3FieldId;
            logData[20].afterValue = "";
            logData[21] = {};
            logData[21].fieldName = "イベント画像1";
            logData[21].beforeValue = beforeResult[0].eventImageURL1;
            logData[21].afterValue = "";
            logData[22] = {};
            logData[22].fieldName = "イベント画像2";
            logData[22].beforeValue = beforeResult[0].eventImageURL2;
            logData[22].afterValue = "";
            logData[23] = {};
            logData[23].fieldName = "イベント画像3";
            logData[23].beforeValue = beforeResult[0].eventImageURL3;
            logData[23].afterValue = "";
            logData[24] = {};
            logData[24].fieldName = "メモ";
            logData[24].beforeValue = beforeResult[0].memo;
            logData[24].afterValue = "";

            let sql_event_del = `DELETE from Event WHERE eventId = ?`;
            await mysql_con.query(sql_event_del, [eventId]);

            await mysql_con.commit();

            let params = {
                projectId: projectId,
                eventId: eventId
            };

            let payload = JSON.stringify(params);
            console.log(payload);
            let invokeParams = {
                FunctionName: "ManagerEventDeleteBatch-" + process.env.ENV,
                InvocationType: "Event",
                Payload: payload
            };
            // invoke lambda
            let result = lambda.invoke(invokeParams).promise();

            let deleteImageURLs = [];
            if (beforeResult[0].eventImageURL1 !== null && beforeResult[0].eventImageURL1 !== '') deleteImageURLs.push(beforeResult[0].eventImageURL1);
            if (beforeResult[0].eventImageURL2 !== null && beforeResult[0].eventImageURL2 !== '') deleteImageURLs.push(beforeResult[0].eventImageURL2);
            if (beforeResult[0].eventImageURL3 !== null && beforeResult[0].eventImageURL3 !== '') deleteImageURLs.push(beforeResult[0].eventImageURL3);
            // loop on the list obtained
            for (let index = 0; index < deleteImageURLs.length; index++) {
                const element = deleteImageURLs[index];
                // get split file path
                const pathSplitArray = element.split('/');
                // get file name
                const fileName = pathSplitArray[pathSplitArray.length - 1];
                try {
                    // delete CSV file from S3
                    await s3.deleteObject(
                        {
                            Bucket: BUCKET,
                            Key: fileName
                        }).promise().catch(err => {
                            throw new Error(err);
                        });
                } catch (err) {
                    console.log(err);
                }
            }

            // success log
            await createLog(context, 'イベント', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify({ "message": "delete success" }),
            };
        } catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'イベント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'イベント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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