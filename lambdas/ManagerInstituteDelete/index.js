
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerInstituteDelete.
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

    if (event.pathParameters?.instituteId) {
        let instituteId = event.pathParameters.instituteId;
        console.log("instituteId:", instituteId);
        logAccountId = JSON.parse(event.body).deletedBy;
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);
        let projectId = 0;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, '施設', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, '施設', '削除', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        // mysql connect
        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Institute WHERE instituteId = ? AND projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [instituteId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, '施設', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            logData[1].fieldName = "施設名";
            logData[1].beforeValue = beforeResult[0].instituteName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "施設説明";
            logData[2].beforeValue = beforeResult[0].instituteOverview;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "施設説明";
            logData[3].beforeValue = beforeResult[0].instituteDescription;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "施設郵便番号";
            logData[4].beforeValue = beforeResult[0].instituteZipCode;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "施設都道府県";
            logData[5].beforeValue = beforeResult[0].institutePrefecture;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "施設市区町村";
            logData[6].beforeValue = beforeResult[0].instituteCityName;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "施設住所1";
            logData[7].beforeValue = beforeResult[0].instituteTownName;
            logData[7].afterValue = "";
            logData[8] = {};
            logData[8].fieldName = "施設住所2";
            logData[8].beforeValue = beforeResult[0].instituteAddressName;
            logData[8].afterValue = "";
            logData[9] = {};
            logData[9].fieldName = "施設住所3";
            logData[9].beforeValue = beforeResult[0].instituteBuilding;
            logData[9].afterValue = "";
            logData[10] = {};
            logData[10].fieldName = "施設電話番号";
            logData[10].beforeValue = beforeResult[0].instituteTelNo;
            logData[10].afterValue = "";
            logData[11] = {};
            logData[11].fieldName = "施設緯度経度";
            logData[11].beforeValue = beforeResult[0].instituteLatlong;
            logData[11].afterValue = "";
            logData[12] = {};
            logData[12].fieldName = "施設画像1";
            logData[12].beforeValue = beforeResult[0].instituteImageURL1;
            logData[12].afterValue = "";
            logData[13] = {};
            logData[13].fieldName = "施設画像2";
            logData[13].beforeValue = beforeResult[0].instituteImageURL2;
            logData[13].afterValue = "";
            logData[14] = {};
            logData[14].fieldName = "施設画像3";
            logData[14].beforeValue = beforeResult[0].instituteImageURL3;
            logData[14].afterValue = "";
            logData[15] = {};
            logData[15].fieldName = "メモ";
            logData[15].beforeValue = beforeResult[0].memo;
            logData[15].afterValue = "";

            // 利用している場合削除できない
            let sql_data = `SELECT COUNT(eventInstituteId) AS count FROM EventInstitute WHERE instituteId = ?`;
            var [query_result] = await mysql_con.query(sql_data, [instituteId]);
            if (query_result[0].count >= 1) {
                console.log("counselors are used.");
                // failure log
                await createLog(context, '施設', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "counselors are used.",
                        errorCode: 107
                    }),
                };
            }

            // 削除
            let sql_data2 = `DELETE from Institute WHERE instituteId = ?`;
            var [query_result2] = await mysql_con.query(sql_data2, [instituteId]);
            // 関連フィールドも削除する
            let sql_data3 = `DELETE FROM Field WHERE projectId = ? AND fieldColumnName = ? AND fieldColumnSubId = ?`;
            var [query_result3] = await mysql_con.query(sql_data3, [projectId, 'Institute.instituteId', instituteId]);

            await mysql_con.commit();
            // success log
            await createLog(context, '施設', '削除', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            await createLog(context, '施設', '削除', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, '施設', '削除', '失敗', '400', event.requestContext.identity.sourceIp, null, logAccountId, logData);
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
