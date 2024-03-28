/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk');
const mysql = require('mysql2/promise');
const bcrypt = require("bcryptjs");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

// initial state code
const INITIAL_STATUS = 1;

/**
 * ManagerAccountCreate.
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

    let mysql_con;
    try {
        const {
            accountId,
            fullName,
            roleId,
            email,
            initialPassword,
            isLocked,
            memo,
            createdBy,
            updatedBy,
        } = JSON.parse(event.body);
        logAccountId = createdBy;
        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "アカウントID";
        logData[0].beforeValue = "";
        logData[0].afterValue = accountId;
        logData[1] = {};
        logData[1].fieldName = "アカウント名";
        logData[1].beforeValue = "";
        logData[1].afterValue = fullName;
        logData[2] = {};
        logData[2].fieldName = "ロール";
        logData[2].beforeValue = "";
        logData[2].afterValue = roleId;
        logData[3] = {};
        logData[3].fieldName = "メールアドレス";
        logData[3].beforeValue = "";
        logData[3].afterValue = email;
        logData[4] = {};
        logData[4].fieldName = "ロック状態";
        logData[4].beforeValue = "";
        logData[4].afterValue = isLocked;
        logData[5] = {};
        logData[5].fieldName = "メモ";
        logData[5].beforeValue = "";
        logData[5].afterValue = memo;

        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        // account id uniqueness check
        // get count query
        let count_sql = `SELECT COUNT(accountId) FROM Account WHERE accountId = ?;`;
        // get count
        let [query_count_result] = await mysql_con.execute(count_sql, [accountId]);
        let data_count = Object.values(query_count_result[0]);
        console.log("same accountId records count", data_count);
        // Check if the data already exists
        if (data_count > 0) {
            // Already exists, send error response
            console.log("Already exists accountId");
            // failure log
            await createLog(context, 'アカウント', '作成', '失敗', '409', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 409,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "Duplicate entry"
                }),
            };
        }

        // insert data query
        let sql_data = `INSERT INTO Account (
            accountId,
            accountUUID,
            fullName,
            roleId,
            email,
            passwordHistory,
            initialPassword,
            isLocked,
            initialState,
            passwordExpirationDate,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES(?, uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

        // create hashed password with bcrypt
        const hashedPassword = await bcrypt.hashSync(initialPassword, 10);
        let passJsonData = [hashedPassword];

        // create expire date
        let expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30);
        expirationDate = Math.floor(expirationDate.getTime() / 1000);
        // created data
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            accountId,
            fullName,
            roleId,
            email,
            passJsonData,
            passJsonData,
            isLocked,
            INITIAL_STATUS,
            expirationDate,
            memo,
            createdAt,
            createdBy,
            createdAt,
            updatedBy,
        ];
        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);
        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        if (query_result.length === 0) {
            // failure log
            await createLog(context, 'アカウント', '作成', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
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

        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'アカウント', '作成', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        console.log("error:", error);
        // failure log
        await createLog(context, 'アカウント', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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