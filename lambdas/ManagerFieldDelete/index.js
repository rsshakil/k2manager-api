
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerFieldDelete.
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
    const writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    let jsonBody = event.queryStringParameters;
    console.log("event.queryStringParameters:", jsonBody);
    let projectId = jsonBody?.pid;

    if (event.pathParameters?.fieldId) {
        let fieldId = event.pathParameters.fieldId;
        console.log("fieldId: ", fieldId);
        logAccountId = JSON.parse(event.body).deletedBy;
        // Expand GET parameters

        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'フィールド', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                // failure log
                await createLog(context, 'フィールド', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        let mysql_con;
        try {
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Field WHERE fieldId = ? AND projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [fieldId, projectId]);
            // Found set already deleted
            if (beforeResult.length == 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'フィールド', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already deleted",
                        errorCode: 101
                    }),
                };
            }

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "フィールド名";
            logData[1].beforeValue = beforeResult[0].fieldName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "フィールド説明";
            logData[2].beforeValue = beforeResult[0].fieldOverview;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "フィールド説明";
            logData[3].beforeValue = beforeResult[0].fieldDescription;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "フィールドタイプ";
            logData[4].beforeValue = beforeResult[0].fieldType;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "フィールドスタイルJSON";
            logData[5].beforeValue = beforeResult[0].fieldStyle;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "このフィールドを表示する条件";
            logData[6].beforeValue = beforeResult[0].filterId;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = beforeResult[0].memo;
            logData[7].afterValue = "";

            /*
                        let countFlag = false;
                        // 利用している場合削除できない
                        // TODO
                        // 利用しているApp周りのテーブルから検索する
                        // EventCategory
                        if (!countFlag) {
                            let sql_data = `SELECT COUNT(eventCategoryId) AS count FROM EventCategory WHERE filterId = ?`;
                            var [query_result, query_fields] = await mysql_con.query(sql_data, [fieldId]);
                            if (query_result[0].count >= 1) {
                                countFlag = true
                            }
                        }
                        // EventInstitute
                        if (!countFlag) {
                            let sql_data = `SELECT COUNT(eventInstituteId) AS count FROM EventInstitute WHERE filterId = ?`;
                            var [query_result, query_fields] = await mysql_con.query(sql_data, [filterId]);
                            if (query_result[0].count >= 1) {
                                countFlag = true
                            }
                        }
                        // SubItem
                        if (!countFlag) {
                            let sql_data = `SELECT COUNT(subItemId) AS count FROM SubItem WHERE filterId = ?`;
                            var [query_result, query_fields] = await mysql_con.query(sql_data, [filterId]);
                            if (query_result[0].count >= 1) {
                                countFlag = true
                            }
                        }
                        // SubCounselor
                        if (!countFlag) {
                            let sql_data = `SELECT COUNT(subCounselorId) AS count FROM SubCounselor WHERE filterId = ?`;
                            var [query_result, query_fields] = await mysql_con.query(sql_data, [filterId]);
                            if (query_result[0].count >= 1) {
                                countFlag = true
                            }
                        }
                        if (countFlag) {
                            console.log("invalid parameter");
                            return {
                                statusCode: 400,
                                headers: {
                                    "Access-Control-Allow-Origin": "*",
                                    "Access-Control-Allow-Headers": "*",
                                },
                                body: JSON.stringify({"message": "categories are used in events."}),
                            };
                        }
            */
            // else {

            // フィールド削除
            let sql_data2 = `DELETE from Field WHERE fieldId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [fieldId]);

            await mysql_con.commit();
            // success log
            await createLog(context, 'フィールド', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
            };
        } catch (error) {
            await mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'フィールド', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
        finally {
            if (mysql_con) await mysql_con.close();
        }
    }
    else {
        console.log("invalid parameter");
        // failure log
        await createLog(context, 'フィールド', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({ "message": "invalid parameter" }),
        };
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

