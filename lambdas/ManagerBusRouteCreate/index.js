/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBusRouteCreate.
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
        busRouteName,
        busRouteManageName,
        busRouteOverview,
        busRouteDescription,
        busRouteImageURL1,
        busRouteImageURL2,
        busRouteImageURL3,
        busRouteStopStyle,
        memo,
        createdBy,
        updatedBy
    } = JSON.parse(event.body);
    logAccountId = createdBy;

    let mysql_con;
    try {

        let validProjectId;
        if (event?.requestContext?.authorizer?.pid) {
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid);
            // pidがない場合 もしくは 許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
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

        // ログ書き込み
        logData[0] = {};
        logData[0].fieldName = "プロジェクトID";
        logData[0].beforeValue = "";
        logData[0].afterValue = projectId;
        logData[1] = {};
        logData[1].fieldName = "バス路線名";
        logData[1].beforeValue = "";
        logData[1].afterValue = busRouteName;
        logData[2] = {};
        logData[2].fieldName = "バス路線管理名";
        logData[2].beforeValue = "";
        logData[2].afterValue = busRouteManageName;
        logData[3] = {};
        logData[3].fieldName = "バス路線説明";
        logData[3].beforeValue = "";
        logData[3].afterValue = busRouteOverview;
        logData[4] = {};
        logData[4].fieldName = "バス路線説明";
        logData[4].beforeValue = "";
        logData[4].afterValue = busRouteDescription;
        logData[5] = {};
        logData[5].fieldName = "バス路線画像1";
        logData[5].beforeValue = "";
        logData[5].afterValue = busRouteImageURL1;
        logData[6] = {};
        logData[6].fieldName = "バス路線画像2";
        logData[6].beforeValue = "";
        logData[6].afterValue = busRouteImageURL2;
        logData[7] = {};
        logData[7].fieldName = "バス路線画像3";
        logData[7].beforeValue = "";
        logData[7].afterValue = busRouteImageURL3;
        logData[8] = {};
        logData[8].fieldName = "バス路線停留所";
        logData[8].beforeValue = "";
        logData[8].afterValue = busRouteStopStyle;
        logData[9] = {};
        logData[9].fieldName = "メモ";
        logData[9].beforeValue = "";
        logData[9].afterValue = memo;

        // regist view code
        // let params = {
        //     FunctionName: "getviewcode-" + process.env.ENV,
        //     InvocationType: "RequestResponse"
        // };
        // let codeData = await lambda.invoke(params).promise();
        // // console.log("codeData", codeData);
        // let busRouteCode = JSON.parse(codeData.Payload);

        // insert data query
        let sql_data = `INSERT INTO BusRoute (
            projectId,
            busRouteName,
            busRouteManageName,
            busRouteOverview,
            busRouteDescription,
            busRouteImageURL1,
            busRouteImageURL2,
            busRouteImageURL3,
            busRouteStopStyle,
            memo,
            createdAt,
            createdBy,
            updatedAt,
            updatedBy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;
        // created date
        const createdAt = Math.floor(new Date().getTime() / 1000);
        let sql_param = [
            projectId,
            busRouteName,
            busRouteManageName,
            busRouteOverview,
            busRouteDescription,
            busRouteImageURL1,
            busRouteImageURL2,
            busRouteImageURL3,
            busRouteStopStyle,
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
            await createLog(context, 'バス路線', '作成', '失敗', '404', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        // 仕様変更
        // 作り直し
        /*
                // バス停留所の作成（）
                let delete_sql = 'DELETE FROM BusStop WHERE busRouteId = ?'
                const [query_result2] = await mysql_con.execute(delete_sql, [busRouteId])
                if (busRouteStopStyle) {
                    for (let i = 0; i < busRouteStopStyle.length; i++) {
                        let row = busRouteStopStyle[i]
                        let insert_sql = `INSERT INTO BusStop(busRouteId, busStopName, busStopAddress, busStopOrder) VALUES(?, ?, ?, ?)`
                        const [query_result3] = await mysql_con.execute(insert_sql, [
                            busRouteId,
                            row.Task_Subject,
                            row.info2,
                            Number(row.currentPos) + 1
                        ])
                    }
                }
        */
        // busRouteStopの作成
        let busRouteId = query_result.insertId;
        let busroutestop_sql = `INSERT INTO BusRouteStop(busRouteId, busStopId, busRouteStopOrder) VALUES(?, ?, ?)`;
        for (let i = 0; i < busRouteStopStyle.length; i++) {
            let row = busRouteStopStyle[i];
            const [query_result2] = await mysql_con.execute(busroutestop_sql, [busRouteId, row.fTypeId, row.currentPos]);
        }

        await mysql_con.commit();
        // construct the response
        let response = {
            records: query_result[0]
        };
        // console.log("response:", response);
        // success log
        await createLog(context, 'バス路線', '作成', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'バス路線', '作成', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
