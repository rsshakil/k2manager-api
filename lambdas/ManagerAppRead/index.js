/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerAppRead.
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

    // Get one record by primary key
    if (event.pathParameters && event.pathParameters?.appId) {
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

        let appId = event.pathParameters.appId;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT
            Event.eventId,
            App.appId,
            App.appName,
            App.appCode,
            App.appStatus,
            App.appDeployFlag,
            App.appDeployStatus,
            App.appBasicFlag,
            App.appBasicUser,
            App.appBasicPassword,
            App.appDomainId,
            App.appAPIDomainId,
            App.appAuthDomainId,
            App.accessCount,
            App.memo,
            App.appInitializeStatus,
            AppBase.appBaseId,
            CONCAT(AppBase.appBaseName ,'(' ,FROM_UNIXTIME(AppBase.createdAt, '%Y%m%d'), ')') as appBaseName
            FROM App
                LEFT OUTER JOIN Event ON App.eventId = Event.eventId 
                LEFT OUTER JOIN AppBase ON appBaseCurrentId = appBaseId
            WHERE
                App.appId = ? AND Event.projectId = ?`
        parameter.push(Number(appId));
        parameter.push(Number(projectId));

        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            let [query_result, query_fields] = await mysql_con.query(sql_data, parameter);
            if (query_result && query_result[0]) {
                // get response
                let response = {
                    records: query_result[0]
                }
                console.log("query response:", response);
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(response),
                }
            } else {
                let response = {
                    message: "no data"
                }
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(response),
                }
            }
        } catch (error) {
            console.log("error:", error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    }
    // Get record list
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

        let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 300;
        let parameter = [];
        let whereQuery = "";
        parameter.push(Number(projectId));

        // Other search query
        // eventId
        if (jsonBody.eventId) {
            whereQuery += ` AND Event.eventId = ?`;
            parameter.push(jsonBody.eventId);
        }
        // appName
        if (jsonBody.appName) {
            let appName = jsonBody.appName;
            if (appName.slice(0, 1) != '*' && appName.slice(-1) != '*') {
                whereQuery += ` AND App.appName = ?`;
                parameter.push(appName);
            } else {
                whereQuery += ` AND App.appName like ?`;
                parameter.push(appName.replace(/(^\*)|(\*$)/g, '%'));
            }
        }

        // limit
        parameter.push(Number(pagesVisited));
        parameter.push(Number(itemsPerPage));

        // total count sql
        const sql_count = `SELECT COUNT(appId) AS count FROM App INNER JOIN Event ON App.eventId = Event.eventId WHERE 1=1 AND Event.projectId = ? ${(whereQuery)}`;
        // get list sql
        const sql_data = `SELECT
            App.appId,
            App.appName,
            Domain1.domainURL AS appDomainName,
            Event.eventName,
            App.accessCount,
            App.appStatus,
            App.appDeployFlag,
            App.appDeployStatus,
            App.appBasicFlag,
            App.appBasicUser,
            App.appInitializeStatus
            FROM App LEFT OUTER JOIN Event ON App.eventId = Event.eventId 
                LEFT OUTER JOIN Domain AS Domain1 ON App.appDomainId = Domain1.domainId
            WHERE
                1=1 AND Event.projectId = ? ${(whereQuery)}
            ORDER BY App.updatedAt DESC
            LIMIT ?, ?`

        console.log("sql_count:", sql_count);
        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            // count query execute
            let [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
            // count query execute
            let [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);
            // get response
            let response = {
                count: query_result1[0].count,
                records: query_result2,
                page: pagesVisited,
                limit: itemsPerPage
            }
            console.log("query response:", response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log("error:", error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
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
        }
    }
};