/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
*/
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
* ManagerCsvImportTemplateRead.
* 
* @param {*} event
* @returns {json} response
*/
exports.handler = async (event) => {
console.log("Event data:", event);
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
        process.env.DBINFO = true
    }
    // Database info
    let mysql_con;
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE, 
        charset: process.env.DBCHARSET
    };
    console.log("Event data:",event);
    // mysql connect
    mysql_con = await mysql.createConnection(readDbConfig);

    const pid = event.queryStringParameters?.pid;
    const CsvImportTemplateId = event.queryStringParameters?.CsvImportTemplateId;

    console.log('pid', pid);
    console.log('CsvImportTemplateId', CsvImportTemplateId);

    let sql_data;
    let response;
    let whereQuery = "";
    let parameter = [];

    if (pid) {
        console.log("got query string params! from list")
        parameter.push(pid);
        if (event?.requestContext?.authorizer?.rid) {
            whereQuery = `AND (
                JSON_CONTAINS(csvImportTemplateAuthRole, '?', '$' ) 
                    OR (
                        csvImportTemplateAuthRole IS NULL 
                        OR
                        JSON_EXTRACT(csvImportTemplateAuthRole, '$') = JSON_ARRAY()
                    )
                )
            `;
            parameter.push(Number(event?.requestContext?.authorizer?.rid));
        }
        sql_data = `SELECT * FROM CsvImportTemplate WHERE projectId = ? ${(whereQuery)} ORDER BY CsvImportTemplateId DESC`;
        try {
            console.log("sql_data", sql_data)
            console.log("parameter", parameter)
            let [query_result] = await mysql_con.query(sql_data, parameter);
            response = {
                records: query_result
            }
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log(error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        }
    }
    else if (CsvImportTemplateId) {
        console.log("got query string params! edit")
        parameter.push(CsvImportTemplateId);
        if (event?.requestContext?.authorizer?.rid) {
            whereQuery = `AND (
                JSON_CONTAINS(csvImportTemplateAuthRole, '?', '$' ) 
                    OR (
                        csvImportTemplateAuthRole IS NULL 
                        OR
                        JSON_EXTRACT(csvImportTemplateAuthRole, '$') = JSON_ARRAY()
                    )
                )
            `;
            parameter.push(Number(event?.requestContext?.authorizer?.rid));
        }
        sql_data = `SELECT * FROM CsvImportTemplate WHERE CsvImportTemplateId = ? ${(whereQuery)} LIMIT 1`;
        try {
            let [query_result] = await mysql_con.query(sql_data, parameter);
            console.log('query_result', query_result);
            response = {
                records: query_result[0]
            }
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log(error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        }
    }
    else {
        let response = {
            message: "data not found"
        };
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    }
}