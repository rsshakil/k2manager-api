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
const PREFIX_SCHEDULE_NAME = "ScheduleForCSVExport";

const ROLE_ARN = "arn:aws:iam::134712758746:role/k2-scheduler-role";
const EVENT_ARN = "arn:aws:lambda:ap-northeast-1:134712758746:function:CSVGenerate-" + process.env.ENV;

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCsvExportTemplateUpdate.
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
        csvExportTemplateName,
        csvExportTemplateFileName,
        csvExportTemplateGenerationCycle,
        csvExportTemplateGenerationTiming,
        csvExportTemplateAutomaticDeletion,
        csvExportTemplatePassword,
        csvExportTemplateColumn,
        filterId,
        csvExportTemplateAuthRole,
        memo,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    if (event.pathParameters?.csvExportTemplateId) {
        let csvExportTemplateId = event.pathParameters.csvExportTemplateId;
        console.log("csvExportTemplateId:", csvExportTemplateId);

        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'CSV出力テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'CSV出力テンプレート', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // beforeDataの作成
            let beforeSql = `SELECT * FROM CsvExportTemplate WHERE csvExportTemplateId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [csvExportTemplateId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'CSV出力テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[1].fieldName = "CSVエクスポートテンプレート名";
            logData[1].beforeValue = beforeResult[0].csvExportTemplateName;
            logData[1].afterValue = csvExportTemplateName;
            logData[2] = {};
            logData[2].fieldName = "CSVエクスポートファイル名";
            logData[2].beforeValue = beforeResult[0].csvExportTemplateFileName;
            logData[2].afterValue = csvExportTemplateFileName;
            logData[3] = {};
            logData[3].fieldName = "CSV生成周期";
            logData[3].beforeValue = beforeResult[0].csvExportTemplateGenerationCycle;
            logData[3].afterValue = csvExportTemplateGenerationCycle;
            logData[4] = {};
            logData[4].fieldName = "CSV生成タイミング";
            logData[4].beforeValue = beforeResult[0].csvExportTemplateGenerationTiming;
            logData[4].afterValue = csvExportTemplateGenerationTiming;
            logData[5] = {};
            logData[5].fieldName = "CSV自動削除設定";
            logData[5].beforeValue = beforeResult[0].csvExportTemplateAutomaticDeletion;
            logData[5].afterValue = csvExportTemplateAutomaticDeletion;
            logData[6] = {};
            logData[6].fieldName = "CSVZIPパスワード";
            logData[6].beforeValue = beforeResult[0].csvExportTemplatePassword;
            logData[6].afterValue = csvExportTemplatePassword;
            logData[7] = {};
            logData[7].fieldName = "CSV出力フィールド";
            logData[7].beforeValue = beforeResult[0].csvExportTemplateColumn;
            logData[7].afterValue = csvExportTemplateColumn;
            logData[8] = {};
            logData[8].fieldName = "CSVフィルター設定";
            logData[8].beforeValue = beforeResult[0].filterId;
            logData[8].afterValue = filterId;
            logData[9] = {};
            logData[9].fieldName = "CSVエクスポートテンプレート権限";
            logData[7].beforeValue = beforeResult[0].csvExportTemplateAuthRole;
            logData[9].afterValue = csvExportTemplateAuthRole;
            logData[10] = {};
            logData[10].fieldName = "メモ";
            logData[10].beforeValue = beforeResult[0].memo;
            logData[10].afterValue = memo;

            // update data query
            let sql_data = `UPDATE CsvExportTemplate
                SET
                projectId = ?,
                csvExportTemplateName = ?,
                csvExportTemplateFileName = ?,
                csvExportTemplateGenerationCycle = ?,
                csvExportTemplateGenerationTiming = ?,
                csvExportTemplateAutomaticDeletion = ?,
                csvExportTemplatePassword = ?,
                csvExportTemplateColumn = ?,
                filterId = ?,
                csvExportTemplateAuthRole = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE csvExportTemplateId = ?`;
            // updated date
            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_param = [
                projectId,
                csvExportTemplateName,
                csvExportTemplateFileName,
                csvExportTemplateGenerationCycle,
                csvExportTemplateGenerationTiming,
                csvExportTemplateAutomaticDeletion,
                csvExportTemplatePassword,
                csvExportTemplateColumn,
                filterId,
                csvExportTemplateAuthRole,
                memo,
                updatedAt,
                updatedBy,
                csvExportTemplateId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            const [query_result] = await mysql_con.query(sql_data, sql_param);
            if (query_result.affectedRows === 0) {
                // failure log
                await createLog(context, 'CSV出力テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // define scheduler name
            const scheduleName = PREFIX_SCHEDULE_NAME + csvExportTemplateId + "-" + process.env.ENV;
            // get scheduler
            let schedulerList = await schedulerClient.send(new CS.ListSchedulesCommand({ GroupName: groupName, NamePrefix: scheduleName }));

            // Make AWS cron expression >>>> (minutes hours day_of_month month day_of_week year)
            let cycle = Number.parseInt(csvExportTemplateGenerationCycle, 10);
            let timing = Number.parseInt(csvExportTemplateGenerationTiming, 10);
            let cron = '';
            // Do not create
            if (cycle === 0) {
                // console.log("=========== schedulerList", schedulerList)
                // group does not exist
                if (schedulerList.Schedules.length !== 0) {
                    const command = new CS.DeleteScheduleCommand({ GroupName: groupName, Name: scheduleName });
                    const response = await schedulerClient.send(command);
                    console.log("response", response);
                }
            }
            else {
                if (cycle != 0) {
                    // every day
                    if (cycle === 1) {
                        // Run every day at X:00
                        cron = `cron(0 ${timing} * * ? *)`;
                    }
                    // every week
                    else if (cycle === 2) {
                        // Run every X day at 2:00
                        cron = `cron(0 2 ? * ${timing + 1} *)`;
                    }
                    // every month
                    else if (cycle === 3) {
                        // Run at 02:00 on the X day of every month
                        if (timing !== 0) {
                            cron = `cron(0 2 ${timing} * ? *)`;
                        }
                        // Run at 2:00 at the end of the month
                        else {
                            cron = `cron(0 2 L * ? *)`;
                        }
                    }
                    // console.log("========== cron", cron);

                    const inputParam = {
                        "projectId": projectId,
                        "csvExportTemplateId": csvExportTemplateId
                    };
                    // scheduler does exist
                    if (schedulerList.Schedules.length !== 0) {
                        // update schedule
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
                            Description: "CSV出力テンプレート名: " + csvExportTemplateName + "\nCSV出力ファイル名: " + csvExportTemplateFileName + "\n" + cron,
                            ScheduleExpression: cron,
                            ScheduleExpressionTimezone: process.env.TZ,
                        }));
                    }
                    // scheduler does not exist
                    else {
                        // create schedule
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
                            Description: "CSV出力テンプレート名: " + csvExportTemplateName + "\nCSV出力ファイル名: " + csvExportTemplateFileName + "\n" + cron,
                            ScheduleExpression: cron,
                            ScheduleExpressionTimezone: process.env.TZ,
                        }));
                    }
                }
            }
            // Scheduler Settings End   ================================================================================

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'CSV出力テンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(response),
            };
        }
        catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'CSV出力テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(error),
            };
        }
        finally {
            if (mysql_con) await mysql_con.close();
        }
    }
    else {
        // failure log
        await createLog(context, 'CSV出力テンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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