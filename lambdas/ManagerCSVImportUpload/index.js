/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const DEST_DIR = 'csvImport';
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
const stream = require('stream');
const archiver = require("archiver");
const { format } = require("date-fns");
const Encoding = require('encoding-japanese');
// const multipart = require('lambda-multipart-parser');
//NOTE: only do it once per Node.js process/application, as duplicate registration will throw an error
archiver.registerFormat('zip-encrypted', require("archiver-zip-encrypted"));
const readline = require('readline');
const uuid = require('uuid');

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';
const CREATED_BY = 'system';

const common = require('./commonFunctions/checkFilter')
const iconv = require('iconv-lite');

/**
 * ManagerCSVImportUpload.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {
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
    let writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };
    console.log('jsonBody1', event.body);
    // let jsonBody =  await multipart.parse(event);

    const {
        projectId,
        csvImportTemplateId,
        csvImportFileName,
        csvImportLength,
        // files,
        projectCsvCharacterCode,
        csvdata,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;


    let characterCode = 1;
    const createdAt = Math.floor(new Date().getTime() / 1000);
    const mimeEncodFormat = ['utf-8', 'utf-8', 'shift_jis', 'shift_jis', 'utf-16', 'utf-16'][characterCode];

    // console.log('csvImportTemplateId',csvImportTemplateId);
    // console.log('csvImportFileName',decodeURI(csvImportFileName));

    // const getProjectEncodingBom = [true,false,true,false,true,false][characterCode];
    // console.log('characterCode',characterCode);

    console.log('jsonBody', event.body);
    console.log('projectId', projectId);
    console.log("csvdata1", csvdata);
    console.log("csvdata2", Buffer.from(csvdata, 'base64'));
    let csvBody = Buffer.from(csvdata, 'base64');

    let mysql_con;
    try {
        mysql_con = await mysql.createConnection(writeDbConfig);

        let sql_project_data = `SELECT projectCsvCharacterCode FROM Project WHERE projectId = ? LIMIT 1;`;
        let [query_project_result] = await mysql_con.query(sql_project_data, [projectId]);

        console.log('my cehcking >>>>>>', query_project_result)

        let currentProjectCharCode = 1;
        if (query_project_result.length > 0) {
            currentProjectCharCode = Number(query_project_result[0].projectCsvCharacterCode);
        }

        const toEncoding = 'UTF8';
        const fromEncoding = ['UTF8', 'UTF8', 'SJIS', 'SJIS', 'UTF16', 'UTF16'][currentProjectCharCode];

        // let detectedEncoding = Encoding.detect(csvBody);
        // console.log('sourceEncoding',detectedEncoding);

        if (toEncoding != fromEncoding) {
            let convertedBuffer = Encoding.convert(csvBody, {
                to: toEncoding,
                from: fromEncoding,
                //   bom:getProjectEncodingBom,
                type: 'arraybuffer'
            });
            csvBody = Buffer.from(Uint8Array.from(convertedBuffer));
        }

        // csvBody = new Uint8Array(convertedBuffer).buffer;
        console.log('csvBody', csvBody);

        // create a date in YYYY-MM-DD HH:Mi format
        const now = new Date();
        var cYear = now.getFullYear();
        var cMonth = ("00" + (now.getMonth() + 1)).slice(-2);
        var cDay = ("00" + now.getDate()).slice(-2);
        var cHours = ("00" + now.getHours()).slice(-2);
        var cMinutes = ("00" + now.getMinutes()).slice(-2);
        var cSeconds = ("00" + now.getSeconds()).slice(-2);
        var createdDateTime = cYear + '_' + cMonth.substring(-2) + '_' + cDay.substring(-2) + '_' + cHours.substring(-2) + '_' + cMinutes.substring(-2) + '_' + cSeconds.substring(-2);
        console.log('createdDateTime', createdDateTime);
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                // failure log
                //await createLog(context, 'csvExportTemplate', 'create', 'failure', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
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

        let sql_data = `INSERT INTO CsvImport (
            projectId,
            csvImportFileName,
            csvImportTemplateId,
            csvImportDataCount,
            csvImportFilePath,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`;

        await mysql_con.beginTransaction();
        // const { content, filename, contentType } = files[0];
        // console.log('retStr',decodeURI(filename));
        let filePath = `${DEST_DIR}/${decodeURI(csvImportFileName)}`;
        filePath = filePath.split(".csv")[0];
        filePath = `${filePath}_${createdDateTime}.csv`;
        console.log('filePath', filePath);
        // contentの日本語が文字化けしているためデコードする
        // let contents2 = iconv.decode(content, "ISO-8859-1");
        let fileUploaded = await s3.upload({
            Bucket: BUCKET,
            Key: filePath,
            Body: csvBody,
            ContentType: 'application/csv;charset=' + mimeEncodFormat
        }).promise();
        console.log('fileUploaded', fileUploaded);

        let sql_param = [
            projectId,
            decodeURI(csvImportFileName),
            csvImportTemplateId,
            csvImportLength,
            filePath,
            createdAt,
            createdBy,
            createdAt,
            updatedBy
        ];
        console.log('sql_data', sql_data);
        console.log('sql_param', sql_param);
        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        console.log('lastInsertId', query_result?.insertId);
        if (query_result.length === 0) {
            await mysql_con.rollback();
            console.log("failure insert");
            // failure log
            // await createLog(context, 'csvImportTemplate', 'create', 'failure', '400', event.requestContext.identity.sourceIp,projectId, logAccountId, logData);
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
        // construct the response
        let response = {
            csvImportId: query_result?.insertId
        };
        // console.log('this is response >>>>>>>>>>>>>>', response)
        mysql_con.commit();
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        // mysql_con.rollback();
        console.log(error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error),
        };
    }
};