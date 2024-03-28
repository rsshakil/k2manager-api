/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBusWayUpdate.
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

    const {
        projectId,
        busWayId,
        busWayName,
        busWayOverview,
        busWayDescription,
        busWayCapacity,
        memo,
        updatedBy,
        busTime
    } = JSON.parse(event.body);
    logAccountId = updatedBy;

    if (event.pathParameters?.busRouteId) {
        let busRouteId = event.pathParameters.busRouteId;
        console.log("busRouteId:", busRouteId);

        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'バス便', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'バス便', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let beforeSql = `SELECT * FROM BusWay WHERE busRouteId = ? AND busWayId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [busRouteId, busWayId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'バス便', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers": "*",
                    },
                    body: JSON.stringify({
                        message: "Found set already deleted",
                        errorCode: 201
                    }),
                };
            }
            let beforeSql2 = 'SELECT busTime FROM BusTimeTable WHERE busWayId = ?';
            let [beforeResult2] = await mysql_con.execute(beforeSql2, [busWayId]);
            const beforeBusTimeArray = beforeResult2.filter(e => e.busTime);

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE BusWay SET
                busWayName = ?,
                busWayOverview = ?,
                busWayDescription = ?,
                busWayCapacity = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE
                busRouteId = ?
                AND busWayId = ?`;
            let sql_param = [
                busWayName,
                busWayOverview,
                busWayDescription,
                busWayCapacity,
                memo,
                updatedAt,
                updatedBy,
                busRouteId,
                busWayId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     await mysql_con.rollback();
            //     console.log("Found set already deleted");
            //     // failure log
            //     await createLog(context, 'バス便', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
            //     return {
            //         statusCode: 400,
            //         headers: {
            //             "Access-Control-Allow-Origin": "*",
            //             "Access-Control-Allow-Headers": "*",
            //         },
            //         body: JSON.stringify({
            //             message: "Found set already deleted",
            //             errorCode: 201
            //         }),
            //     };
            // }

            let busTimeArray = [];
            // バスタイムテーブルの作成
            if (busTime) {
                // console.log("xxxx----2");
                for (let i = 0; i < busTime.length; i++) {
                    let row = busTime[i];
                    // console.log("xxxx----3", row);
                    row[1] = (row[1]) ? row[1] : "0000";
                    let sql_data2 = `INSERT INTO BusTimeTable (busWayId, busStopId, busTime) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE busTime = VALUES(busTime)`;
                    const [query_result2] = await mysql_con.execute(sql_data2, [
                        Number.parseInt(busWayId, 10),
                        Number.parseInt(row[0], 10),
                        row[1]
                    ]);
                    // console.log("sql", sql_data2);
                    // console.log("data1", row[1]);
                    // console.log("data2", row[0]);
                    // console.log("data3", busWayId);
                    busTimeArray.push(row[1]);
                }
            }
            // console.log("xxxx----4");

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "バス路線ID";
            logData[0].beforeValue = busRouteId;
            logData[0].afterValue = busRouteId;
            logData[1] = {};
            logData[1].fieldName = "バス便名";
            logData[1].beforeValue = beforeResult[0].busWayName;
            logData[1].afterValue = busWayName;
            logData[2] = {};
            logData[2].fieldName = "バス便説明";
            logData[2].beforeValue = beforeResult[0].busWayOverview;
            logData[2].afterValue = busWayOverview;
            logData[3] = {};
            logData[3].fieldName = "バス便説明";
            logData[3].beforeValue = beforeResult[0].busWayDescription;
            logData[3].afterValue = busWayDescription;
            logData[4] = {};
            logData[4].fieldName = "バス便定員";
            logData[4].beforeValue = beforeResult[0].busWayCapacity;
            logData[4].afterValue = busWayCapacity;
            logData[5] = {};
            logData[5].fieldName = "停留所出発時刻";
            logData[5].beforeValue = beforeBusTimeArray;
            logData[5].afterValue = busTimeArray;
            logData[6] = {};
            logData[6].fieldName = "メモ";
            logData[6].beforeValue = beforeResult[0].memo;
            logData[6].afterValue = memo;

            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await  createLog(context, 'バス便', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            console.log(error);
            // failure log
            await createLog(context, 'バス便', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'バス便', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
