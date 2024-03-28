/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();
const s3 = new AWS.S3({ 'region': 'ap-northeast-1' });

process.env.TZ = "Asia/Tokyo";

const BUCKET_RESERVATION = 'k2reservation';

/**
 * ManagerCsvImportDelete.
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
        logAccountId = JSON.parse(event.body).deletedBy;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'CSVインポート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'CSVインポート', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let beforeSql = `SELECT * FROM CsvImport WHERE csvImportId = ? and projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [csvImportId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'CSVインポート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[1].fieldName = "CSVインポートファイル名";
            logData[1].beforeValue = beforeResult[0].csvImportFileName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "CSVインポートテンプレートID";
            logData[2].beforeValue = beforeResult[0].csvImportTemplateId;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "CSVインポートステータス";
            logData[3].beforeValue = beforeResult[0].csvImportStatus;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "CSVインポート実行完了日時";
            logData[4].beforeValue = beforeResult[0].csvImportExecDatetime;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "CSVインポート件数";
            logData[5].beforeValue = beforeResult[0].csvImportDataCount;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "CSVインポートファイルパス";
            logData[6].beforeValue = beforeResult[0].csvImportFilePath;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = beforeResult[0].memo;
            logData[7].afterValue = "";

            // S3からファイルを削除
            try {
                const deletes = await s3.deleteObject({
                    Bucket: BUCKET_RESERVATION,
                    Key: beforeResult[0].csvImportFilePath
                }).promise().catch(err => {
                    throw new Error(err);
                });
            } catch (err) {
                await mysql_con.rollback();
                console.log(err);
                // failure log
                await createLog(context, 'CSVインポート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(err),
                };
            }

/*
            // CSVレコード削除
            let sql_data2 = `DELETE from CSV WHERE csvId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [csvId]);
*/
            // レコードは論理削除
            let sql_data2 = `UPDATE CsvImport SET csvImportDelFlag = 1 WHERE csvImportId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [csvImportId]);

            await mysql_con.commit();
            // success log
            await createLog(context, 'CSVインポート', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);

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
            await createLog(context, 'CSVインポート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'CSVインポート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
