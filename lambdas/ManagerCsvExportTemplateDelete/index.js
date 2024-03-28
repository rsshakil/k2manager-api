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
const PREFIX_SCHEDULE_NAME = "ScheduleForCSVExport";

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCsvExportTemplateDelete.
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
    console.log("event.queryStringParameters:", jsonBody);
    projectId = jsonBody?.pid;

    if (event.pathParameters?.csvExportTemplateId) {
        let csvExportTemplateId = event.pathParameters.csvExportTemplateId;
        console.log("csvExportTemplateId:", csvExportTemplateId);
        logAccountId = JSON.parse(event.body).deletedBy;
        // Expand GET parameters
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'CSV出力テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId,logAccountId, logData);
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
                await createLog(context, 'CSV出力テンプレート', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId,logAccountId, logData);
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
                await createLog(context, 'CSV出力テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
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
            logData[1].fieldName = "CSVエクスポートテンプレート名";
            logData[1].beforeValue = beforeResult[0].csvExportTemplateName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "CSVエクスポートファイル名";
            logData[2].beforeValue = beforeResult[0].csvExportTemplateFileName;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "CSV生成周期";
            logData[3].beforeValue = beforeResult[0].csvExportTemplateGenerationCycle;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "CSV生成タイミング";
            logData[4].beforeValue = beforeResult[0].csvExportTemplateGenerationTiming;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "CSV自動削除設定";
            logData[5].beforeValue = beforeResult[0].csvExportTemplateAutomaticDeletion;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "CSVZIPパスワード";
            logData[6].beforeValue = beforeResult[0].csvExportTemplatePassword;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "CSV出力フィールド";
            logData[7].beforeValue = beforeResult[0].csvExportTemplateColumn;
            logData[7].afterValue = "";
            logData[8] = {};
            logData[8].fieldName = "CSVフィルター設定";
            logData[8].beforeValue = beforeResult[0].filterId;
            logData[8].afterValue = "";
            logData[9] = {};
            logData[9].fieldName = "CSVエクスポートテンプレート権限";
            logData[9].beforeValue = beforeResult[0].csvExportTemplateAuthRole;
            logData[9].afterValue = "";
            logData[10] = {};
            logData[10].fieldName = "メモ";
            logData[10].beforeValue = beforeResult[0].memo;
            logData[10].afterValue = "";

            // delete CSV export template
            let sql_data2 = `DELETE from CsvExportTemplate WHERE csvExportTemplateId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [csvExportTemplateId]);

            // define scheduler group name
            const groupName = PREFIX_GROUP_NAME + projectId + "-" + process.env.ENV;
            // define schedule name
            const scheduleName = PREFIX_SCHEDULE_NAME + csvExportTemplateId + "-" + process.env.ENV;

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
            await createLog(context, 'CSV出力テンプレート', '削除', '成功', '200', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
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
            await createLog(context, 'CSV出力テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
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
        await createLog(context, 'CSV出力テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId,logAccountId, logData);
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