/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerRoleDelete.
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

    if (event.pathParameters?.roleId) {
        let roleId = event.pathParameters.roleId;
        console.log("roleId:", roleId);
        logAccountId = JSON.parse(event.body).deletedBy;
        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // 削除データの取得
            // beforeDataの作成
            let beforeSql = `SELECT * FROM Role WHERE roleId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [roleId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'ロール', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[0].fieldName = "ロール名";
            logData[0].beforeValue = beforeResult[0].roleName;
            logData[0].afterValue = "";
            logData[1] = {};
            logData[1].fieldName = "二段階認証";
            logData[1].beforeValue = beforeResult[0].isMFAEnabled;
            logData[1].afterValue = "";
            logData[2] = {};
            logData[2].fieldName = "システム管理権限";
            logData[2].beforeValue = beforeResult[0].r1;
            logData[2].afterValue = "";
            logData[3] = {};
            logData[3].fieldName = "システム監視権限";
            logData[3].beforeValue = beforeResult[0].r2;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "APP管理権限";
            logData[4].beforeValue = beforeResult[0].r3;
            logData[4].afterValue = "";
            logData[5] = {};
            logData[5].fieldName = "イベント一覧権限";
            logData[5].beforeValue = beforeResult[0].r4;
            logData[5].afterValue = "";
            logData[6] = {};
            logData[6].fieldName = "イベントスケジューラー権限";
            logData[6].beforeValue = beforeResult[0].r5;
            logData[6].afterValue = "";
            logData[7] = {};
            logData[7].fieldName = "スロット権限";
            logData[7].beforeValue = beforeResult[0].r6;
            logData[7].afterValue = "";
            logData[8] = {};
            logData[8].fieldName = "データ管理権限";
            logData[8].beforeValue = beforeResult[0].r7;
            logData[8].afterValue = "";
            logData[9] = {};
            logData[9].fieldName = "顧客情報閲覧権限";
            logData[9].beforeValue = beforeResult[0].r8;
            logData[9].afterValue = "";
            logData[10] = {};
            logData[10].fieldName = "顧客情報管理権限";
            logData[10].beforeValue = beforeResult[0].r9;
            logData[10].afterValue = "";
            logData[11] = {};
            logData[11].fieldName = "CSV作成権限";
            logData[11].beforeValue = beforeResult[0].r10;
            logData[11].afterValue = "";
            logData[12] = {};
            logData[12].fieldName = "CSV閲覧権限";
            logData[12].beforeValue = beforeResult[0].r10;
            logData[12].afterValue = "";
            logData[13] = {};
            logData[13].fieldName = "ログインプロジェクト";
            logData[13].beforeValue = beforeResult[0].loginProjectId;
            logData[13].afterValue = "";
            logData[14] = {};
            logData[14].fieldName = "ロールリレーションJSON";
            logData[14].beforeValue = beforeResult[0].roleRelationStyle;
            logData[14].afterValue = "";
            logData[15] = {};
            logData[15].fieldName = "リレーションプロジェクトID";
            logData[15].beforeValue = beforeResult[0].relationProjectId;
            logData[15].afterValue = "";
            logData[16] = {};
            logData[16].fieldName = "リレーションイベントID";
            logData[16].beforeValue = beforeResult[0].relationEventId;
            logData[16].afterValue = "";
            logData[17] = {};
            logData[17].fieldName = "リレーション施設ID";
            logData[17].beforeValue = beforeResult[0].relationInstituteId;
            logData[17].afterValue = "";
            logData[18] = {};
            logData[18].fieldName = "メモ";
            logData[18].beforeValue = beforeResult[0].memo;
            logData[18].afterValue = "";

            // Can't delete because it's being used by an account
            let sql_account = `SELECT COUNT(Id) AS count FROM Account WHERE roleId = ?`;
            var [query_result_account] = await mysql_con.query(sql_account, [roleId]);
            if (query_result_account[0].count >= 1) {
                // failure log
                await createLog(context, 'ロール', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "role are used in account.",
                        errorCode: 110
                    }),
                };
            }

            let sql_data = `DELETE from Role WHERE roleId = ?`;
            await mysql_con.query(sql_data, [roleId]);

            await mysql_con.commit();
            // success log
            await createLog(context, 'ロール', '削除', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'ロール', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'ロール', '削除', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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