/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerFieldRead.
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
    if (event.pathParameters && event.pathParameters?.fieldId) {
        console.log("query ----------------- 1");
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


        let fieldId = event.pathParameters.fieldId;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT * FROM Field WHERE Field.fieldId = ? AND Field.projectId = ?`
        parameter.push(Number(fieldId));
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
        console.log("query ----------------- 2");
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

        let fieldType = jsonBody?.fieldType
        let addFlag = jsonBody?.addFlag;
        let fieldImportFlag = jsonBody?.fieldImportFlag;
        let searchFiledFlag = jsonBody?.searchFiledFlag;
        if (fieldType) {
            let parameter = [];
            let whereQuery = "";
            let wherefieldImportFlag = "";
            let whereSearchFiledFlag = "";
            let sql_data;
            console.log("xxx --- 1", fieldType)
            console.log("typeof", typeof fieldType)
            console.log("length", fieldType.length)

            fieldType = fieldType.split(',');


            if (addFlag) {
                whereQuery = `AND fieldAddFlag = ?`;
            }

            if (searchFiledFlag==1) {
                whereSearchFiledFlag = `AND fieldSearchFlag = ?`;
            }

            if (fieldImportFlag) {
                fieldImportFlag = fieldImportFlag.split(',');
                if (fieldImportFlag == 0) {
                    wherefieldImportFlag = `AND fieldImportFlag >=?`;
                    fieldImportFlag = 3
                } else {
                    wherefieldImportFlag = `AND fieldImportFlag IN(?)`;

                }
            }
            // get list sql
            sql_data = `SELECT 
                Field.*,
                Category.categoryManageName,
                Institute.instituteManageName,
                Item.itemManageName
            FROM Field 
            LEFT OUTER JOIN Category ON Field.fieldColumnSubId = Category.categoryId
            LEFT OUTER JOIN Institute ON Field.fieldColumnSubId = Institute.instituteId
            LEFT OUTER JOIN Item ON Field.fieldColumnSubId = Item.itemId
            WHERE 1=1 AND fieldType IN (?) AND (Field.projectId = 0 OR Field.projectId = ?) ${whereQuery} ${wherefieldImportFlag} ${whereSearchFiledFlag}
            ORDER BY Field.fieldGroupId ASC, Field.fieldOrder ASC, Field.fieldManageName COLLATE utf8mb4_unicode_ci ASC, Field.fieldName COLLATE utf8mb4_unicode_ci ASC `
            parameter.push(fieldType);
            parameter.push(Number(projectId));
            if (whereQuery != '') {
                parameter.push(Number(addFlag));
            }
            if (wherefieldImportFlag != '') {
                parameter.push(fieldImportFlag);
            }
            if (whereSearchFiledFlag != '') {
                parameter.push(1);
            }
            // console.log("sql_count:", sql_count);
            console.log("sql_data:", sql_data);
            console.log("query params:", parameter);
            // }
            //             else {
            // console.log("xxx --- 2")
            //                 // get list sql
            //                 sql_data = `SELECT * FROM Field WHERE 1=1 AND fieldType = ? AND (projectId = 0 OR projectId = ?) ORDER BY Field.updatedAt DESC`
            //                 parameter.push(Number(fieldType));
            //                 parameter.push(Number(projectId));
            //                 // console.log("sql_count:", sql_count);
            //                 console.log("sql_data:", sql_data);
            //                 console.log("query params:", parameter);
            //             }

            let mysql_con;
            try {
                // mysql connect
                mysql_con = await mysql.createConnection(readDbConfig);
                // count query execute
                let [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);
                let result = [];
                for (let i = 0; i < query_result2.length; i++) {
                    let row = query_result2[i];
                    // if (row.categoryManageName != null) {
                    if (row.fieldColumnName == "Category.categoryId") {
                        row.fieldSpecialName = row.categoryManageName ? row.fieldName + "（" + row.categoryManageName + "）" : row.fieldName;
                    }
                    else if (row.fieldColumnName == "Institute.instituteId") {
                        row.fieldSpecialName = row.instituteManageName ? row.fieldName + "（" + row.instituteManageName + "）" : row.fieldName;
                    }
                    else if (row.fieldColumnName == "Item.itemId") {
                        row.fieldSpecialName = row.itemManageName ? row.fieldName + "（" + row.itemManageName + "）" : row.fieldName;
                    }
                    result.push(row);
                }
                // get response
                let response = {
                    records: result
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

        }
        else {
            let pagesVisited = (jsonBody?.pagesVisited || jsonBody?.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
            let itemsPerPage = (jsonBody?.itemsPerPage || jsonBody?.itemsPerPage == 0) ? jsonBody.itemsPerPage : 1000;
            let parameter = [];
            let whereQuery = "";

            // Other search query
            // fieldName
            if (jsonBody.fieldName) {
                let fieldName = jsonBody.fieldName;
                if (fieldName.slice(0, 1) != '*' && fieldName.slice(-1) != '*') {
                    whereQuery += ` AND Field.fieldName = ?`;
                    parameter.push(fieldName);
                } else {
                    whereQuery += ` AND Field.fieldName like ?`;
                    parameter.push(fieldName.replace(/(^\*)|(\*$)/g, '%'));
                }
            }
            // fieldManageName
            if (jsonBody.fieldManageName) {
                let fieldManageName = jsonBody.fieldManageName;
                if (fieldManageName.slice(0, 1) != '*' && fieldManageName.slice(-1) != '*') {
                    whereQuery += ` AND Field.fieldManageName = ?`;
                    parameter.push(fieldManageName);
                } else {
                    whereQuery += ` AND Field.fieldManageName like ?`;
                    parameter.push(fieldManageName.replace(/(^\*)|(\*$)/g, '%'));
                }
            }
            // 除外フィールドID
            if (jsonBody.exceptFieldId) {
                whereQuery += ` AND Field.fieldId !=  ?`;
                parameter.push(Number(jsonBody.exceptFieldId));
            }
            // 特殊フィールドを含むかどうか？
            //　含む場合　projectId = 0 も条件に加える
            if (jsonBody.specialField) {
                whereQuery += ` AND (Field.projectId = ? || Field.projectId = ?)`;
                parameter.push(0);
                parameter.push(Number(projectId));
            } else {
                whereQuery += ` AND Field.projectId = ?`
                parameter.push(Number(projectId));
            }

            // limit
            parameter.push(Number(pagesVisited));
            parameter.push(Number(itemsPerPage));

            // total count sql
            const sql_count = `SELECT COUNT(fieldId) AS count FROM Field WHERE fieldType != 10 ${(whereQuery)} `;
            // get list sql
            const sql_data = `SELECT * FROM Field WHERE fieldType != 10 ${whereQuery} ORDER BY Field.fieldGroupId ASC, Field.fieldOrder ASC, Field.fieldManageName COLLATE utf8mb4_unicode_ci ASC, Field.fieldName COLLATE utf8mb4_unicode_ci ASC LIMIT ?, ?`
            // const sql_data = `SELECT * FROM Field WHERE fieldType != 10 ${whereQuery} ORDER BY Field.fieldGroupId ASC, Field.fieldOrder ASC LIMIT ?, ?`

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