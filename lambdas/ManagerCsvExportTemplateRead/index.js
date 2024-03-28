/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerCsvExportTemplateRead.
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
    const csvExportTemplateId = event.queryStringParameters?.csvExportTemplateId;
    const rid = event.requestContext.authorizer?.rid;

    console.log('event.requestContext', event.requestContext);
    console.log('event.requestContext.authorizer', event.requestContext.authorizer);

    console.log('pid', pid);
    console.log('csvExportTemplateId', csvExportTemplateId);

    let sql_data;
    let response;
    let parameter = [];

    if (pid) {
        console.log("got query string params! from list")
        // 権限をもとにデータを絞る
        sql_data = `SELECT 
            csvExportTemplateId,
            projectId,
            csvExportTemplateName,
            csvExportTemplateFileName
        FROM CsvExportTemplate WHERE projectId = ?`;
        parameter.push(pid);
        let whereQuery = "";
        if (event?.requestContext?.authorizer?.rid) {
            whereQuery = `AND (
                JSON_CONTAINS(csvExportTemplateAuthRole, '?', '$' ) 
                    OR (
                        csvExportTemplateAuthRole IS NULL 
                        OR
                        JSON_EXTRACT(csvExportTemplateAuthRole, '$') = JSON_ARRAY()
                    )
                )
            `;
            parameter.push(Number(event?.requestContext?.authorizer?.rid));
        }
        sql_data = sql_data + whereQuery + `ORDER BY csvExportTemplateId DESC;`;

        try {
            let [query_result, query_fields] = await mysql_con.query(sql_data, parameter);
 
            response = {
                records: query_result
            }
            console.log("query_result", JSON.stringify(query_result));
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

    else if (csvExportTemplateId) {
       console.log("got query string params! edit")
       sql_data = `SELECT * FROM CsvExportTemplate WHERE csvExportTemplateId = ? LIMIT 1`;

        try {
            let [query_result, query_fields] = await mysql_con.query(sql_data, [csvExportTemplateId]);
            
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