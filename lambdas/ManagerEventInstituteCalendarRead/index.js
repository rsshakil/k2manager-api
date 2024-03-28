/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
 const AWS = require('aws-sdk')
 const mysql = require("mysql2/promise");
 const ssm = new AWS.SSM();

 exports.handler = async (event) => {
    console.log(event);
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
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE, 
        charset: process.env.DBCHARSET
    };
    console.log("Event data: ",event);
    // mysql connect
    let mysql_con;
    // イベントカテゴリーIDが合った場合そのデータのみ返す
    if (event.pathParameters?.eventInstituteId != null && event.queryStringParameters?.eid != null) {
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            // Expand POST parameters 
            let eventInstituteId = event.pathParameters.eventInstituteId;
            let eventId = event.queryStringParameters.eventId;
            let sql_data = "";
            let whereQuery = "";
            // get list sql
            sql_data = `SELECT 
            eventInstituteMappingStyle,
            eventInstituteStartDate,
            eventInstituteEndDate,
            memo2
            FROM EventInstitute 
            WHERE EventInstitute.eventInstituteId = ?
            ORDER BY eventInstituteId ASC`
            console.log("query:", sql_data);  
            var [query_result2] = await mysql_con.query(sql_data, [eventInstituteId]);
            let response = {
                // count: query_result1[0].count,
                records: query_result2[0]
            }
            // console.log(response);
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
        console.log("invalid parameter");
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({"message": "invalid parameter"}),
        };
    }
 }
 