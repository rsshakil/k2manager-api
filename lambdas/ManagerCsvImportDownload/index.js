/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const lambda = new AWS.Lambda();
const Encoding = require('encoding-japanese');

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';

/**
 * ManagerCsvImportDownload.
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

    let csvImportId = event.pathParameters?.csvImportId;
    if (!csvImportId) {
        // failure log
        await createLog(context, 'CSVインポート', 'ダウンロード', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify("Invalid parameter"),
        };
    }

    // Database info
    let mysql_con;
    try {
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);
        logAccountId = jsonBody.aid;
        let projectId = 0;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'CSVインポート', 'ダウンロード', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
                await createLog(context, 'CSVインポート', 'ダウンロード', '失敗', '403', event.requestContext.identity.sourceIp, logAccountId, logData);
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

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        let sql_data = `SELECT * FROM CsvImport WHERE csvImportId = ${csvImportId}`;
        console.log("sql_data:", sql_data);
        // execute query
        var [query_result] = await mysql_con.query(sql_data);
        console.log(query_result);


        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "プロジェクトID";
        logData[0].beforeValue = projectId;
        logData[0].afterValue = projectId;
        logData[1] = {};
        logData[1].fieldName = "CSVインポートファイル名";
        logData[1].beforeValue = query_result[0].csvImportFileName;
        logData[1].afterValue = query_result[0].csvImportFileName;
        logData[2] = {};
        logData[2].fieldName = "CSVインポートテンプレートID";
        logData[2].beforeValue = query_result[0].csvCreateDatetime;
        logData[2].afterValue = query_result[0].csvCreateDatetime;
        logData[3] = {};
        logData[3].fieldName = "CSVインポートステータス";
        logData[3].beforeValue = query_result[0].csvImportStatus;
        logData[3].afterValue = query_result[0].csvImportStatus;
        logData[4] = {};
        logData[4].fieldName = "CSVインポート実行完了日時";
        logData[4].beforeValue = query_result[0].csvImportExecDatetime;
        logData[4].afterValue = query_result[0].csvImportExecDatetime;
        logData[5] = {};
        logData[5].fieldName = "CSVインポート件数";
        logData[5].beforeValue = query_result[0].csvImportDataCount;
        logData[5].afterValue = query_result[0].csvImportDataCount;
        logData[6] = {};
        logData[6].fieldName = "CSVインポートファイルパス";
        logData[6].beforeValue = query_result[0].csvImportFilePath;
        logData[6].afterValue = query_result[0].csvImportFilePath;
        logData[7] = {};
        logData[7].fieldName = "メモ";
        logData[7].beforeValue = query_result[0].memo;
        logData[7].afterValue = query_result[0].memo;

        // get csv path
        const csvPath = query_result[0].csvImportFilePath;
        console.log(csvPath);
        // get csv file 
        const file = await s3.getObject({
            Bucket: BUCKET,
            Key: csvPath
        }).promise();

        if (!file) {
            console.log("file not exists!");
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify({ message: 'no data' }),
            };
        }
        else {
            console.log("file exists!");
        }
/*
        const nowUnixtime = Math.floor(new Date() / 1000);
        let sql_update_query = `UPDATE CSV SET csvLastDownloadDatetime = ?, csvDownloadCount = csvDownloadCount + 1 WHERE csvId = ?`;
        let sql_update_param = [nowUnixtime, csvId];

        var [query_update_result] = await mysql_con.execute(sql_update_query, sql_update_param);
        console.log("query_update_result === ", query_update_result);

        // Found set already deleted
        if (query_update_result.affectedRows == 0) {
            await mysql_con.rollback();
            console.log("Found set already deleted");
            // failure log
            await createLog(context, 'csv', 'download', 'failure', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
*/
let sql_project_data = `SELECT projectCsvCharacterCode FROM Project WHERE projectId = ? LIMIT 1;`;
let [query_project_result] = await mysql_con.query(sql_project_data, [projectId]);

console.log('my cehcking >>>>>>', query_project_result)

let currentProjectCharCode = 1;
if (query_project_result.length > 0) {
    currentProjectCharCode = Number(query_project_result[0].projectCsvCharacterCode);
}
let csvBody = Buffer.from(file.Body).toString('base64');
let csvBodyConvert = Buffer.from(csvBody, 'base64');
// const fromEncoding = 'UTF8';
const toEncoding = ['UTF8', 'UTF8', 'SJIS', 'SJIS', 'UTF16', 'UTF16'][currentProjectCharCode];
const fromEncoding = Encoding.detect(csvBodyConvert);
console.log('toEncoding',toEncoding);
console.log('sourceEncoding',fromEncoding);

if (toEncoding != fromEncoding) {
    let convertedBuffer = Encoding.convert(csvBodyConvert, {
        to: toEncoding,
        from: fromEncoding,
        type: 'arraybuffer'
    });
    csvBody = Buffer.from(Uint8Array.from(convertedBuffer)).toString('base64');
}
//add bom '\ufeff'
if (currentProjectCharCode == 0) {
    let bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let csvBodyConvert = Buffer.from(csvBody, 'base64');
    csvBody = Buffer.from(Buffer.concat([bom, csvBodyConvert])).toString('base64');
}
        

        
        
        let fileNameSplit = csvPath.split('/');
        let fileName = fileNameSplit[fileNameSplit.length - 1];
        console.log("file_name ======= " + fileName);
        await mysql_con.commit();
        // success log
        await createLog(context, 'CSVインポート', 'ダウンロード', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 200,
            isBase64Encoded: true,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Content-Type': 'application/csv',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
            body: csvBody
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log(error);
        // failure log
        await createLog(context, 'CSVインポート', 'ダウンロード', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        };
    }
};

async function createLog(context, _target, _type, _result, _code, ipAddress, accountId, logData = null) {
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
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}