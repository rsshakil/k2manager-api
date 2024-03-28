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
// let LineStream = require('byline').LineStream;
// lineStream = new LineStream();
const Encoding = require('encoding-japanese');

const readline = require('readline');
const crypto = require('crypto')

process.env.TZ = 'Asia/Tokyo';
const BUCKET = 'k2reservation';
const CREATED_BY = 'system';

const common = require('./commonFunctions/checkFilter')

/**
 * ManagerCsvImportPreview.
 *
 * @param {*} event
 * @returns
 */
exports.handler = async (event) => {

    let csvImportTemplateId = event.pathParameters?.csvImportTemplateId;
    let csvImportId = event.pathParameters?.csvImportId;
    console.log('csvImportTemplateId',csvImportTemplateId);
    console.log('csvImportId',csvImportId);
    if (!csvImportId) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify("Invalid parameter"),
        };
    }

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

    let mysql_con;
    try {
        // 1. 初期化処理　権限チェック
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();
        // 2. インポートデータの更新 << 不要 すでにインポート中のため
        // 2. ファイルを元にデータをDBから読み込み
        let csvImportSql = `SELECT * FROM CsvImport LEFT OUTER JOIN CsvImportTemplate ON CsvImport.csvImportTemplateId = CsvImportTemplate.csvImportTemplateId WHERE csvImportId = ?`;
        var [csvImportResult] = await mysql_con.execute(csvImportSql, [csvImportId]);
        let csvHeaderItems = [];
        let csvBodyItems = [];
        
        if(csvImportResult[0].csvImportTemplateFieldQuery && csvImportResult[0].csvImportTemplateFieldQuery.length>0){
            
            csvHeaderItems = csvImportResult[0].csvImportTemplateFieldQuery.map(item=>{
                return {
                    column_width: "w-48",
                    headerName: item?.inputBox?.value,
                    currentPos: item?.currentPos,
                }
            })
            // currentPosごとに並び替え
            csvHeaderItems.sort((a, b) => parseFloat(a.currentPos) - parseFloat(b.currentPos))

            let importData = [];
            let params = {
                Bucket: BUCKET,
                Key: csvImportResult[0].csvImportFilePath
            }
            let readData = await s3.getObject(params).promise();
            let bufferBody = readData?.Body;
            console.log('readDataBody',bufferBody);
            let detectedEncoding = Encoding.detect(bufferBody);
            console.log('sourceEncoding',detectedEncoding);
            let convertedBuffer = Encoding.convert(bufferBody, {
              to: 'UTF8',
              from: detectedEncoding,
              type:'arraybuffer'
            });
            let csvBody = Buffer.from(convertedBuffer);
            // let readStream = await s3.getObject(params).createReadStream();
            const readStream = stream.Readable.from(csvBody);
            console.log('stram',readStream);
            const rl = readline.createInterface({
                input: readStream,
                crlfDelay: Infinity
            });
            // for awaitで1行ずつ処理
            let n=0;
            for await (const line of rl) {
                if(n>0){
                    console.log('rl',line);
                    var tempObj = {};
                    let j = 0;
                    line.split(/,(?![^\[]*\])/).map((cell) => {
                        tempObj['csv'+j] = cell.trim();
                        j++;
                    });
                    csvBodyItems.push(tempObj);
                }
                n++;
            }
            // console.log('importData',importData);
            // for(let i=0;i<=50;i++){
            //     var tempObj = {};
            //     for(let j=0;j<csvImportResult[0].csvImportTemplateFieldQuery.length;j++){
            //         tempObj['csv'+j] = 'SomeValue'+j;
            //     }
            //     csvBodyItems.push(tempObj);
            // }
            // construct the response
            let response = {
                csvImportPreviewHeaderData:csvHeaderItems,
                csvImportPreview:csvBodyItems
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
        }
        // データが不正
        else {
            let response = {message: "invalid parameter"};
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        }
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