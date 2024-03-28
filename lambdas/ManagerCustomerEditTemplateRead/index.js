/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerCustomerEditTemplateRead.
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

    // Get customer edit template record
    if (event.pathParameters && event.pathParameters?.customerEditTemplateId) {
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

        let customerEditTemplateId = event.pathParameters.customerEditTemplateId;
        // get one record sql
        const sql_data = `SELECT * FROM CustomerEditTemplate WHERE CustomerEditTemplate.customerEditTemplateId = ?`
        const sql_field = `SELECT * FROM Field WHERE 1=1 AND fieldId IN (?)`

        let sql_param = [];
        let sql_field_param = [];
        sql_param.push(Number(customerEditTemplateId));
        // sql_param.push(Number(projectId));

        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            
            let [query_result, query_fields] = await mysql_con.query(sql_data, sql_param);
            
            if (query_result && query_result[0]) {

                let fieldIdList = query_result[0]?.customerEditTemplateColumn?.length>0 && query_result[0]?.customerEditTemplateColumn.map(fInfo=>fInfo.fTypeId);
                console.log("fieldIdList:", fieldIdList);
                if(fieldIdList.length>0){
                    sql_field_param.push(fieldIdList);
                    let [query_result2, query_fields2] = await mysql_con.query(sql_field, sql_field_param);
                    console.log("fieldIdListquery_fields2:", query_fields2);

                    query_result[0].fieldListInfo=query_result2;
                }

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

        let customerEditTemplateTypeFlag = jsonBody.customerEditTemplateTypeFlag;
        let parameter = [];
        // get one record sql
        const sql_data = `SELECT * FROM CustomerEditTemplate WHERE CustomerEditTemplate.customerEditTemplateTypeFlag = ? AND CustomerEditTemplate.projectId = ?`
        // const sql_data = `SELECT CustomerEditTemplate.* FROM CustomerEditTemplate WHERE CustomerEditTemplate.projectId = ?`
        parameter.push(Number(customerEditTemplateTypeFlag));
        parameter.push(Number(projectId));

        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            let [query_result] = await mysql_con.query(sql_data, parameter);
            if (query_result && query_result[0]) {
                // get response
                let response = {
                    records: query_result
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
                // let response = {
                //     message: "no data"
                // }
                let response = {
                    records: []
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