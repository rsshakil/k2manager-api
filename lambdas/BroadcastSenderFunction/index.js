/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const SES = require('aws-sdk/clients/ses');
const sesClient = new SES({ signatureVersion: 'v4', region: 'ap-northeast-1', });
const uuid = require('uuid');
const CS = require('@aws-sdk/client-scheduler');
const schedulerClient = new CS.SchedulerClient({ region: "ap-northeast-1" });
const PREFIX_GROUP_NAME = "ScheduleGroupForProject";
const PREFIX_SCHEDULE_NAME = "ScheduleForBroadcast";

process.env.TZ = "Asia/Tokyo";
process.env.AWS_REGION = "ap-northeast-1";

const BULK_SEND_LIMIT = 10;

/**
 * BroadcastSenderFunction.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
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
        charset: process.env.DBCHARSET
    };

    // mysql connect
    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);

        let projectId = event.projectId;
        let broadcastId = event.broadcastId;

        console.log("projectId", projectId);
        console.log("broadcastId", broadcastId);

        if (projectId === undefined || broadcastId === undefined || projectId === null || broadcastId === null) {
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

        let sql_param_broadcast = [];
        // get broadcast template
        let sql_data_broadcast = `SELECT
            Broadcast.broadcastType,
            Broadcast.broadcastStatus,
            BroadcastTemplate.broadcastTemplateId,
            BroadcastTemplate.broadcastTemplateFrom,
            BroadcastTemplate.broadcastTemplateSubject,
            BroadcastTemplate.broadcastTemplateBody,
            BroadcastUser.broadcastLastName,
            BroadcastUser.broadcastFirstName,
            BroadcastUser.broadcastEmailAddress,
            BroadcastUser.broadcastTelNo,
            BroadcastUser.broadcastAddress,
            BroadcastUser.broadcastVarious1,
            BroadcastUser.broadcastVarious2,
            BroadcastUser.broadcastVarious3,
            BroadcastUser.broadcastVarious4,
            BroadcastUser.broadcastVarious5,
            BroadcastUser.broadcastVarious6,
            BroadcastUser.broadcastVarious7,
            BroadcastUser.broadcastVarious8
        FROM
            Broadcast
            INNER JOIN BroadcastTemplate ON
                Broadcast.projectId = BroadcastTemplate.projectId
                AND Broadcast.broadcastId = BroadcastTemplate.broadcastId
            INNER JOIN BroadcastUser ON
                Broadcast.broadcastId = BroadcastUser.broadcastId
        WHERE
            Broadcast.projectId = ?
            AND Broadcast.broadcastId = ?`;

        // set query param
        sql_param_broadcast.push(projectId);
        sql_param_broadcast.push(broadcastId);

        console.log("sql_data_broadcast", sql_data_broadcast);
        console.log("sql_param_broadcast", sql_param_broadcast);

        // execute query
        let [query_result_broadcast] = await mysql_con.query(sql_data_broadcast, sql_param_broadcast);
        if (query_result_broadcast.length === 0) {
            // no broadcast template
            console.log("***************************** no broadcast template");
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify("no broadcast template"),
            };
        }
        console.log("query_result_broadcast", query_result_broadcast);

        // get query result
        let broadcastType = query_result_broadcast[0].broadcastType;
        let broadcastStatus = query_result_broadcast[0].broadcastStatus;
        let broadcastTemplateId = query_result_broadcast[0].broadcastTemplateId;
        let broadcastTemplateFrom = query_result_broadcast[0].broadcastTemplateFrom;
        let broadcastTemplateSubject = query_result_broadcast[0].broadcastTemplateSubject;
        let broadcastTemplateBody = query_result_broadcast[0].broadcastTemplateBody;

        // Other than unsent
        if (broadcastStatus !== 0) {
            console.log("Any status other than Not sent. broadcastStatus:" + broadcastStatus);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify("Any status other than Not sent. broadcastStatus:" + broadcastStatus),
            };
        }

        // Email
        if (broadcastType === 0) {
            // update broadcast
            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sqlUpdateBroadcast = `UPDATE Broadcast SET broadcastStatus = ?, updatedAt = ?, updatedBy = ? WHERE broadcastId = ?;`;
            let paramUpdateBroadcast = [
                3,
                updatedAt,
                "system",
                broadcastId
            ];
            console.log("sql_update_broadcast:", sqlUpdateBroadcast);
            console.log("param_update_broadcast:", paramUpdateBroadcast);

            let [query_result_update_broadcast] = await mysql_con.execute(sqlUpdateBroadcast, paramUpdateBroadcast);

            // create email template name with UUID (to avoid duplication)
            const templateName = uuid.v4();

            // create destination list
            const destinations = query_result_broadcast.map(v => {
                return {
                    "Destination": {
                        "ToAddresses": [
                            v.broadcastEmailAddress
                        ],
                    },
                    "ReplacementTemplateData": JSON.stringify({
                        broadcastLastName: v.broadcastLastName,
                        broadcastFirstName: v.broadcastFirstName,
                        broadcastEmailAddress: v.broadcastEmailAddress,
                        broadcastTelNo: v.broadcastTelNo,
                        broadcastAddress: v.broadcastAddress,
                        broadcastVarious1: v.broadcastVarious1,
                        broadcastVarious2: v.broadcastVarious2,
                        broadcastVarious3: v.broadcastVarious3,
                        broadcastVarious4: v.broadcastVarious4,
                        broadcastVarious5: v.broadcastVarious5,
                        broadcastVarious6: v.broadcastVarious6,
                        broadcastVarious7: v.broadcastVarious7,
                        broadcastVarious8: v.broadcastVarious8
                    })
                };
            });

            // sleep process
            const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            // The actual limit is 50, but the sending rate is 14 emails in 1 seconds, so the limit is 10.
            // 実際は50がリミットだが送信レートが1秒／14メールのため10件をリミットとする
            // Chunk by bulk send limit
            const destinationChunks = arrayChunk(destinations, BULK_SEND_LIMIT);

            // email template creation for bulk send
            await sesClient.createTemplate({
                Template: {
                    TemplateName: templateName,
                    SubjectPart: broadcastTemplateSubject,
                    TextPart: broadcastTemplateBody
                }
            }).promise();

            // Send bulk email
            for (let index = 0; index < destinationChunks.length; index++) {
                await sesClient.sendBulkTemplatedEmail({
                    Source: broadcastTemplateFrom,
                    Template: templateName,
                    Destinations: destinationChunks[index],
                    DefaultTemplateData: JSON.stringify({}),
                }).promise();

                // Sending rate is 14 emails in 1 seconds, so delay 1 second
                // 送信レートは 1秒で14メールなので、1秒遅延させる
                await _sleep(1000);
            }

            // delete email template
            await sesClient.deleteTemplate({
                TemplateName: templateName
            }).promise();

            // define scheduler group name
            const groupName = PREFIX_GROUP_NAME + projectId + "-" + process.env.ENV;
            // define schedule name
            const scheduleName = PREFIX_SCHEDULE_NAME + broadcastTemplateId + "-" + process.env.ENV;

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
        }
        // SMS
        else {
            // update broadcast
            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sqlUpdateBroadcast = `UPDATE Broadcast SET broadcastStatus = ?, updatedAt = ?, updatedBy = ? WHERE broadcastId = ?;`;
            let paramUpdateBroadcast = [
                3,
                updatedAt,
                "system",
                broadcastId
            ];
            console.log("sql_update_broadcast:", sqlUpdateBroadcast);
            console.log("param_update_broadcast:", paramUpdateBroadcast);

            let [query_result_update_broadcast] = await mysql_con.execute(sqlUpdateBroadcast, paramUpdateBroadcast);

            // create destination list
            const destinations = query_result_broadcast.map(v => {
                if (v.broadcastTelNo) {
                    let body = v.broadcastTemplateBody;
                    body = body.replace('{{broadcastLastName}}', v.broadcastLastName);
                    body = body.replace('{{broadcastFirstName}}', v.broadcastFirstName);
                    body = body.replace('{{broadcastEmailAddress}}', v.broadcastEmailAddress);
                    body = body.replace('{{broadcastTelNo}}', v.broadcastTelNo);
                    body = body.replace('{{broadcastAddress}}', v.broadcastAddress);
                    body = body.replace('{{broadcastVarious1}}', v.broadcastVarious1);
                    body = body.replace('{{broadcastVarious2}}', v.broadcastVarious2);
                    body = body.replace('{{broadcastVarious3}}', v.broadcastVarious3);
                    body = body.replace('{{broadcastVarious4}}', v.broadcastVarious4);
                    body = body.replace('{{broadcastVarious5}}', v.broadcastVarious5);
                    body = body.replace('{{broadcastVarious6}}', v.broadcastVarious6);
                    body = body.replace('{{broadcastVarious7}}', v.broadcastVarious7);
                    body = body.replace('{{broadcastVarious8}}', v.broadcastVarious8);
                    return {
                        telNo: v.broadcastTelNo,
                        body: body,
                    };
                }
            });

            // sleep process
            const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

            // Send SMS
            for (let index = 0; index < destinations.length; index++) {
                // console.log("destinations", destinations);
                await exports.sendSMS(destinations[index].telNo, destinations[index].body);
                // SNS送信レートは不明なので1秒遅延させる
                await _sleep(1000);
            }
        }

        // define scheduler group name
        const groupName = PREFIX_GROUP_NAME + projectId + "-" + process.env.ENV;
        // define schedule name
        const scheduleName = PREFIX_SCHEDULE_NAME + broadcastTemplateId + "-" + process.env.ENV;

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

        const updatedAt = Math.floor(new Date().getTime() / 1000);
        // update broadcast
        let sql_update_broadcast = `UPDATE Broadcast SET broadcastStatus = ?, updatedAt = ?, updatedBy = ? WHERE broadcastId = ?;`;
        let param_update_broadcast = [
            1,
            updatedAt,
            "system",
            broadcastId
        ];
        console.log("sql_update_broadcast:", sql_update_broadcast);
        console.log("param_update_broadcast:", param_update_broadcast);
        let mysql_con2 = await mysql.createConnection(writeDbConfig);
        let [query_result_update_broadcast] = await mysql_con2.execute(sql_update_broadcast, param_update_broadcast);

        // construct the response
        let response = {
            result: "success"
        };
        console.log("response:", response);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        console.log(error);
        // await mysql_con.rollback();
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

/**
 * sendSMS
 * 
 * @param {string} to - destination telNo
 * @param {string} body - sms body text
 * @returns {json} response
 */
exports.sendSMS = async (to, body) => {
    console.log("==================== sms");

    let phoneNumber = "+81" + String(to).slice(1);
    console.log("---------------phoneNumber", phoneNumber);
    // SMS setting
    let smsParams = {
        Message: body,
        PhoneNumber: phoneNumber
    };

    let payload = JSON.stringify(smsParams);
    console.log(payload);
    let invokeParams = {
        FunctionName: "sendSMS-" + process.env.ENV,
        InvocationType: "Event",
        Payload: payload
    };
    // invoke lambda
    let result = await lambda.invoke(invokeParams).promise();
    // console.log("==========result", result)
    if (result.$response.error) throw (500, result.$response.error.message);

    return result;
};

/**
 * 配列を指定した個数で分割.
 * Split array by specified number.
 *
 * @param array array
 * @param number size
 */
const arrayChunk = (array, size) => {
    const chunks = [];
    while (0 < array.length) {
        chunks.push(array.splice(0, size));
    }
    return chunks;
};