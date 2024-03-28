/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerFilterCreate.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event, context) => {
    console.log("Event data:", event);
    let logData = [];
    let logAccountId;
    // Reading encrypted environment variables --- required
    if (process.env.DBINFO == null) {
        const ssmreq = {
            Name: 'DBINFO_' + process.env.ENV,
            WithDecryption: true,
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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET,
    };
    let projectId = event.queryStringParameters?.pid
    let mysql_con;
    try {
        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!event.queryStringParameters?.pid || validProjectId.indexOf(Number(event.queryStringParameters?.pid)) == -1) {
                // failure log
                await createLog(context, 'フィルター', '作成', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        // フィルターのコピー処理
        if (event.pathParameters?.filterId) {
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            const {
                createdBy
            } = JSON.parse(event.body);
            // get data
            let parameter = [];
            let filterId = event.pathParameters?.filterId;
            projectId = event.queryStringParameters?.pid;
            const sql_data = `SELECT * FROM Filter WHERE Filter.filterId = ? AND Filter.projectId = ?`;
            parameter.push(Number(filterId));
            parameter.push(Number(projectId));

            let [query_result] = await mysql_con.query(sql_data, parameter);
            if (query_result && query_result[0]) {
                const {
                    filterName,
                    filterManageName,
                    filterOverview,
                    filterQuery,
                    memo
                } = query_result[0];
                logAccountId = createdBy;
                // insert data query
                let copy_sql = `INSERT INTO Filter (
                    projectId,
                    filterName,
                    filterManageName,
                    filterOverview,
                    filterQuery,
                    memo,
                    createdAt,
                    createdBy,
                    updatedAt,
                    updatedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
                // created date
                const createdAt = Math.floor(new Date().getTime() / 1000);
                let copy_param = [
                    projectId,
                    filterName + "（コピー）",
                    filterManageName,
                    filterOverview,
                    filterQuery,
                    memo,
                    createdAt,
                    createdBy,
                    createdAt,
                    createdBy,
                ];
                console.log("sql_data:", copy_sql);
                console.log("sql_data:", copy_param);
                const [query_copy_result] = await mysql_con.execute(copy_sql, copy_param);
                await mysql_con.commit();
                let newFilterId = query_copy_result.insertId;

                // ログ書き込み
                logData[0] = {};
                logData[0].fieldName = "プロジェクトID";
                logData[0].beforeValue = projectId;
                logData[0].afterValue = projectId;
                logData[1] = {};
                logData[1].fieldName = "フィルターID";
                logData[1].beforeValue = filterId;
                logData[1].afterValue = newFilterId;

                // construct the response
                let response = {
                    records: query_copy_result[0]
                };
                // console.log("response:", response);
                // success log
                await createLog(context, 'フィルター', '複製', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 200,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify(response),
                };
            }
            else {
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'フィルター', '複製', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify("{message: invalid filterId}"),
                };
            }
        }
        // フィルターの新規作成
        else {
            const {
                projectId,
                filterName,
                filterManageName,
                filterOverview,
                filterQuery,
                memo,
                createdBy,
                updatedBy
            } = JSON.parse(event.body);
            logAccountId = createdBy;
            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = "";
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "フィルター名";
            logData[1].beforeValue = "";
            logData[1].afterValue = filterName;
            logData[2] = {};
            logData[2].fieldName = "フィルター管理名";
            logData[2].beforeValue = "";
            logData[2].afterValue = filterManageName;
            logData[3] = {};
            logData[3].fieldName = "フィルター説明";
            logData[3].beforeValue = "";
            logData[3].afterValue = filterOverview;
            logData[4] = {};
            logData[4].fieldName = "フィルター設定";
            logData[4].beforeValue = "";
            logData[4].afterValue = filterQuery;
            logData[5] = {};
            logData[5].fieldName = "メモ";
            logData[5].beforeValue = "";
            logData[5].afterValue = memo;

            // insert data query
            let sql_data = `INSERT INTO Filter (
                projectId,
                filterName,
                filterManageName,
                filterOverview,
                filterQuery,
                memo,
                createdAt,
                createdBy,
                updatedAt,
                updatedBy
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
            // created date
            const createdAt = Math.floor(new Date().getTime() / 1000);
            let sql_param = [
                projectId,
                filterName,
                filterManageName,
                filterOverview,
                filterQuery,
                memo,
                createdAt,
                createdBy,
                createdAt,
                updatedBy,
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            // filterQueryが空だった場合更新しない 2023/07/06 haga
            if (!filterQuery.length) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'フィルター', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "filterQuery data is empty!",
                        errorCode: 204
                    }),
                };
            }
            const [query_result] = await mysql_con.execute(sql_data, sql_param);
            if (query_result.length === 0) {
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'フィルター', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 404,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "no data"
                    }),
                };
            }
            await mysql_con.commit();

            // construct the response
            let response = {
                records: query_result[0]
            };
            // console.log("response:", response);
            // success log
            await createLog(context, 'フィルター', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(response),
            };
        }
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
        // failure log
        await createLog(context, 'フィルター', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(error),
        };
    } finally {
        if (mysql_con) await mysql_con.close();
    }
};

async function createLog(context, _target, _type, _result, _code, ipAddress, projectId, accountId, logData = null) {
    let params = {
        FunctionName: "createLog-" + process.env.ENV,
        InvocationType: "Event",
        Payload: JSON.stringify({
            logGroupName: context.logGroupName,
            logStreamName: context.logStreamName,
            _target: _target,
            _type: _type,
            _result: _result,
            _code: _code,
            ipAddress: ipAddress,
            projectId: projectId,
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}
