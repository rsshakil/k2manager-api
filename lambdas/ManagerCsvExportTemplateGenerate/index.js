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
const PREFIX_INSTANT_SCHEDULE_NAME = "ScheduleForCSVGenerate";

const ROLE_ARN = "arn:aws:iam::134712758746:role/k2-scheduler-role";
const EVENT_ARN = "arn:aws:lambda:ap-northeast-1:134712758746:function:CSVGenerate-" + process.env.ENV;

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCsvExportTemplateGenerate.
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

    if (event.pathParameters?.csvExportTemplateId) {
        let csvExportTemplateId = event.pathParameters.csvExportTemplateId;

        const {
            projectId,
            createdBy,
        } = JSON.parse(event.body);
        logAccountId = createdBy;

        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
                await createLog(context, 'CSV即時出力', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            let sql_data = `SELECT * FROM CsvExportTemplate WHERE csvExportTemplateId = ? LIMIT 1`;
            const [query_result] = await mysql_con.query(sql_data, [csvExportTemplateId]);
            if (query_result.length === 0) {
                await mysql_con.rollback();
                console.log("failure insert");
                // failure log
                await createLog(context, 'CSV即時出力', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = "";
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "CSVエクスポートテンプレートID";
            logData[1].beforeValue = "";
            logData[1].afterValue = csvExportTemplateId;
            logData[2] = {};
            logData[2].fieldName = "CSVエクスポートテンプレート名";
            logData[2].beforeValue = "";
            logData[2].afterValue = query_result[0].csvExportTemplateName;
            logData[3] = {};
            logData[3].fieldName = "CSVエクスポートファイル名";
            logData[3].beforeValue = "";
            logData[3].afterValue = query_result[0].csvExportTemplateFileName;
            logData[4] = {};
            logData[4].fieldName = "CSV生成周期";
            logData[4].beforeValue = "";
            logData[4].afterValue = query_result[0].csvExportTemplateGenerationCycle;
            logData[5] = {};
            logData[5].fieldName = "CSV生成タイミング";
            logData[5].beforeValue = "";
            logData[5].afterValue = query_result[0].csvExportTemplateGenerationTiming;
            logData[6] = {};
            logData[6].fieldName = "CSV自動削除設定";
            logData[6].beforeValue = "";
            logData[6].afterValue = query_result[0].csvExportTemplateAutomaticDeletion;
            logData[7] = {};
            logData[7].fieldName = "CSVZIPパスワード";
            logData[7].beforeValue = "";
            logData[7].afterValue = query_result[0].csvExportTemplatePassword;
            logData[8] = {};
            logData[8].fieldName = "CSV出力フィールド";
            logData[8].beforeValue = "";
            logData[8].afterValue = query_result[0].csvExportTemplateColumn;
            logData[9] = {};
            logData[9].fieldName = "CSVフィルター設定";
            logData[9].beforeValue = "";
            logData[9].afterValue = query_result[0].filterId;
            logData[10] = {};
            logData[10].fieldName = "CSVエクスポートテンプレート権限";
            logData[10].beforeValue = "";
            logData[10].afterValue = query_result[0].csvExportTemplateAuthRole;
            logData[11] = {};
            logData[11].fieldName = "メモ";
            logData[11].beforeValue = "";
            logData[11].afterValue = query_result[0].memo;

            console.log('query_result', query_result);

            let payload = {
                csvExportTemplateId: csvExportTemplateId
            };
            let params = {
                Payload: JSON.stringify(payload),
                FunctionName: "CSVGenerate-" + process.env.ENV,
                InvocationType: "Event"
            };
            console.log("params:", params);
        
            let res = await lambda.invoke(params).promise();

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            // console.log("response:", response);
            // success log
            await createLog(context, 'CSV即時出力', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            console.log("error:", error);
            // failure log
            await createLog(context, 'CSV即時出力', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
    }
    else {
        console.log("invalid parameter");
        // failure log
        await createLog(context, 'CSV即時出力', '作成', '失敗', '400', event.requestContext.identity.sourceIp, null, logAccountId, logData);
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