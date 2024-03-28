/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerAccountRead.
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
    if (event.pathParameters && event.pathParameters?.accountId) {
        let accountId = event.pathParameters.accountId;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT
                accountId,
                email,
                fullName,
                initialPassword,
                initialPasswordStr,
                initialState,
                isLocked,
                lastLoginTime,
                loginTime,
                passwordHistory,
                Account.roleId,
                Role.roleName,
                currentLoginFailureCount,
                lastLoginFailureCount,
                passwordExpirationDate,
                Account.memo,
                Account.createdAt,
                Account.createdBy,
                Account.updatedAt,
                Account.updatedBy
            FROM Account
                INNER JOIN Role ON Account.roleId = Role.roleId
            WHERE
                accountId = ?
            LIMIT 0, 1`
        parameter.push(accountId);

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
        let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 300;
        let parameter = [];
        let whereQuery = "";

        // Other search query
        // roleId
        if (jsonBody.roleId) {
            whereQuery += ` AND Account.roleId = ?`;
            parameter.push(parseInt(jsonBody.roleId));
        }

        if (jsonBody.domainName) {
            let domainName = jsonBody.domainName;
            if (domainName.slice(0, 1) != '*' && domainName.slice(-1) != '*') {
                whereQuery += ` AND Domain.domainName = ?`;
                parameter.push(domainName);
            } else {
                whereQuery += ` AND Domain.domainName like ?`;
                parameter.push(domainName.replace(/(^\*)|(\*$)/g, '%'));
            }
        }
        // accountName
        if (jsonBody.accountName) {
            if (jsonBody.accountName.slice(0, 1) != '*' && jsonBody.accountName.slice(-1) != '*') {
                whereQuery += ` AND (accountId = ? OR fullName = ?)`;
                parameter.push(jsonBody.accountName);
                parameter.push(jsonBody.accountName);
            } else {
                whereQuery += ` AND (accountId like ? OR fullName like ?)`;
                jsonBody.accountName = jsonBody.accountName.replace(/(^\*)|(\*$)/g, '%');
                parameter.push(jsonBody.accountName);
                parameter.push(jsonBody.accountName);
            }
        }

        // limit
        parameter.push(Number(pagesVisited));
        parameter.push(Number(itemsPerPage));

        // total count sql
        const sql_count = `SELECT COUNT(id) as count FROM Account INNER JOIN Role ON Account.roleId = Role.roleId WHERE 1=1 ${(whereQuery)}`;
        // get list sql
        const sql_data = `SELECT
                accountId,
                email,
                fullName,
                initialState,
                isLocked,
                lastLoginTime,
                loginTime,
                passwordHistory,
                Account.roleId,
                Role.roleName,
                currentLoginFailureCount,
                lastLoginFailureCount,
                passwordExpirationDate,
                Account.memo,
                Account.createdAt,
                Account.createdBy,
                Account.updatedAt,
                Account.updatedBy
            FROM Account
                INNER JOIN Role ON Account.roleId = Role.roleId 
            WHERE
                1=1 ${(whereQuery)}
            ORDER BY lastLoginTime DESC, id DESC
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
}