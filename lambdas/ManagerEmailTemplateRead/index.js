/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerEmailTemplateRead.
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

    let jsonBody = event.queryStringParameters;
    // Get one record by primary key
    if (event.pathParameters && jsonBody.eventCategoryId) {
        // Expand GET parameters
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

        let eventCategoryId = jsonBody.eventCategoryId;
        let typeFlag = jsonBody.typeFlag;

        let sql_param = [];
        // get one record sql
        const sql_data = `SELECT * FROM EmailTemplate WHERE EmailTemplate.eventCategoryId = ? AND EmailTemplate.emailTemplateTypeFlag = ?`;
        sql_param.push(Number(eventCategoryId));
        sql_param.push(Number(typeFlag));

        console.log("sql_data:", sql_data);
        console.log("query params:", sql_param);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            let [query_result] = await mysql_con.query(sql_data, sql_param);

            let sql_param2 = [];
            // get multiple record sql
            const sql_data2 = `SELECT fieldId, fieldName, fieldGroupId, fieldType, CONCAT('[%', fieldCode, '%]') AS fieldCode FROM Field WHERE Field.projectId = 0 OR Field.projectId = ? ORDER BY Field.fieldId ASC`;
            sql_param2.push(Number(projectId));

            console.log("sql_data:", sql_data2);
            console.log("query params:", sql_param2);

            let [query_result2] = await mysql_con.query(sql_data2, sql_param2);

            // 適した形に変更する
            let fieldData = [];

            // 基本グループ
            fieldData.push({ Task_ID: 10000000001, Task_Parent_ID: 0, fieldType: "基本グループ", fieldCode: "" });
            // 個人情報グループ
            fieldData.push({ Task_ID: 10000000002, Task_Parent_ID: 0, fieldType: "個人情報グループ", fieldCode: "" });
            // 予約情報グループ
            fieldData.push({ Task_ID: 10000000003, Task_Parent_ID: 0, fieldType: "予約情報グループ", fieldCode: "" });
            // カスタムフィールド
            fieldData.push({ Task_ID: 10000000004, Task_Parent_ID: 0, fieldType: "カスタムフィールド", fieldCode: "" });
            // テキスト型
            fieldData.push({ Task_ID: 100000000040, Task_Parent_ID: 10000000004, fieldType: "テキスト型", fieldCode: "" });
            // テキストエリア型
            fieldData.push({ Task_ID: 100000000041, Task_Parent_ID: 10000000004, fieldType: "テキストエリア型", fieldCode: "" });
            // 結合テキスト型
            fieldData.push({ Task_ID: 100000000042, Task_Parent_ID: 10000000004, fieldType: "結合テキスト型", fieldCode: "" });
            // リスト型
            fieldData.push({ Task_ID: 100000000043, Task_Parent_ID: 10000000004, fieldType: "リスト型", fieldCode: "" });
            // YesNo型
            fieldData.push({ Task_ID: 100000000044, Task_Parent_ID: 10000000004, fieldType: "YesNo型", fieldCode: "" });
            // 日付型
            fieldData.push({ Task_ID: 100000000045, Task_Parent_ID: 10000000004, fieldType: "日付型", fieldCode: "" });
            // 時間型
            fieldData.push({ Task_ID: 100000000046, Task_Parent_ID: 10000000004, fieldType: "時間型", fieldCode: "" });
            // 数値型
            fieldData.push({ Task_ID: 100000000047, Task_Parent_ID: 10000000004, fieldType: "数値型", fieldCode: "" });

            for (let i = 0; i < query_result2.length; i++) {
                let row = query_result2[i];
                let fieldDataSource = [];
                if (row.fieldGroupId == 1) {
                    fieldDataSource = {
                        Task_ID: row.fieldId,
                        Task_Parent_ID: 10000000001,
                        fieldType: row.fieldName,
                        fieldCode: row.fieldCode
                    };
                    fieldData.push(fieldDataSource);
                }
                else if (row.fieldGroupId == 2) {
                    fieldDataSource = {
                        Task_ID: row.fieldId,
                        Task_Parent_ID: 10000000002,
                        fieldType: row.fieldName,
                        fieldCode: row.fieldCode
                    };
                    fieldData.push(fieldDataSource);
                }
                else if (row.fieldGroupId == 3) {
                    fieldDataSource = {
                        Task_ID: row.fieldId,
                        Task_Parent_ID: 10000000003,
                        fieldType: row.fieldName,
                        fieldCode: row.fieldCode
                    };
                    fieldData.push(fieldDataSource);
                }
                else if (row.fieldGroupId == 4) {
                    switch (row.fieldType) {
                        case 0: // テキスト型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000040, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 1: // テキストエリア型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000041, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 2: // 結合テキスト型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000042, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 3: // リスト型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000043, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 4: // YesNo型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000044, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 5: // 日付型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000045, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 6: // 時間型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000046, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                        case 7: // 数値型
                            fieldDataSource = { Task_ID: row.fieldId, Task_Parent_ID: 100000000047, fieldType: row.fieldName, fieldCode: row.fieldCode };
                            break;
                    }
                    if (fieldDataSource.length !== 0) {
                        fieldData.push(fieldDataSource);
                    }
                }
            }

            // get response
            let response = {
                template: query_result[0],
                fields: [fieldData],
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