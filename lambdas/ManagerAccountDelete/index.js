
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerAccountDelete.
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

    if (event.pathParameters?.accountId) {
        let accountId = event.pathParameters.accountId;
        console.log("accountId:", accountId);
        logAccountId = JSON.parse(event.body).deletedBy;
        let mysql_con;
        try {
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // 削除データの取得
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Account WHERE accountId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [accountId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'アカウント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[0].fieldName = "アカウントID";
            logData[0].beforeValue = beforeResult[0].accountId;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "アカウント名";
            logData[1].beforeValue = beforeResult[0].fullName;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "ロール";
            logData[2].beforeValue = beforeResult[0].roleId;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "メールアドレス";
            logData[3].beforeValue = beforeResult[0].email;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "ロック状態";
            logData[4].beforeValue = beforeResult[0].isLocked;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "メモ";
            logData[5].beforeValue = beforeResult[0].memo;
            logData[5].afterValue = "";

            let sql_data = `DELETE from Account WHERE accountId = ?`;
            var [query_result] = await mysql_con.query(sql_data, [accountId]);

            await mysql_con.commit();
            // success log
            await createLog(context, 'アカウント', '削除', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'アカウント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'アカウント', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
async function createLog(context, _target, _type, _result, _code, ipAddress, accountId, logData = null) {
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
            accountId: accountId,
            logData: logData
        }),
    };
    await lambda.invoke(params).promise();
}