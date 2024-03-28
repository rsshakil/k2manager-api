/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventSlotTemplateUpdate.
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

    if (event.pathParameters?.eventInstituteId) {
        let eventInstituteId = event.pathParameters.eventInstituteId;
        console.log("eventInstituteId:", eventInstituteId);
        const {
            eventInstituteItemStyle,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = updatedBy;
        const updatedAt = Math.floor(new Date().getTime() / 1000);
        let sql_data = `UPDATE EventInstitute SET 
            eventInstituteItemStyle = ?,
            updatedAt = ?,
            updatedBy = ?
            WHERE eventInstituteId = ?`;

        let sql_param = [
            eventInstituteItemStyle,
            updatedAt,
            updatedBy,
            eventInstituteId
        ];

        console.log("sql_data:", sql_data);
        console.log("sql_param:", sql_param);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(writeDbConfig);
            await mysql_con.beginTransaction();
            // beforeDataの作成
            let beforeSql = `SELECT eventInstituteItemStyle FROM EventInstitute WHERE eventInstituteId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventInstituteId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                // failure log
                await createLog(context, 'イベントスロットテンプレート', '更新', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
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

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベント施設スロットテンプレート";
            logData[0].beforeValue = beforeResult[0].eventInstituteItemStyle;
            logData[0].afterValue = eventInstituteItemStyle;

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            mysql_con.commit();
            // success log
            await createLog(context, 'イベントスロットテンプレート', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify(response),
            };
        } catch (error) {
            mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'イベントスロットテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
    } else {
        // failure log
        await createLog(context, 'イベントスロットテンプレート', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({
                "message": "invalid parameter"
            }),
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