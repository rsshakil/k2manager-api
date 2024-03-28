/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();
const crypto = require('crypto');

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2adminimages';

/**
 * ManagerEventCreate.
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

    let {
        projectId
    } = JSON.parse(event.body);
    const {
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
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;

    let mysql_con;
    try {
        // イベントのコピー処理
        if (event.pathParameters?.eventId) {
            projectId = event.queryStringParameters?.pid;

            let validProjectId;
            if (event?.requestContext?.authorizer?.pid) {
                validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
                // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
                if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                    // failure log
                    console.log("イベント複製失敗 pid", projectId);
                    console.log("イベント複製失敗 validProjectId", validProjectId);
                    await createLog(context, 'イベント', '複製', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // イベントデータ取得
            // get event data
            let param_event = [];
            let eventId = event.pathParameters?.eventId;
            const sql_event = `SELECT * FROM Event WHERE Event.eventId = ? AND Event.projectId = ?`;
            param_event.push(Number(eventId));
            param_event.push(Number(projectId));

            let [query_result] = await mysql_con.query(sql_event, param_event);
            if (query_result && query_result[0]) {
                const {
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
                    memo
                } = query_result[0];
                logAccountId = createdBy;
                // insert data query
                let sql_copy_event = `INSERT INTO Event (
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
                    loginUserCount,
                    reservationUserCount,
                    cancelUserCount,
                    eventCustomerDeleteFlag,
                    eventCustomerDeleteValue,
                    eventMailFlag,
                    eventReminderSendFlag,
                    eventReminderSendValue,
                    token1FieldId,
                    token2FieldId,
                    token3FieldId,
                    memo,
                    createdAt,
                    createdBy,
                    updatedAt,
                    updatedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

                let newEventImageURL1 = await copyImage(eventImageURL1);
                let newEventImageURL2 = await copyImage(eventImageURL2);
                let newEventImageURL3 = await copyImage(eventImageURL3);

                // created date
                const createdAt = Math.floor(new Date().getTime() / 1000);
                let param_copy_event = [
                    projectId,
                    eventName + "（コピー）",
                    eventOverview,
                    eventDescription,
                    eventStartDate,
                    eventEndDate,
                    eventFiscalStartDate,
                    eventFiscalEndDate,
                    newEventImageURL1,
                    newEventImageURL2,
                    newEventImageURL3,
                    0,
                    0,
                    0,
                    eventCustomerDeleteFlag,
                    eventCustomerDeleteValue,
                    eventMailFlag,
                    eventReminderSendFlag,
                    eventReminderSendValue,
                    token1FieldId,
                    token2FieldId,
                    token3FieldId,
                    memo,
                    createdAt,
                    createdBy,
                    createdAt,
                    createdBy,
                ];
                // console.log("sql_copy_event:", sql_copy_event);
                // console.log("param_copy_event:", param_copy_event);
                const [result_copy_event] = await mysql_con.execute(sql_copy_event, param_copy_event);
                let newEventId = result_copy_event.insertId;

                let params = {
                    projectId: projectId,
                    eventId: eventId,
                    newEventId: newEventId,
                    createdAt: createdAt,
                    createdBy: createdBy
                };

                let payload = JSON.stringify(params);
                console.log(payload);
                let invokeParams = {
                    FunctionName: "ManagerEventCopy-" + process.env.ENV,
                    InvocationType: "Event",
                    Payload: payload
                };
                // invoke lambda
                let result = lambda.invoke(invokeParams).promise();
                // console.log("==========result", result)
                // if (result.$response.error) throw (500, result.$response.error.message);

                // ログ書き込み
                logData[0] = {};
                logData[0].fieldName = "プロジェクトID";
                logData[0].beforeValue = projectId;
                logData[0].afterValue = projectId;
                logData[1] = {};
                logData[1].fieldName = "イベントID";
                logData[1].beforeValue = eventId;
                logData[1].afterValue = newEventId;

                await mysql_con.commit();

                // construct the response
                let response = {
                    records: query_result[0]
                };
                console.log("response:", response);
                await createLog(context, 'イベント', '複製', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'イベント', '複製', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        }
        // イベントの新規作成
        else {
            let validProjectId;
            if (event?.requestContext?.authorizer?.pid) {
                validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
                // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
                if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                    // failure log
                    console.log("イベント作成失敗 pid", projectId);
                    console.log("イベント作成失敗 validProjectId", validProjectId);
                    await createLog(context, 'イベント', '作成', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = "";
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "イベントコード";
            logData[1].beforeValue = "";
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "イベント名";
            logData[2].beforeValue = "";
            logData[2].afterValue = eventName;
            logData[3] = {};
            logData[3].fieldName = "イベント説明";
            logData[3].beforeValue = "";
            logData[3].afterValue = eventOverview;
            logData[4] = {};
            logData[4].fieldName = "イベント説明";
            logData[4].beforeValue = "";
            logData[4].afterValue = eventDescription;
            logData[5] = {};
            logData[5].fieldName = "イベント開始日";
            logData[5].beforeValue = "";
            logData[5].afterValue = eventStartDate;
            logData[6] = {};
            logData[6].fieldName = "イベント終了日";
            logData[6].beforeValue = "";
            logData[6].afterValue = eventEndDate;
            logData[7] = {};
            logData[7].fieldName = "イベント年度開始日";
            logData[7].beforeValue = "";
            logData[7].afterValue = eventFiscalStartDate;
            logData[8] = {};
            logData[8].fieldName = "イベント年度終了日";
            logData[8].beforeValue = "";
            logData[8].afterValue = eventFiscalEndDate;
            logData[9] = {};
            logData[9].fieldName = "イベント顧客データ削除設定";
            logData[9].beforeValue = "";
            logData[9].afterValue = eventCustomerDeleteFlag;
            logData[10] = {};
            logData[10].fieldName = "イベント顧客データ削除指定日数";
            logData[10].beforeValue = "";
            logData[10].afterValue = eventCustomerDeleteValue;
            logData[11] = {};
            logData[11].fieldName = "メールフラグ";
            logData[11].beforeValue = "";
            logData[11].afterValue = eventMailFlag;
            logData[12] = {};
            logData[12].fieldName = "リマインドメール送信設定";
            logData[12].beforeValue = "";
            logData[12].afterValue = eventReminderSendFlag;
            logData[13] = {};
            logData[13].fieldName = "リマインドメール送信指定日数";
            logData[13].beforeValue = "";
            logData[13].afterValue = eventReminderSendValue;
            logData[14] = {};
            logData[14].fieldName = "トークン1";
            logData[14].beforeValue = "";
            logData[14].afterValue = token1FieldId;
            logData[15] = {};
            logData[15].fieldName = "トークン2";
            logData[15].beforeValue = "";
            logData[15].afterValue = token2FieldId;
            logData[16] = {};
            logData[16].fieldName = "トークン3";
            logData[16].beforeValue = "";
            logData[16].afterValue = token3FieldId;
            logData[17] = {};
            logData[17].fieldName = "イベント画像1";
            logData[17].beforeValue = "";
            logData[17].afterValue = eventImageURL1;
            logData[18] = {};
            logData[18].fieldName = "イベント画像2";
            logData[18].beforeValue = "";
            logData[18].afterValue = eventImageURL2;
            logData[19] = {};
            logData[19].fieldName = "イベント画像3";
            logData[19].beforeValue = "";
            logData[19].afterValue = eventImageURL3;
            logData[20] = {};
            logData[20].fieldName = "メモ";
            logData[20].beforeValue = "";
            logData[20].afterValue = memo;

            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
/*
            // event code uniqueness check
            // get count query
            let count_sql = `SELECT COUNT(eventId) FROM Event WHERE eventCode = ?;`;
            // get count
            let [query_count_result] = await mysql_con.execute(count_sql, [eventCode]);
            let data_count = Object.values(query_count_result[0]);
            console.log("same eventCode records count", data_count);
            // Check if the data already exists
            if (data_count > 0) {
                // Already exists, send error response
                console.log("Already exists eventCode");
                // failure log
                await createLog(context, 'イベント', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "AccessControlAllowOrigin": "*",
                        "AccessControlAllowHeaders": "*",
                    },
                    body: JSON.stringify({
                        message: "Duplicate event code",
                        errorCode: 301
                    }),
                };
            }
*/
            /*
            イベント名の重複は問題なし
            // event name uniqueness check
            // get count query
            let count_sql2 = `SELECT COUNT(eventId) FROM Event WHERE eventName = ?;`;
            // get count
            let [query_count_result] = await mysql_con.execute(count_sql2, [eventName]);
            let data_count2 = Object.values(query_count_result[0]);
            console.log("same eventName records count ", data_count2);
            // Check if the event name already exists
            if (data_count2 > 0) {
                // Already exists, send error response
                console.log("Already exists eventName");
                return {
                    statusCode: 409,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Duplicate event name",
                        errorCode: 201
                    }),
                };
            }
            */
            // insert data query
            let sql_data = `INSERT INTO Event (
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
                createdAt,
                createdBy,
                updatedAt,
                updatedBy
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
            // created date
            const createdAt = Math.floor(new Date().getTime() / 1000);
            let sql_param = [
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
                createdAt,
                createdBy,
                createdAt,
                updatedBy,
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);
            const [query_result] = await mysql_con.execute(sql_data, sql_param);
            if (query_result.length === 0) {
                // failure log
                await createLog(context, 'イベント', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'イベント', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(response),
            };
        }
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
        // failure log
        await createLog(context, 'イベント', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

async function copyImage(imageURL) {
    // if have the image url
    if (imageURL !== null && imageURL !== '') {
        // get split file path
        const pathSplitArray = imageURL.split('/');
        // get file name
        const fileName = pathSplitArray[pathSplitArray.length - 1];
        // get file extension
        const fileNameArray = fileName.split(/(?=\.[^.]+$)/);

        // Generate random file name
        const S = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        const N = 16;
        // This is new file name
        let randomStr = Array.from(crypto.randomFillSync(new Uint32Array(N))).map((n) => S[n % S.length]).join('');
        let newFileName = randomStr + fileNameArray[fileNameArray.length - 1];

        try {
            let params = {
                Bucket: BUCKET,
                CopySource: `${BUCKET}/${fileName}`,
                Key: newFileName
            };
            await s3.copyObject(params, function (err, data) {
                if (err) {
                    // an error occurred
                    console.log(err, err.stack);
                    // throw err;
                } else {
                    // successful response
                    console.log(data);
                }
            });
            let newImageURL = '';
            for (let index = 0; index < pathSplitArray.length -1; index++) {
                const element = pathSplitArray[index];
                if (newImageURL === '') {
                    newImageURL = `${element}`;
                } else {
                    newImageURL = `${newImageURL}/${element}`;
                }
            }
            return `${newImageURL}/${newFileName}`;
        } catch (error) {
            console.log("error:", error);
            throw error;
        }
    }

    return imageURL;
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