/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const s3 = new AWS.S3();
const fs = require('fs');
const stream = require('stream');
const archiver = require("archiver");
const { format } = require("date-fns");
//NOTE: only do it once per Node.js process/application, as duplicate registration will throw an error
archiver.registerFormat('zip-encrypted', require("archiver-zip-encrypted"));
const readline = require('readline');

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';
const CREATED_BY = 'system';

const common = require('./commonFunctions/checkFilter')

/**
 * CSVImportUpload.
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

    const {
        projectId,
        uploaded_csv_file,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;
    console.log('jsonBody',event.body);
    console.log('uploaded_csv_file',uploaded_csv_file);
    let mysql_con;
    try {
        // 1. 初期化処理　権限チェック
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();
        // 2. インポートデータの更新 << 不要 すでにインポート中のため
        // 2. ファイルを元にデータをDBから読み込み
       

            // construct the response
            let response = {};
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