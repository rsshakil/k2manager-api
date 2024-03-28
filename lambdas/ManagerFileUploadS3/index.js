/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';
const BUCKET_ADMIN = 'k2adminimages';
const DISTINATION_DIR = '';
const CREATED_BY = 'system';
//const common = require('./commonFunctions/checkFilter')
/**
 * ManagerFileUploadS3.
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
    console.log('body',JSON.parse(event.body));
    const {
        projectId,
        uploadedFile,
        file_name,
        bucketName,
        distination_directory,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;

    const createdAt = Math.floor(new Date().getTime() / 1000);
  
    let mysql_con;
    try {
        mysql_con = await mysql.createConnection(writeDbConfig);

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

        console.log("uploadedFile2", Buffer.from(uploadedFile, 'base64'));
        let fileBody = Buffer.from(uploadedFile, 'base64');
        console.log('fileBody',fileBody);
        let filePath = distination_directory+uploadedFile;
        console.log('filePath', filePath);
        console.log('file_name', file_name);
        let fileUploaded = await s3.upload({
            Bucket: bucketName,
            Key: file_name,
            Body: fileBody,
        }).promise();
        console.log('fileUploaded', fileUploaded);
        if (!fileUploaded) {
            console.log("failure file upload");
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
            fileUploadedInfo: fileUploaded
        };
        fileUploaded['location'] = fileUploaded?.Location;
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(fileUploaded),
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