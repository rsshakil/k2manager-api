/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerDomainCreate.
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
        // mysql connect
        mysql_con = await mysql.createConnection(writeDbConfig);
        await mysql_con.beginTransaction();

        const {
            domainName,
            domainURL,
            memo,
            createdBy,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = createdBy;
        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "ドメイン名";
        logData[0].beforeValue = "";
        logData[0].afterValue = domainName;
        logData[1] = {};
        logData[1].fieldName = "ドメインURL";
        logData[1].beforeValue = "";
        logData[1].afterValue = domainURL.toLowerCase();
        logData[2] = {};
        logData[2].fieldName = "メモ";
        logData[2].beforeValue = "";
        logData[2].afterValue = memo;

        // domain url uniqueness check
        // get count query
        let count_sql = `SELECT COUNT(domainURL) FROM Domain WHERE domainURL = ?;`;
        // get count
        let [query_count_result] = await mysql_con.execute(count_sql, [domainURL.toLowerCase()]);
        let data_count = Object.values(query_count_result[0]);
        console.log("same domainURL records count", data_count);
        // Check if the data already exists
        if (data_count > 0) {
            // Already exists, send error response
            console.log("Already exists domainURL");
            await mysql_con.rollback();
            // failure log
            await createLog(context, 'ドメイン', '作成', '失敗', '409', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        let sql_data = `INSERT INTO Domain (domainName, domainURL, memo, createdAt, createdBy, updatedAt, updatedBy) VALUES (?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            domainName,
            domainURL.toLowerCase(),
            memo,
            createdAt,
            createdBy,
            createdAt,
            updatedBy
        ];
        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);

        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        if (query_result.length === 0) {
            await mysql_con.rollback();
            // failure log
            await createLog(context, 'ドメイン', '作成', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
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

        // ドメインのリソースを作成する
        await setupDomain(domainURL.toLowerCase());
        let authDomainURL = domainURL.toLowerCase().replace(/\./, "-auth.");
        await setupDomain(authDomainURL);

        await mysql_con.commit();

        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'ドメイン', '作成', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await mysql_con.rollback();
        // failure log
        await createLog(context, 'ドメイン', '作成', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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

/**
 * ドメインのリソースを作成する
 */
async function setupDomain(domainURL) {
    let payload = {
        "action": "CREATE",
        "customDomain": domainURL
    };

    let params = {
        Payload: JSON.stringify(payload),
        FunctionName: "DomainSetup-" + process.env.ENV,
        InvocationType: "RequestResponse"
    };
    console.log("params: ", params);

    let res = await lambda.invoke(params).promise();
    console.log("res: ", res);

    const {
        statusCode,
        body
    } = JSON.parse(res.Payload);

    if (statusCode != 200) {
        throw (body);
    }
}
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