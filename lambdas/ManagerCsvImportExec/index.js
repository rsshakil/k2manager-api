/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCsvImportExec.
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

    // Expand GET parameters
    let projectId = 0;
    let jsonBody = event.queryStringParameters;
    console.log("event.queryStringParameters:", jsonBody);
    projectId = jsonBody?.pid;

    if (event.pathParameters?.csvImportId) {
        let csvImportId = event.pathParameters.csvImportId;
        console.log("csvImportId:", csvImportId);
        logAccountId = JSON.parse(event.body).execedBy;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'CSVインポート', '実行', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'CSVインポート', '実行', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let beforeSql = `SELECT * FROM CsvImport WHERE csvImportId = ? and projectId = ? AND csvImportStatus = 0`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [csvImportId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'CSVインポート', '実行', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[0].beforeValue = "";
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "CSVインポートファイル名";
            logData[1].beforeValue = "";
            logData[1].afterValue = beforeResult[0].csvImportFileName;
            logData[2] = {};
            logData[2].fieldName = "CSVインポートテンプレートID";
            logData[2].beforeValue = "";
            logData[2].afterValue = beforeResult[0].csvImportTemplateId;
            logData[3] = {};
            logData[3].fieldName = "CSVインポートステータス";
            logData[3].beforeValue = "";
            logData[3].afterValue = beforeResult[0].csvImportStatus;
            logData[4] = {};
            logData[4].fieldName = "CSVインポート実行日時";
            logData[4].beforeValue = "";
            logData[4].afterValue = beforeResult[0].csvImportExecDatetime;
            logData[5] = {};
            logData[5].fieldName = "CSVインポート件数";
            logData[5].beforeValue = "";
            logData[5].afterValue = beforeResult[0].csvImportDataCount;
            logData[6] = {};
            logData[6].fieldName = "CSVインポート削除フラグ";
            logData[6].beforeValue = "";
            logData[6].afterValue = beforeResult[0].csvImportDelFlag;
            logData[7] = {};
            logData[7].fieldName = "CSVインポートファイルパス";
            logData[7].beforeValue = "";
            logData[7].afterValue = beforeResult[0].csvImportFilePath;
            logData[8] = {};
            logData[8].fieldName = "メモ";
            logData[8].beforeValue = "";
            logData[8].afterValue = beforeResult[0].memo;

            // S3からファイルを削除
            // try {
            //     const deletes = await s3.deleteObject({
            //         Bucket: BUCKET_RESERVATION,
            //         Key: beforeResult[0].csvImportFilePath
            //     }).promise().catch(err => {
            //         throw new Error(err);
            //     });
            // } catch (err) {
            //     await mysql_con.rollback();
            //     console.log(err);
            //     // failure log
            //     await createLog(context, 'csv', 'delete', 'failure', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            //     return {
            //         statusCode: 400,
            //         headers: {
            //             'Access-Control-Allow-Origin': '*',
            //             'Access-Control-Allow-Headers': '*',
            //         },
            //         body: JSON.stringify(err),
            //     };
            // }

            // ラムダ呼び出し
            let payload = {
                "csvImportId": csvImportId,
                "projectId": projectId,
                "execedBy": logAccountId
            };
            let params = {
                Payload: JSON.stringify(payload),
                FunctionName: "CSVImport-" + process.env.ENV,
                InvocationType: "Event"
            };
            console.log("params: ", params);
            let res = await lambda.invoke(params).promise();
            console.log("res: ", res);

            await mysql_con.commit();
            // success log
            await createLog(context, 'CSVインポート', '実行', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);

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
            await createLog(context, 'CSVインポート', '実行', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'CSVインポート', '実行', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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