/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerEventCategoryRead.
 * 
 * @param {*} event
 * @returns {json} response
 */
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
        process.env.DBINFO = true;
    }
    // Database info
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    console.log("Event data:", event);
    // mysql connect
    let mysql_con;
    // イベントカテゴリーIDが合った場合そのデータのみ返す
    if (event.pathParameters?.eventCategoryId != null && event.queryStringParameters?.eid != null) {
        try {
            let eventCategoryId = event.pathParameters.eventCategoryId;
            let eventId = event.queryStringParameters.eid;
            // Expand GET parameters
            let jsonBody = event.queryStringParameters;
            console.log("event.queryStringParameters:", jsonBody);
            let projectId = 0;
            if (jsonBody?.pid) {
                projectId = jsonBody.pid;
            } else {
                let error = "invalid parameter. Project ID not found.";
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
            let validEventId;
            if (event?.requestContext?.authorizer?.eid) {
                validEventId = JSON.parse(event?.requestContext?.authorizer?.eid);
                // eidがない場合 もしくは 許可イベントIDに含まれていない場合
                if (!eventId || validEventId.indexOf(Number(eventId)) == -1) {
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

            mysql_con = await mysql.createConnection(readDbConfig);
            // Expand POST parameters 
            let sql_data = "";
            // get list sql
            sql_data = `SELECT 
                categoryId,
                eventCategoryStartDate,
                eventCategoryEndDate,
                eventCategoryViewType,
                filterId,
                memo
                FROM EventCategory
                WHERE eventId = ? AND eventCategoryId = ?`;
            console.log("query:", sql_data);
            var [query_result2] = await mysql_con.query(sql_data, [eventId, eventCategoryId]);
            let response = {
                // count: query_result1[0].count,
                records: query_result2[0]
            };
            // console.log(response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.log(error);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
    }
    // イベントIDだけの場合イベントカテゴリーの一覧を返す
    else if (event.queryStringParameters?.eid != null) {
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            console.log("got query string params!");
            // Expand POST parameters 
            let eventId = event.queryStringParameters?.eid;
            let sql_data = "";
            // get list sql
            sql_data = `SELECT 
                EventCategory.eventCategoryId,
                Category.categoryName,
                EventCategory.eventCategoryName,
                EventCategory.memo
                FROM EventCategory 
                LEFT OUTER JOIN Category ON EventCategory.categoryId = Category.categoryId
                WHERE EventCategory.eventId = ?
                ORDER BY eventCategoryId ASC`;
            console.log("query:", sql_data);
            let [query_result2] = await mysql_con.query(sql_data, [eventId]);
            let response = {
                // count: query_result1[0].count,
                records: query_result2
            };
            // console.log(response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.log(error);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
    }
    else {
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            console.log("got query string params!");
            let jsonBodyData = event.queryStringParameters;

            // Expand POST parameters 
            let sql_data = "";
            // get list sql
            sql_data = `SELECT 
                EventCategory.eventCategoryId,
                Category.categoryName,
                EventCategory.eventCategoryName,
                EventCategory.memo
                FROM EventCategory 
                LEFT OUTER JOIN Category ON EventCategory.categoryId = Category.categoryId
                WHERE Category.projectId = ?
                ORDER BY eventCategoryId ASC`;
            console.log("query:", sql_data);
            let [query_result2] = await mysql_con.query(sql_data, [jsonBodyData?.pid]);
            let response = {
                // count: query_result1[0].count,
                records: query_result2
            };
            // console.log(response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.log(error);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
    }
};