/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerCustomerEditTemplateDelete.
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

    // Expand GET parameters
    let projectId = 0;
    let jsonBody = event.queryStringParameters;
    console.log("event.queryStringParameters:", jsonBody);
    projectId = jsonBody?.pid;

    if (event.pathParameters?.customerEditTemplateId) {
        let customerEditTemplateId = event.pathParameters?.customerEditTemplateId;
        console.log("customerEditTemplateId:", customerEditTemplateId);
        logAccountId = JSON.parse(event.body).deletedBy;
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, '顧客編集テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, '顧客編集テンプレート', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM CustomerEditTemplate WHERE customerEditTemplateId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [customerEditTemplateId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("invalid parameter");
                // failure log
                await createLog(context,'顧客編集テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[1].fieldName = "顧客編集テンプレート名";
            logData[1].beforeValue = beforeResult[0].customerEditTemplateName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "顧客編集テンプレート検索フィルター";
            logData[2].beforeValue = beforeResult[0].customerEditTemplateSearch;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "顧客編集テンプレート表示フィールド";
            logData[3].beforeValue = beforeResult[0].customerEditTemplateColumn;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "予約APPID";
            logData[4].beforeValue = beforeResult[0].appId;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "表示情報フィルター";
            logData[5].beforeValue = beforeResult[0].filterId;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "このテンプレートを利用可能なロール";
            logData[6].beforeValue = beforeResult[0].customerEditTemplateAuthRole;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "メモ";
            logData[7].beforeValue = beforeResult[0].memo;
            logData[7].afterValue = "";
            
            // 顧客一覧テンプレートで利用していた場合、そこの値をnullにする
            let sql_data3 = `UPDATE CustomerViewTemplate SET customerViewTemplateCreateTemplateId = NULL WHERE customerViewTemplateCreateTemplateId = ?`;
            var [query_result3] = await mysql_con.query(sql_data3, [customerEditTemplateId]);
            let sql_data4 = `UPDATE CustomerViewTemplate SET customerViewTemplateEditTemplateId = NULL WHERE customerViewTemplateEditTemplateId = ?`;
            var [query_result4] = await mysql_con.query(sql_data4, [customerEditTemplateId]);
            
            //　顧客編集テンプレートの削除
            let sql_data2 = `DELETE from CustomerEditTemplate WHERE customerEditTemplateId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [customerEditTemplateId]);

            await mysql_con.commit();
            // successLog
            await createLog(context, '顧客編集テンプレート', '削除', '成功', '200', event.requestContext.identity.sourceIp, null, logAccountId, logData);
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
            await createLog(context, '顧客編集テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            };
        }
    }
    else {
        console.log("invalid parameter");
        // failure log
        await createLog(context, '顧客編集テンプレート', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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