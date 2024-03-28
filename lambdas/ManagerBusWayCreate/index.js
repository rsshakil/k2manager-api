/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBusWayCreate.
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

    // let projectId = 0
    // projectId = event.queryStringParameters?.pid;
    let mysql_con;
    const {
        busRouteId,
        busWayName,
        busWayOverview,
        busWayDescription,
        busWayCapacity,
        memo,
        createdBy,
        updatedBy,
        busTime,
        projectId
    } = JSON.parse(event.body);
    logAccountId = createdBy;

    try {

        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
            // if (!event.queryStringParameters?.pid || validProjectId.indexOf(Number(event.queryStringParameters?.pid)) == -1) {
                // failure log
                await createLog(context, 'バス便', '作成', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

        // insert data query
        let sql_data = `INSERT INTO BusWay (
             busRouteId,
             busWayName,
             busWayOverview,
             busWayDescription,
             busWayCapacity,
             memo,
             createdAt,
             createdBy,
             updatedAt,
             updatedBy
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            busRouteId,
            busWayName,
            busWayOverview,
            busWayDescription,
            busWayCapacity,
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
        await mysql_con.beginTransaction();
        const [query_result] = await mysql_con.execute(sql_data, sql_param);
        if (query_result.length === 0) {
            await mysql_con.rollback();
            console.log("failure insert");
            // failure log
            await createLog(context, 'バス便', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        // console.log("busTime:", busTime);
        // console.log("busWayId:", query_result.insertId);

        let busTimeArray = [];
        // バスタイムテーブルの作成
        let busWayId = query_result.insertId;
        if (busTime) {
            for (let i = 0; i < busTime.length; i++) {
                let row = busTime[i];
                let sql_data2 = 'INSERT INTO BusTimeTable (busWayId, busStopId, busTime) VALUES (?, ?, ?)';
                // console.log("sql_data2", sql_data2);
                // console.log("row[0]", row[0]);
                // console.log("row[1]", row[1]);
                const [query_result2] = await mysql_con.execute(sql_data2, [
                    busWayId,
                    row[0],
                    row[1]
                ]);
                busTimeArray.push(row[1]);
            }
        }

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "バス路線ID";
        logData[0].beforeValue = "";
        logData[0].afterValue = busRouteId;
        logData[1] = {};
        logData[1].fieldName = "バス便名";
        logData[1].beforeValue = "";
        logData[1].afterValue = busWayName;
        logData[2] = {};
        logData[2].fieldName = "バス便説明";
        logData[2].beforeValue = "";
        logData[2].afterValue = busWayOverview;
        logData[3] = {};
        logData[3].fieldName = "バス便説明";
        logData[3].beforeValue = "";
        logData[3].afterValue = busWayDescription;
        logData[4] = {};
        logData[4].fieldName = "バス便定員";
        logData[4].beforeValue = "";
        logData[4].afterValue = busWayCapacity;
        logData[5] = {};
        logData[5].fieldName = "停留所出発時刻";
        logData[5].beforeValue = "";
        logData[5].afterValue = busTimeArray;
        logData[6] = {};
        logData[6].fieldName = "メモ";
        logData[6].beforeValue = "";
        logData[6].afterValue = memo;

        await mysql_con.commit();
        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'バス便', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        await mysql_con.rollback();
        console.log("error:", error);
        // failure log
        await createLog(context, 'バス便', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
