
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
    let mysql_con = await mysql.createConnection(readDbConfig);

    // if (true) {
    if (event.pathParameters?.eventInstituteId != null) {
        console.log("got query string params!")
        let eventInstituteId = event.pathParameters.eventInstituteId;
        // debug 
        // let eventInstituteId = 65;
        let sql_data = "";
        // get list sql
        sql_data = `SELECT eventInstituteItemInfo, memo3
        FROM EventInstitute
        WHERE EventInstitute.eventInstituteId = ?`
        try {
            console.log("query:", sql_data);  
            var [query_result2, query_fields2] = await mysql_con.query(sql_data, [eventInstituteId]);
            response = {
                records: {
                    "records": query_result2,
                }
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
    else if (event.queryStringParameters?.eid != null) {
        console.log("event slot template list")
        let eid = event.queryStringParameters.eid;
        let sql_data = `SELECT eventInstituteItemInfo, memo3 FROM EventInstitute 
INNER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
INNER JOIN EventCategory ON EventCategory.eventCategoryId = EventInstitute.eventCategoryId WHERE eventId = ? AND eventInstituteItemInfo IS NOT NULL`;
        try {
            //
            console.log("query:", sql_data);  
            var [query_result2, query_fields2] = await mysql_con.query(sql_data, [eid]);
            // eventInstituteItemInfo に値が入っていた場合そのまま返却
            let response = {
                records: query_result2
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
 