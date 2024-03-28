/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const lambda = new AWS.Lambda();
const fs = require('fs');
const BUCKET = 'k2reservation';
const DEST_DIR = 'csvImportTemplate';

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCsvImportTemplateUpdate.
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
        csvImportTemplateFieldQuery,
        csvImportTemplateName,
        eventId,
        csvImportTemplateType,
        csvImportTemplateAuthRole,
        memo,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    if (event.pathParameters?.csvImportTemplateId) {
        let csvImportTemplateId = Number(event.pathParameters.csvImportTemplateId);
        console.log("csvImportTemplateId:", csvImportTemplateId);

        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'CSVインポートテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'CSVインポートテンプレート', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let beforeSql = `SELECT * FROM CsvImportTemplate WHERE csvImportTemplateId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [csvImportTemplateId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'CSVインポートテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            // update data query
            let sql_data = `UPDATE CsvImportTemplate
                SET
                projectId = ?,
                csvImportTemplateFieldQuery = ?,
                csvImportTemplateName = ?,
                eventId = ?,
                csvImportTemplateType = ?,
                csvImportTemplateAuthRole = ?,
                csvImportTemplateFilePath = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE csvImportTemplateId = ?`;
            // updated date
            const fileName = `${projectId}_${csvImportTemplateName}_import_template`;
            const filePath = `${DEST_DIR}/${fileName}.csv`;

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "CSVインポートテンプレート名";
            logData[1].beforeValue = beforeResult[0].csvImportTemplateName;
            logData[1].afterValue = csvImportTemplateName;
            logData[2] = {};
            logData[2].fieldName = "イベントID";
            logData[2].beforeValue = beforeResult[0].eventId;
            logData[2].afterValue = eventId;
            logData[3] = {};
            logData[3].fieldName = "CSVインポートテンプレート種別";
            logData[3].beforeValue = beforeResult[0].csvImportTemplateType;
            logData[3].afterValue = csvImportTemplateType;
            logData[4] = {};
            logData[4].fieldName = "CSVインポートテンプレートフィールド";
            logData[4].beforeValue = beforeResult[0].csvImportTemplateFieldQuery;
            logData[4].afterValue = csvImportTemplateFieldQuery;
            logData[5] = {};
            logData[5].fieldName = "CSVインポートテンプレート権限";
            logData[5].beforeValue = beforeResult[0].csvImportTemplateAuthRole;
            logData[5].afterValue = csvImportTemplateAuthRole;
            logData[6] = {};
            logData[6].fieldName = "CSVインポートテンプレートファイルパス";
            logData[6].beforeValue = beforeResult[0].csvImportTemplateFilePath;
            logData[6].afterValue = filePath;
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = beforeResult[0].memo;
            logData[7].afterValue = memo;

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_param = [
                projectId,
                csvImportTemplateFieldQuery,
                csvImportTemplateName,
                eventId,
                csvImportTemplateType,
                csvImportTemplateAuthRole,
                filePath,
                memo,
                updatedAt,
                updatedBy,
                csvImportTemplateId
            ];
            console.log("csvImportTemplateAuthRole:", csvImportTemplateAuthRole);
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            const [query_result] = await mysql_con.execute(sql_data, sql_param);
            if (query_result.affectedRows === 0) {
                // failure log
                await createLog(context, 'CSVインポートテンプレート', '更新', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            /*UPLOADCSV TO S3 Start*/
            const tmpFile = `/tmp/tmp_${fileName}.csv`;
            let header = [];
            let csvContents = JSON.parse(csvImportTemplateFieldQuery);
            if (csvContents && csvContents?.length > 0) {
                csvContents.sort((a, b) => (a.currentPos > b.currentPos ? 1 : -1));

                header = csvContents.map(item => item?.inputBox?.value);
            }
            console.log('csv headers', header);
            // open sync temp file
            const fd = fs.openSync(tmpFile, "w");

            fs.writeSync(fd, header.join(',') + '\n');
            // close sync write file
            fs.closeSync(fd);
            // S3 file path
            const beforeFilePath = `${DEST_DIR}/${projectId}_${beforeResult[0].csvImportTemplateName}_import_template.csv`;
            /*deleteBeforeCSV*/
            await s3.deleteObject({
                Bucket: BUCKET,
                Key: beforeFilePath
            }).promise();
            /*deleteBeforeCSV*/
            let fileUploaded = await uploadFromStream(s3, filePath, tmpFile);
            console.log('fileUploaded', fileUploaded);
            /*UPLOADCSV TO S3 End*/

            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'CSVインポートテンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            await createLog(context, 'csv-import-template', 'update', 'failure', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'CSVインポートテンte', 'update', 'failure', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
const uploadFromStream = async (s3, path, fileName) => {
    // const pass = new stream.PassThrough();
    const fileContent = fs.readFileSync(fileName);
    const params = {
        Bucket: BUCKET,
        Key: path,
        Body: fileContent,
        ContentType: 'application/csv'
    };
    s3.upload(params, (err, data) => {
        if (err) {
            console.log(err);
            throw err;
        }
        if (data) {
            console.log('file upload success', path);
        }
    });
    return fileContent;
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
