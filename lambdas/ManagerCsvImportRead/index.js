/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
*/
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
* ManagerCsvRead.
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
    if (event.pathParameters && event.pathParameters?.csvId) {
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

        let csvId = event.pathParameters.csvId;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT * FROM CSV WHERE CSV.csvId = ? AND CSV.projectId = ?`
        parameter.push(Number(csvId));
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
        // csvCreateDatetime
        if (jsonBody.csvCreateDateTimeFrom && jsonBody.csvCreateDateTimeTo) {
            whereQuery += ` AND (CSV.csvCreateDatetime >= ? AND CSV.csvCreateDatetime <= ?)`;
            parameter.push(Number(jsonBody.csvCreateDateTimeFrom));
            parameter.push(Number(jsonBody.csvCreateDateTimeTo));
        } else if (jsonBody.csvCreateDateTimeFrom) {
            whereQuery += ` AND CSV.csvCreateDatetime >= ?`;
            parameter.push(Number(jsonBody.csvCreateDateTimeFrom));
        } else if (jsonBody.csvCreateDateTimeTo) {
            whereQuery += ` AND CSV.csvCreateDatetime <= ?`;
            parameter.push(Number(jsonBody.csvCreateDateTimeTo));
        }
        // csvName
        if (jsonBody.csvName) {
            let csvName = jsonBody.csvName;
            if (csvName.slice(0, 1) != '*' && csvName.slice(-1) != '*') {
                whereQuery += ` AND CSV.csvName = ?`;
                parameter.push(csvName);
            } else {
                whereQuery += ` AND CSV.csvName like ?`;
                parameter.push(csvName.replace(/(^\*)|(\*$)/g, '%'));
            }
        }
        if (event?.requestContext?.authorizer?.rid) {
            whereQuery = `AND (
                JSON_CONTAINS(csvImportTemplateAuthRole, '?', '$' ) 
                    OR (
                        csvImportTemplateAuthRole IS NULL 
                        OR
                        JSON_EXTRACT(csvImportTemplateAuthRole, '$') = JSON_ARRAY()
                    )
                )
            `;
            parameter.push(Number(event?.requestContext?.authorizer?.rid));
        }




        // limit
        parameter.push(Number(pagesVisited));
        parameter.push(Number(itemsPerPage));

        // total count sql
        const sql_count = `SELECT COUNT(CsvImport.csvImportId) AS count FROM CsvImport left join CsvImportTemplate on CsvImportTemplate.csvImportTemplateId = CsvImport.csvImportTemplateId WHERE CsvImport.projectId = ? ${(whereQuery)}`;
        // get list sql
        const sql_data = `SELECT 
        CsvImport.csvImportId,
        CsvImport.csvImportTemplateId,
        CsvImport.csvImportFileName,
        CsvImport.csvImportStatus,
        CASE WHEN CsvImport.csvImportStatus is null then '' WHEN CsvImport.csvImportStatus = 0 THEN 'インポート前' WHEN CsvImport.csvImportStatus = 1 THEN 'インポート中' WHEN CsvImport.csvImportStatus = 2 THEN 'インポート成功' WHEN CsvImport.csvImportStatus = 3 THEN 'インポート失敗' ELSE '' END AS importStatus,
        DATE_FORMAT(from_unixtime(CsvImport.csvImportExecDatetime), '%Y/%m/%d %H:%i') AS csvImportExecDate,
        CsvImport.csvImportDataCount,
        CsvImport.csvImportDelFlag,
        CsvImportTemplate.csvImportTemplateId,
        CsvImportTemplate.csvImportTemplateName,
        CsvImportTemplate.csvImportTemplateAuthRole
        FROM CsvImport left join CsvImportTemplate on CsvImportTemplate.csvImportTemplateId = CsvImport.csvImportTemplateId WHERE CsvImport.projectId = ? ${whereQuery} ORDER BY CsvImport.updatedAt DESC LIMIT ?, ?`

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