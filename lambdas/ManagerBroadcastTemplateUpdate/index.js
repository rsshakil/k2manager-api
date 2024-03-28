/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const CS = require('@aws-sdk/client-scheduler');
const schedulerClient = new CS.SchedulerClient({ region: "ap-northeast-1" });
const PREFIX_GROUP_NAME = "ScheduleGroupForProject";
const PREFIX_SCHEDULE_NAME = "ScheduleForBroadcast";
const ROLE_ARN = "arn:aws:iam::134712758746:role/k2-scheduler-role";
const EVENT_ARN = "arn:aws:lambda:ap-northeast-1:134712758746:function:BroadcastSenderFunction-" + process.env.ENV;

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBroadcastTemplateUpdate.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logDataBroadcast = [];
    let logDataBroadcastTemplate = [];
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

    const broadcastId = event.pathParameters.broadcastId;
    console.log("broadcastId:", broadcastId);
    const {
        projectId,
        broadcastTemplateTitle,
        broadcastTemplateFrom,
        broadcastTemplateSubject,
        broadcastTemplateBody,
        memo,
        broadcastScheduleDatetime,
        updatedBy,
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    if (!projectId) {
        let error = "invalid parameter. Project ID not found.";
        // failure log
        await createLog(context, '一斉送信テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcastTemplate);
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
            await createLog(context, '一斉送信テンプレート', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcastTemplate);
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

    const updatedAt = Math.floor(new Date().getTime() / 1000);

    // 0 = create, 1 = update
    let methodType = 0;
    let query_result_broadcast_template;
    let mysql_con;
    try {
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        let beforeSqlBroadcastTemplate = `SELECT * from BroadcastTemplate WHERE broadcastId = ?`;
        let [beforeResultBroadcastTemplate] = await mysql_con.execute(beforeSqlBroadcastTemplate, [broadcastId]);
        let broadcastTemplateId;
        // Broadcast template is not found. Create new broadcast template.
        if (beforeResultBroadcastTemplate.length === 0) {
            let sql_insert_broadcast_template = `INSERT into BroadcastTemplate (
                projectId,
                broadcastId,
                broadcastTemplateTitle,
                broadcastTemplateFrom,
                broadcastTemplateSubject,
                broadcastTemplateBody,
                memo,
                createdAt,
                createdBy,
                updatedAt,
                updatedBy
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
            let param_insert_broadcast_template = [
                projectId,
                broadcastId,
                broadcastTemplateTitle,
                broadcastTemplateFrom,
                broadcastTemplateSubject,
                broadcastTemplateBody,
                memo,
                updatedAt,
                updatedBy,
                updatedAt,
                updatedBy
            ];
            console.log("sql_insert_broadcast_template:", sql_insert_broadcast_template);
            console.log("param_insert_broadcast_template:", param_insert_broadcast_template);

            [query_result_broadcast_template] = await mysql_con.execute(sql_insert_broadcast_template, param_insert_broadcast_template);

            // get inserted Id
            broadcastTemplateId = query_result_broadcast_template.insertId;

            logDataBroadcastTemplate[0] = {};
            logDataBroadcastTemplate[0].fieldName = "プロジェクトID";
            logDataBroadcastTemplate[0].beforeValue = "";
            logDataBroadcastTemplate[0].afterValue = projectId;
            logDataBroadcastTemplate[1] = {};
            logDataBroadcastTemplate[1].fieldName = "一斉送信ID";
            logDataBroadcastTemplate[1].beforeValue = "";
            logDataBroadcastTemplate[1].afterValue = broadcastId;
            logDataBroadcastTemplate[2] = {};
            logDataBroadcastTemplate[2].fieldName = "一斉送信タイトル";
            logDataBroadcastTemplate[2].beforeValue = "";
            logDataBroadcastTemplate[2].afterValue = broadcastTemplateTitle;
            logDataBroadcastTemplate[3] = {};
            logDataBroadcastTemplate[3].fieldName = "一斉送信テンプレート差出人";
            logDataBroadcastTemplate[3].beforeValue = "";
            logDataBroadcastTemplate[3].afterValue = broadcastTemplateFrom;
            logDataBroadcastTemplate[4] = {};
            logDataBroadcastTemplate[4].fieldName = "一斉送信テンプレート件名";
            logDataBroadcastTemplate[4].beforeValue = "";
            logDataBroadcastTemplate[4].afterValue = broadcastTemplateSubject;
            logDataBroadcastTemplate[5] = {};
            logDataBroadcastTemplate[5].fieldName = "一斉送信テンプレート本文";
            logDataBroadcastTemplate[5].beforeValue = "";
            logDataBroadcastTemplate[5].afterValue = broadcastTemplateBody;
            logDataBroadcastTemplate[6] = {};
            logDataBroadcastTemplate[6].fieldName = "メモ";
            logDataBroadcastTemplate[6].beforeValue = "";
            logDataBroadcastTemplate[6].afterValue = memo;
        }
        // Broadcast template is found. Update broadcast template.
        else {
            methodType = 1;
            // get broadcast template Id
            broadcastTemplateId = beforeResultBroadcastTemplate[0].broadcastTemplateId;

            // update broadcast template
            let sql_update_broadcast_template = `UPDATE BroadcastTemplate SET broadcastTemplateTitle = ?, broadcastTemplateFrom = ?, broadcastTemplateSubject = ?, broadcastTemplateBody = ?, memo = ?, updatedAt = ?, updatedBy = ? WHERE broadcastId = ?;`;
            let param_update_broadcast_template = [
                broadcastTemplateTitle,
                broadcastTemplateFrom,
                broadcastTemplateSubject,
                broadcastTemplateBody,
                memo,
                updatedAt,
                updatedBy,
                broadcastId
            ];
            console.log("sql_update_broadcast_template:", sql_update_broadcast_template);
            console.log("param_update_broadcast_template:", param_update_broadcast_template);

            [query_result_broadcast_template] = await mysql_con.execute(sql_update_broadcast_template, param_update_broadcast_template);

            logDataBroadcastTemplate[0] = {};
            logDataBroadcastTemplate[0].fieldName = "プロジェクトID";
            logDataBroadcastTemplate[0].beforeValue = beforeResultBroadcastTemplate[0].projectId;
            logDataBroadcastTemplate[0].afterValue = projectId;
            logDataBroadcastTemplate[1] = {};
            logDataBroadcastTemplate[1].fieldName = "一斉送信ID";
            logDataBroadcastTemplate[1].beforeValue = beforeResultBroadcastTemplate[0].broadcastId;
            logDataBroadcastTemplate[1].afterValue = broadcastId;
            logDataBroadcastTemplate[2] = {};
            logDataBroadcastTemplate[2].fieldName = "一斉送信タイトル";
            logDataBroadcastTemplate[2].beforeValue = beforeResultBroadcastTemplate[0].broadcastTemplateTitle;
            logDataBroadcastTemplate[2].afterValue = broadcastTemplateTitle;
            logDataBroadcastTemplate[3] = {};
            logDataBroadcastTemplate[3].fieldName = "一斉送信テンプレート差出人";
            logDataBroadcastTemplate[3].beforeValue = beforeResultBroadcastTemplate[0].broadcastTemplateFrom;
            logDataBroadcastTemplate[3].afterValue = broadcastTemplateFrom;
            logDataBroadcastTemplate[4] = {};
            logDataBroadcastTemplate[4].fieldName = "一斉送信テンプレート件名";
            logDataBroadcastTemplate[4].beforeValue = beforeResultBroadcastTemplate[0].broadcastTemplateSubject;
            logDataBroadcastTemplate[4].afterValue = broadcastTemplateSubject;
            logDataBroadcastTemplate[5] = {};
            logDataBroadcastTemplate[5].fieldName = "一斉送信テンプレート本文";
            logDataBroadcastTemplate[5].beforeValue = beforeResultBroadcastTemplate[0].broadcastTemplateBody;
            logDataBroadcastTemplate[5].afterValue = broadcastTemplateBody;
            logDataBroadcastTemplate[6] = {};
            logDataBroadcastTemplate[6].fieldName = "メモ";
            logDataBroadcastTemplate[6].beforeValue = beforeResultBroadcastTemplate[0].memo;
            logDataBroadcastTemplate[6].afterValue = memo;
        }

        let beforeSqlBroadcast = `SELECT * from BroadcastTemplate WHERE broadcastId = ?`;
        let [beforeResultBroadcast] = await mysql_con.execute(beforeSqlBroadcast, [broadcastId]);
        // update broadcast
        let sql_update_broadcast = `UPDATE Broadcast SET broadcastScheduleDatetime = ?, broadcastEditDatetime = ?, updatedAt = ?, updatedBy = ? WHERE broadcastId = ?;`;
        let param_update_broadcast = [
            broadcastScheduleDatetime !== 0 ? broadcastScheduleDatetime : null,
            updatedAt,
            updatedAt,
            updatedBy,
            broadcastId
        ];
        console.log("sql_update_broadcast:", sql_update_broadcast);
        console.log("param_update_broadcast:", param_update_broadcast);

        let [query_result_update_broadcast] = await mysql_con.execute(sql_update_broadcast, param_update_broadcast);

        logDataBroadcast[0] = {};
        logDataBroadcast[0].fieldName = "プロジェクトID";
        logDataBroadcast[0].beforeValue = beforeResultBroadcast[0].projectId;
        logDataBroadcast[0].afterValue = projectId;
        logDataBroadcast[1] = {};
        logDataBroadcast[1].fieldName = "一斉送信ID";
        logDataBroadcast[1].beforeValue = beforeResultBroadcast[0].broadcastId;
        logDataBroadcast[1].afterValue = broadcastId;
        logDataBroadcast[2] = {};
        logDataBroadcast[2].fieldName = "一斉送信予約日時";
        logDataBroadcast[2].beforeValue = beforeResultBroadcast[0].broadcastScheduleDatetime;
        logDataBroadcast[2].afterValue = broadcastScheduleDatetime;
        logDataBroadcast[3] = {};
        logDataBroadcast[3].fieldName = "一斉送信編集日時";
        logDataBroadcast[3].beforeValue = beforeResultBroadcast[0].broadcastEditDatetime;
        logDataBroadcast[3].afterValue = updatedAt;

        // Create or update or delete schedular
        await createUpdateSchedule(broadcastTemplateId, broadcastTemplateTitle);

        await mysql_con.commit();
        // construct the response
        let response = {
            records: query_result_broadcast_template[0]
        };
        console.log("response:", response);

        // success log
        await createLog(context, '一斉送信テンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcastTemplate);
        await createLog(context, '一斉送信', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcast);
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
        await createLog(context, '一斉送信テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logDataBroadcastTemplate);
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

    /**
     * create and update broadcast schedule.
     * 
     * @param {*} broadcastTemplateId
     * @param {*} broadcastTemplateTitle
     * @returns 
     */
    async function createUpdateSchedule(broadcastTemplateId, broadcastTemplateTitle) {

        // Scheduler Settings Start ================================================================================

        // define scheduler group name
        const groupName = PREFIX_GROUP_NAME + projectId + "-" + process.env.ENV;
        // get scheduler group
        let schedulerGroupList = await schedulerClient.send(new CS.ListScheduleGroupsCommand({ NamePrefix: groupName }));
        // console.log("=========== schedulerGroupList", schedulerGroupList)
        // group does not exist
        if (schedulerGroupList.ScheduleGroups.length === 0) {
            // create scheduler group
            await schedulerClient.send(new CS.CreateScheduleGroupCommand({ Name: groupName }));
        }
        // define schedule name
        const scheduleName = PREFIX_SCHEDULE_NAME + broadcastTemplateId + "-" + process.env.ENV;

        const inputParam = {
            "projectId": projectId,
            "broadcastId": broadcastId
        };

        const timing = broadcastScheduleDatetime ? prepareTime(broadcastScheduleDatetime * 1000) : null;

        // get schedule
        let schedulerList = await schedulerClient.send(new CS.ListSchedulesCommand({ GroupName: groupName, NamePrefix: scheduleName }));
        console.log("=========== schedulerList", schedulerList);
        console.log("broadcastScheduleDatetime", broadcastScheduleDatetime);
        // Schedule command exist
        if (schedulerList.Schedules.length !== 0) {
            // Schedule date-time exist --> this time update shedule command
            if (broadcastScheduleDatetime) {
                console.log("updateScheduleCmd");
                await updateScheduleCmd(scheduleName, groupName, inputParam, broadcastTemplateTitle, timing);
            }
            // Schedule date-time not exist --> this time delete shedule command
            else {
                console.log("deleteScheduleCmd");
                await deleteScheduleCmd(scheduleName, groupName);
            }
        }
        // Schedule command not exist
        else {
            // Schedule date-time exist --> this time create shedule command
            if (broadcastScheduleDatetime) {
                console.log("createScheduleCmd");
                await createScheduleCmd(scheduleName, groupName, inputParam, broadcastTemplateTitle, timing);
            }
        }

        // Scheduler Settings End   ================================================================================

        return scheduleName;
    }
};

function prepareTime(broadcastScheduleDatetime) {
    let dateFormat = new Date(broadcastScheduleDatetime);
    let day = `${dateFormat.getDate()}`;
    let month = `${dateFormat.getMonth() + 1}`;
    day = day.length == 1 ? `0${day}` : day;
    month = month.length == 1 ? `0${month}` : month;
    let hour = `${dateFormat.getHours()}`;
    hour = hour.length === 1 ? `0${hour}` : hour;
    let min = `${dateFormat.getMinutes()}`;
    min = min.length === 1 ? `0${min}` : min;
    return `${dateFormat.getFullYear()}-${month}-${day}T${hour}:${min}:00`;
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

// Create schedule command 
async function createScheduleCmd(scheduleName, groupName, inputParam, broadcastTemplateTitle, timing) {
    try {
        await schedulerClient.send(new CS.CreateScheduleCommand({
            Name: scheduleName,
            GroupName: groupName,
            Target: {
                RoleArn: ROLE_ARN,
                Arn: EVENT_ARN,
                Input: JSON.stringify(Object.assign({}, inputParam)),
            },
            FlexibleTimeWindow: {
                Mode: CS.FlexibleTimeWindowMode.OFF,
            },
            Description: "一斉送信タイトル名: " + broadcastTemplateTitle + "\n" + timing,
            ScheduleExpression: `at(${timing})`,
            ScheduleExpressionTimezone: process.env.TZ,
        }));
    } catch (error) {
        console.log("Create schedule cmd error");
    }
}

// Update schedule command
async function updateScheduleCmd(scheduleName, groupName, inputParam, broadcastTemplateTitle, timing) {
    try {
        await schedulerClient.send(new CS.UpdateScheduleCommand({
            Name: scheduleName,
            GroupName: groupName,
            Target: {
                RoleArn: ROLE_ARN,
                Arn: EVENT_ARN,
                Input: JSON.stringify(Object.assign({}, inputParam)),
            },
            FlexibleTimeWindow: {
                Mode: CS.FlexibleTimeWindowMode.OFF,
            },
            Description: "一斉送信タイトル名: " + broadcastTemplateTitle + "\n" + timing,
            ScheduleExpression: `at(${timing})`,
            ScheduleExpressionTimezone: process.env.TZ,
        }));
    } catch (error) {
        console.log("Update schedule cmd error");
    }
}

async function deleteScheduleCmd(scheduleName, groupName) {
    try {
        // delete schedule
        await schedulerClient.send(new CS.DeleteScheduleCommand({
            Name: scheduleName,
            GroupName: groupName
        }));
    } catch (error) {
        console.log("Delete schedule cmd error");
    }
}