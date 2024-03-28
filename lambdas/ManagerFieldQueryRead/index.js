/**
* @type {import('@types/aws-lambda').APIGatewayProxyHandler}
* クエリー用の読み込みにする
*/
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

exports.handler = async (event, context) => {
    console.log(event);
    console.log("logGroupName = " + context.logGroupName)
    console.log("logStreamName = " + context.logStreamName)
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
    let mysql_con;
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    console.log("Event data:", event);
    // mysql connect

    try {
        mysql_con = await mysql.createConnection(readDbConfig);

        if (event.pathParameters && event.pathParameters.fieldId) {

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
            let fieldId = (jsonBody.fieldId || jsonBody.fieldId == 0) ? jsonBody.fieldId : 0;
            // Other search query ( roleId , accountName)
            let parameter = [];
            let searchFlag = false;
            let sql_count = "";
            let sql_data = "";
            let whereQuery = "";
            // total count sql
            // get list sql
            sql_data = `SELECT * FROM Field WHERE Field.fieldId = ?`
            parameter.push(Number(fieldId));
            try {
                //
                // var [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
                console.log("Query string params: ", parameter);
                console.log("query:", sql_data);
                var [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);
                if (query_result2 && query_result2[0]) {
                    // 
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
                }
                else {
                    // 
                    let response = {
                        // count: query_result1[0].count,
                        message: "no data"
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
        // プロジェクトIDが自分のID + 0のものも取得
        else if (!event.pathParameters) {
            try {
                // Expand POST parameters 
                let jsonBody = event.queryStringParameters;
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

                // Other search query ( roleId , accountName)
                let parameter = [];
                let sql_data = "";
                let whereQuery = "";
                // フィールド名
                if (jsonBody.fieldName) {
                    whereQuery += ` AND Field.fieldName like ?`;
                    parameter.push("%" + jsonBody.fieldName + "%");
                }
                // 除外フィールドID
                if (jsonBody.exceptFieldId) {
                    whereQuery += ` AND Field.fieldId !=  ?`;
                    parameter.push(Number(jsonBody.exceptFieldId));
                }
                whereQuery += ` AND (Field.projectId = ? || Field.projectId = ?)`;
                parameter.push(0);
                parameter.push(Number(projectId));
                // get list sql
                sql_data = `SELECT * FROM Field WHERE 1=1 ${(whereQuery)}
                ORDER BY fieldGroupId ASC, fieldOrder ASC`
                //
                console.log("Query string params: ", parameter);
                console.log("query:", sql_data);
                var [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);

                // 適した形に変更する
                let fieldData = [];
                for (let i = 0; i < query_result2.length; i++) {
                    let row = query_result2[i];
                    let fieldQueryStyle = [];
                    let groupName = "";

                    if (row.fieldGroupId == 1) {
                        groupName = "基本グループ";
                    }
                    else if (row.fieldGroupId == 2) {
                        groupName = "個人情報グループ";
                    }
                    else if (row.fieldGroupId == 3) {
                        groupName = "予約情報グループ";
                    }
                    else if (row.fieldGroupId == 4) {
                        switch (row.fieldType) {
                            case 0: groupName = "テキスト型"; break;
                            case 1: groupName = "テキストエリア型"; break;
                            case 2: groupName = "結合テキスト型"; break;
                            case 3: groupName = "リスト型"; break;
                            case 4: groupName = "YesNo型"; break;
                            case 5: groupName = "日付型"; break;
                            case 6: groupName = "時間型"; break;
                            case 7: groupName = "数値型"; break;
                        }
                    }

                    switch (row.fieldType) {
                        // テキスト型
                        case 0:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "string",
                                dataField: groupName + "." + row.fieldCode,
                                filterOperations: ["contains", "notcontains", "startswith", "endswith", "=", "<>", "isblank", "isnotblank", "regex", "minlength", "maxlength", "same", "notsame"],
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // テキストエリア型
                        case 1:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "string",
                                dataField: groupName + "." + row.fieldCode,
                                filterOperations: ["contains", "notcontains", "startswith", "endswith", "=", "<>", "isblank", "isnotblank", "regex", "minlength", "maxlength", "same", "notsame"],
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // 結合テキスト型
                        case 2:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "string",
                                dataField: groupName + "." + row.fieldCode,
                                filterOperations: ["contains", "notcontains", "startswith", "endswith", "=", "<>", "isblank", "isnotblank", "regex", "minlength", "maxlength", "same", "notsame"],
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // リスト型
                        case 3:
                            let dataSource = [];
                            if (row.fieldStyle?.lookup) {
                                for (let j = 0; j < row.fieldStyle?.lookup.length; j++) {
                                    let row2 = row.fieldStyle?.lookup[j];
                                    let lookupStyle = {
                                        id: row2.number,
                                        name: row2.inputBox2.value,
                                        value: row2.fieldListCode,
                                    }
                                    dataSource.push(lookupStyle);
                                }
                                fieldQueryStyle = {
                                    caption: row.fieldStyle?.caption,
                                    dataField: groupName + "." + row.fieldStyle?.dataField,
                                    name: row.fieldStyle?.name,
                                    filterOperations: ["isblank", "isnotblank", "listinclude", "listnotinclude"],
                                    lookup: {
                                        allowClearing: false,
                                        displayExpr: "name",
                                        valueExpr: "value",
                                        dataSource: dataSource
                                    }
                                }
                            }
                            else {
                                fieldQueryStyle = {
                                    caption: row.fieldName,
                                    dataField: groupName + "." + row.fieldCode,
                                    name: row.fieldCode,
                                    filterOperations: ["isblank", "isnotblank", "same", "notsame", "listinclude", "listnotinclude"],
                                }
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // YesNo型
                        case 4:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "boolean",
                                dataField: groupName + "." + row.fieldCode,
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName,
                                trueText: row.fieldStyle?.trueText,
                                falseText: row.fieldStyle?.falseText,
                                filterOperations: ["=", "<>", "isblank", "isnotblank", "same", "notsame"]
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // 日付型
                        case 5:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "date",
                                dataField: groupName + "." + row.fieldCode,
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName,
                                filterOperations: ["=", "<>", "<", ">", "<=", ">=", "between", "=date", "<>date", "<date", ">date", "<=date", ">=date", "samedate", "notsamedate", "isblank", "isnotblank", "rangefrom", "rangeto", "same", "notsame", "nowgreaterthan", "nowlessthan"]
                                // filterOperations: ["=date", "<>date", "<date", ">date", "<=date", ">=date", "isblank", "isnotblank", "rangefrom", "rangeto", "regex", "minlength", "maxlength", "same", "notsame", "nowgreaterthan", "nowlessthan"]
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // 時間型
                        case 6:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "number",
                                dataField: groupName + "." + row.fieldCode,
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName,
                                filterOperations: ["=", "<>", "<", ">", "<=", ">=", "between", "isblank", "isnotblank", "same", "notsame"]
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                        // 数字型
                        case 7:
                            fieldQueryStyle = {
                                caption: row.fieldName,
                                dataType: "number",
                                dataField: groupName + "." + row.fieldCode,
                                name: row.fieldCode,
                                fieldColumnName: row.fieldColumnName,
                                filterOperations: ["=", "<>", "<", ">", "<=", ">=", "between", "isblank", "isnotblank", "regex", "minlength", "maxlength", "same", "notsame"]
                            }
                            fieldData.push(fieldQueryStyle);
                            break;
                    }

                }
                // 
                let response = {
                    records: fieldData
                }
                console.log(response);
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
            console.log(event.pathParameters);
            let error = "invalid parameter"
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
    catch (error2) {
        console.log(error2)
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(error2),
        }
    }
    finally {
        if (mysql_con) mysql_con.close();
    }
}
