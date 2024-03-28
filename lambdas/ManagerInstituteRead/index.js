/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerInstituteRead.
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
    if (event.pathParameters && event.pathParameters?.instituteId) {
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
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }
        let validInstituteId;
        if (event?.requestContext?.authorizer?.iid) {
            validInstituteId = JSON.parse(event?.requestContext?.authorizer?.iid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!event.pathParameters?.instituteId || validInstituteId.indexOf(Number(event.pathParameters?.instituteId)) == -1) {
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        let instituteId = event.pathParameters.instituteId;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT * FROM Institute WHERE Institute.instituteId = ? AND Institute.projectId = ?`
        parameter.push(Number(instituteId));
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
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 300;
        let parameter = [];
        let whereQuery = "";
        parameter.push(Number(projectId));

        // Other search query
        // instituteZipCode
        if (jsonBody.instituteZipCode) {
            let instituteZipCode = jsonBody.instituteZipCode;
            if (instituteZipCode.slice(0, 1) != '*' && instituteZipCode.slice(-1) != '*') {
                whereQuery += ` AND Institute.instituteZipCode = ?`;
                parameter.push(instituteZipCode);
            } else {
                whereQuery += ` AND Institute.instituteZipCode like ?`;
                parameter.push(instituteZipCode.replace(/(^\*)|(\*$)/g, '%'));
            }
        }
        // instituteName
        if (jsonBody.instituteName) {
            let instituteName = jsonBody.instituteName;
            if (instituteName.slice(0, 1) != '*' && instituteName.slice(-1) != '*') {
                whereQuery += ` AND Institute.instituteName = ?`;
                parameter.push(instituteName);
            } else {
                whereQuery += ` AND Institute.instituteName like ?`;
                parameter.push(instituteName.replace(/(^\*)|(\*$)/g, '%'));
            }
        }
        // instituteManageName
        if (jsonBody.instituteManageName) {
            let instituteManageName = jsonBody.instituteManageName;
            if (instituteManageName.slice(0, 1) != '*' && instituteManageName.slice(-1) != '*') {
                whereQuery += ` AND Institute.instituteManageName = ?`;
                parameter.push(instituteManageName);
            } else {
                whereQuery += ` AND Institute.instituteManageName like ?`;
                parameter.push(instituteManageName.replace(/(^\*)|(\*$)/g, '%'));
            }
        }
        if (event?.requestContext?.authorizer?.iid) {
            validInstituteId = JSON.parse(event?.requestContext?.authorizer?.iid)
            whereQuery += ` AND Institute.instituteId IN (?)`;
            parameter.push(validInstituteId);
        }

        // limit
        parameter.push(Number(pagesVisited));
        parameter.push(Number(itemsPerPage));

        // total count sql
        const sql_count = `SELECT COUNT(instituteId) AS count FROM Institute WHERE Institute.projectId = ? ${(whereQuery)}`;
        // get list sql
        // const sql_data = `SELECT Institute.*,EventInstitute.eventInstituteId FROM Institute
        // LEFT OUTER JOIN EventInstitute ON Institute.instituteId = EventInstitute.instituteId
        // WHERE Institute.projectId = ? ${whereQuery} ORDER BY Institute.updatedAt DESC LIMIT ?, ?`
        const sql_data = `SELECT Institute.*, 
        CASE WHEN Institute.instituteManageName IS NULL OR Institute.instituteManageName = '' THEN
            Institute.instituteName 
        ELSE 
            CONCAT(Institute.instituteName, '（', Institute.instituteManageName, '）')
        END AS instituteSpecialName,
        GROUP_CONCAT(EventInstitute.eventInstituteId) AS eventInstituteId
        FROM Institute LEFT OUTER JOIN EventInstitute ON Institute.instituteId = EventInstitute.instituteId
        WHERE Institute.projectId = ? ${whereQuery} GROUP BY Institute.instituteId ORDER BY Institute.updatedAt DESC  LIMIT ?, ?`

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