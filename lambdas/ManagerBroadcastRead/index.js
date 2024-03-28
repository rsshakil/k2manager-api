/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerBroadcastRead.
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
        process.env.DBINFO = true;
    }
    // Database info
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    // get broadcast user list
    if (event.pathParameters && event.pathParameters?.broadcastId) {
        let broadcastId = event.pathParameters?.broadcastId;
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
            // pidがない場合 もしく 許可プロジェクトIDに含まれていない場合
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

        // let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        // let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 300;
        let parameter = [];
        parameter.push(Number(projectId));
        parameter.push(Number(broadcastId));

        // total count sql
        const sql_count = `SELECT COUNT(BroadcastUser.broadcastUserId) AS count 
        FROM Broadcast
        INNER JOIN BroadcastUser ON Broadcast.broadcastId = BroadcastUser.broadcastId
        WHERE Broadcast.projectId = ? AND Broadcast.broadcastId = ?`;
        // get list sql
        const sql_data = `SELECT
        broadcastLastName,
        broadcastFirstName,
        broadcastEmailAddress,
        broadcastTelNo,
        broadcastAddress,
        broadcastVarious1,
        broadcastVarious2,
        broadcastVarious3,
        broadcastVarious4,
        broadcastVarious5,
        broadcastVarious6,
        broadcastVarious7,
        broadcastVarious8
        FROM Broadcast
        INNER JOIN BroadcastUser ON Broadcast.broadcastId = BroadcastUser.broadcastId
        WHERE Broadcast.projectId = ? AND Broadcast.broadcastId = ?
        ORDER BY BroadcastUser.broadcastUserId ASC`;

        console.log("sql_count:", sql_count);
        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        // get broadcast sql
        const sql_broadcast = `SELECT
        broadcastType,
        broadcastStatus
        FROM Broadcast
        WHERE Broadcast.projectId = ? AND Broadcast.broadcastId = ?`;

        console.log("sql_count:", sql_count);
        console.log("sql_data:", sql_data);
        console.log("sql_broadcast:", sql_broadcast);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            // count query execute
            let [query_result1] = await mysql_con.query(sql_count, parameter);
            // limit
            // parameter.push(Number(pagesVisited));
            // parameter.push(Number(itemsPerPage));
            // get query execute
            let [query_result2] = await mysql_con.query(sql_data, parameter);
            // get query execute
            let [query_result3] = await mysql_con.query(sql_broadcast, parameter);
            // get response
            let response = {
                count: query_result1[0].count,
                records: query_result2,
                data: query_result3[0],
                // page: pagesVisited,
                // limit: itemsPerPage
            };
            console.log("query response:", response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.log("error:", error);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    }
    // Get broadcast record list
    else if (event.queryStringParameters != null) {
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

        let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 300;

        // total count sql
        const sql_count = `SELECT COUNT(Broadcast.broadcastId) AS count FROM Broadcast WHERE Broadcast.projectId = ?`;
        // get list sql
        const sql_data = `SELECT
            Broadcast.broadcastId,
            Broadcast.projectId,
            Broadcast.broadcastType,
            Broadcast.broadcastStatus,
            Broadcast.broadcastScheduleDatetime,
            Broadcast.broadcastEditDatetime,
            Broadcast.broadcastCancelDatetime,
            Broadcast.broadcastCount,
            BroadcastTemplate.broadcastTemplateId,
            BroadcastTemplate.broadcastTemplateTitle
            FROM Broadcast 
            LEFT OUTER JOIN BroadcastTemplate ON Broadcast.broadcastId = BroadcastTemplate.broadcastId
            WHERE Broadcast.projectId = ?
            ORDER BY Broadcast.updatedAt DESC LIMIT ?, ?`;

        let parameter = [];
        parameter.push(Number(projectId));

        console.log("sql_count:", sql_count);
        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            // count query execute
            let [query_result1] = await mysql_con.query(sql_count, parameter);
            // limit
            parameter.push(Number(pagesVisited));
            parameter.push(Number(itemsPerPage));
            // count query execute
            let [query_result2] = await mysql_con.query(sql_data, parameter);
            // get response
            let response = {
                count: query_result1[0].count,
                records: query_result2,
                page: pagesVisited,
                limit: itemsPerPage
            };
            console.log("query response:", response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            console.log("error:", error);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    } else {
        let response = {
            message: "Invalid parameter."
        };
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        };
    }
};