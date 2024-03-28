/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerEventInstituteRead.
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
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    // mysql connect
    let mysql_con;
    // イベントカテゴリーIDが合った場合そのデータのみ返す
    if (event.pathParameters?.eventInstituteId != null && event.queryStringParameters?.eid != null) {
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            // Expand POST parameters 
            let eventInstituteId = event.pathParameters.eventInstituteId;
            // let eventId = event.queryStringParameters.eid;
            let sql_data = "";
            let whereQuery = "";
            // get list sql
            sql_data = `SELECT 

            EventInstitute.eventInstituteId,
            Institute.instituteId,
            Institute.instituteName,
            Institute.instituteManageName,
            EventInstitute.eventInstituteName,
            EventInstitute.eventInstituteItemType,
            EventInstitute.eventInstituteStartDate,
            EventInstitute.eventInstituteEndDate,
            EventInstitute.filterId,
            EventInstitute.eventInstituteSlotType,
            EventInstitute.eventInstituteSlotStyle,
            EventInstitute.eventInstituteMappingStyle,
            EventInstitute.eventInstituteItemInfo,
            EventInstitute.eventInstituteItemStyle,
            EventInstitute.eventInstituteDentalFlag,
            EventInstitute.memo3 AS memo
            FROM EventInstitute 
            LEFT OUTER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
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
    // イベントIDだけの場合イベントカテゴリーの一覧を返す
    else if (event.queryStringParameters?.eid != null) {
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            console.log("got query string params!")
            // Expand POST parameters 
            let eventId = event.queryStringParameters.eid;
            let sql_data = "";
            let whereQuery = "";
            let parameter = [];
            if (event.queryStringParameters.eeid) {
                whereQuery += ` AND EventInstitute.eventInstituteItemType = ?`;
                parameter.push(Number(event.queryStringParameters.eeid));
            }
            // get list sql
            sql_data = `SELECT 
            EventInstitute.eventInstituteId,
            Institute.instituteName,
            Institute.instituteManageName,
            EventInstitute.eventInstituteName,
            EventCategory.eventCategoryId,
            Category.categoryName,
            EventCategory.eventCategoryName,
            EventInstitute.eventInstituteDentalFlag
            FROM EventInstitute 
            LEFT OUTER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
            LEFT OUTER JOIN EventCategory ON EventInstitute.eventCategoryId = EventCategory.eventCategoryId
            LEFT OUTER JOIN Category ON EventCategory.categoryId = Category.categoryId
            WHERE 1=1
            ${whereQuery}
            AND EventCategory.eventId = ?
            ORDER BY eventInstituteId ASC`
            console.log("query:", sql_data);
            parameter.push(eventId);
            var [query_result2] = await mysql_con.execute(sql_data, parameter);
            let response = {
                // count: query_result1[0].count,
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
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            console.log("got query string params!")
            // Expand POST parameters 
            let pid = event.queryStringParameters.pid;
            let sql_data = "";
            let parameter = [];
            
            sql_data = `SELECT 
            EventInstitute.eventInstituteId,
            Institute.instituteName,
            Institute.instituteManageName,
            EventInstitute.eventInstituteName,
            EventInstitute.eventInstituteDentalFlag
            FROM EventInstitute 
            LEFT OUTER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
            WHERE 1=1
            AND Institute.projectId = ?
            ORDER BY eventInstituteId ASC`
            console.log("query:", sql_data);
            parameter.push(pid);
            var [query_result2] = await mysql_con.execute(sql_data, parameter);
            let response = {
                // count: query_result1[0].count,
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
}
