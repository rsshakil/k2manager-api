/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerAppBaseRead.
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

    if (event.pathParameters && event.pathParameters?.appId) {
        let appId = event.pathParameters.appId;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT
                App.appBaseCurrentId,
                CONCAT(AppBase.appBaseName ,'(' ,FROM_UNIXTIME(AppBase.createdAt, '%Y%m%d'), ')') as currentVer
            FROM App
                LEFT OUTER JOIN AppBase ON App.appBaseCurrentId = AppBase.appBaseId
            WHERE
                App.appId = ?`
        parameter.push(appId);

        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        // get list record sql
        const sql_listData = `SELECT
                appBaseId,
                CONCAT(appBaseName ,'(' ,FROM_UNIXTIME(createdAt, '%Y%m%d'), ')') as currentVer
            FROM AppBase
            WHERE
                appBaseStatus = 1
            ORDER BY updatedAt DESC`

        console.log("sql_listData:", sql_listData);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            let [query_result1] = await mysql_con.query(sql_data, parameter);
            if (query_result1 && query_result1[0]) {
                let [query_result2] = await mysql_con.query(sql_listData);

                // get response
                let response = {
                    currentVerInfo: query_result1[0],
                    records: query_result2
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
}