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
 * ManagerCsvExportTemplateCreate.
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
    // logAccountId = createdBy;
    let projectId = event.queryStringParameters?.pid
    let mysql_con;
    try {

        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!event.queryStringParameters?.pid || validProjectId.indexOf(Number(event.queryStringParameters?.pid)) == -1) {
                // failure log
                await createLog(context, 'CSV出力テンプレート', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        // CSV出力テンプレートのコピー処理
        if (event.pathParameters?.csvExportTemplateId) {
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            const {
                createdBy
            } = JSON.parse(event.body);
            // get data
            let parameter = [];
            let csvExportTemplateId = event.pathParameters?.csvExportTemplateId;
            projectId = event.queryStringParameters?.pid;
            const sql_data = `SELECT * FROM CsvExportTemplate WHERE CsvExportTemplate.csvExportTemplateId = ? AND CsvExportTemplate.projectId = ?`;
            parameter.push(Number(csvExportTemplateId));
            parameter.push(Number(projectId));

            let [query_result] = await mysql_con.query(sql_data, parameter);
            if (query_result && query_result[0]) {
                const {
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
                } = query_result[0];
                logAccountId = createdBy;
                // insert data query
                let copy_sql = `INSERT INTO CsvExportTemplate (
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
                    createdAt,
                    createdBy,
                    updatedAt,
                    updatedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
                // created date
                const createdAt = Math.floor(new Date().getTime() / 1000);
                let copy_param = [
                    projectId,
                    csvExportTemplateName + "（コピー）",
                    csvExportTemplateFileName,
                    csvExportTemplateGenerationCycle,
                    csvExportTemplateGenerationTiming,
                    csvExportTemplateAutomaticDeletion,
                    csvExportTemplatePassword,
                    csvExportTemplateColumn,
                    filterId,
                    csvExportTemplateAuthRole,
                    memo,
                    createdAt,
                    createdBy,
                    createdAt,
                    updatedBy
                ];
                console.log("sql_data:", copy_sql);
                console.log("sql_data:", copy_param);
                const [query_copy_result] = await mysql_con.execute(copy_sql, copy_param);
                await mysql_con.commit();
                let newcsvExportTemplateId = query_copy_result.insertId;

                // ログ書き込み
                logData[0] = {};
                logData[0].fieldName = "プロジェクトID";
                logData[0].beforeValue = projectId;
                logData[0].afterValue = projectId;
                logData[1] = {};
                logData[1].fieldName = "CSV出力テンプレートID";
                logData[1].beforeValue = csvExportTemplateId;
                logData[1].afterValue = newcsvExportTemplateId;

                // construct the response
                let response = {
                    records: query_copy_result[0]
                };
                // console.log("response:", response);
                // success log
                await createLog(context, 'CSV出力テンプレート', '複製', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                // failure log
                await createLog(context, 'CSV出力テンプレート', '複製', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify("{message: invalid csvExportTemplateId}"),
                };
            }
        }
        else {
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
                createdBy,
                updatedBy
            } = JSON.parse(event.body);
            logAccountId = createdBy;

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = "";
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "CSVエクスポートテンプレート名";
            logData[1].beforeValue = "";
            logData[1].afterValue = csvExportTemplateName;
            logData[2] = {};
            logData[2].fieldName = "CSVエクスポートファイル名";
            logData[2].beforeValue = "";
            logData[2].afterValue = csvExportTemplateFileName;
            logData[3] = {};
            logData[3].fieldName = "CSV生成周期";
            logData[3].beforeValue = "";
            logData[3].afterValue = csvExportTemplateGenerationCycle;
            logData[4] = {};
            logData[4].fieldName = "CSV生成タイミング";
            logData[4].beforeValue = "";
            logData[4].afterValue = csvExportTemplateGenerationTiming;
            logData[5] = {};
            logData[5].fieldName = "CSV自動削除設定";
            logData[5].beforeValue = "";
            logData[5].afterValue = csvExportTemplateAutomaticDeletion;
            logData[6] = {};
            logData[6].fieldName = "CSVZIPパスワード";
            logData[6].beforeValue = "";
            logData[6].afterValue = csvExportTemplatePassword;
            logData[7] = {};
            logData[7].fieldName = "CSV出力フィールド";
            logData[7].beforeValue = "";
            logData[7].afterValue = csvExportTemplateColumn;
            logData[8] = {};
            logData[8].fieldName = "CSVフィルター設定";
            logData[8].beforeValue = "";
            logData[8].afterValue = filterId;
            logData[9] = {};
            logData[9].fieldName = "CSVエクスポート権限";
            logData[9].beforeValue = "";
            logData[9].afterValue = csvExportTemplateAuthRole;
            logData[10] = {};
            logData[10].fieldName = "メモ";
            logData[10].beforeValue = "";
            logData[10].afterValue = memo;

            // insert data query
            let sql_data = `INSERT INTO CsvExportTemplate (
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
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
            // created date
            const createdAt = Math.floor(new Date().getTime() / 1000);
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
                createdAt,
                createdBy,
                createdAt,
                updatedBy
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            const [query_result] = await mysql_con.execute(sql_data, sql_param);
            if (query_result.length === 0) {
                await mysql_con.rollback();
                console.log("failure insert");
                // failure log
                await createLog(context, 'CSV出力テンプレート', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
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

            // Get new csv export template Id
            let newCsvExportTemplateId = query_result.insertId;

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
            const scheduleName = PREFIX_SCHEDULE_NAME + newCsvExportTemplateId + "-" + process.env.ENV;

            // Make AWS cron expression >>>> (minutes hours day_of_month month day_of_week year)
            let cycle = Number.parseInt(csvExportTemplateGenerationCycle, 10);
            let timing = Number.parseInt(csvExportTemplateGenerationTiming, 10);
            let cron = '';

            // Do not create
            if (cycle === 0) {
                // nop
            }
            else {
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
                    "csvExportTemplateId": newCsvExportTemplateId
                };
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

            // Scheduler Settings End   ================================================================================

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            // console.log("response:", response);
            // success log
            await createLog(context, 'CSV出力テンプレート', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'CSV出力テンプレート', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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