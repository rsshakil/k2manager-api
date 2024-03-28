/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerBusRouteUpdate.
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
        updatedBy,
    } = JSON.parse(event.body);
    logAccountId = updatedBy;
    
    if (event.pathParameters?.busRouteId) {
        let busRouteId = event.pathParameters.busRouteId;
        console.log("busRouteId:", busRouteId);

        if (!projectId) {
            let error = "invalid parameter. Project ID not found.";
            // failure log
            await createLog(context, 'バス路線', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
                await createLog(context, 'バス路線', '更新', '失敗', '403', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            let beforeSql = `SELECT * FROM BusRoute WHERE busRouteId = ? AND projectId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [busRouteId, projectId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                await mysql_con.rollback();
                console.log("Found set already deleted");
                // failure log
                await createLog(context, 'バス路線', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "プロジェクトID";
            logData[0].beforeValue = projectId;
            logData[0].afterValue = projectId;
            logData[1] = {};
            logData[1].fieldName = "バス路線名";
            logData[1].beforeValue = beforeResult[0].busRouteName;
            logData[1].afterValue = busRouteName;
            logData[2] = {};
            logData[2].fieldName = "バス路線管理名";
            logData[2].beforeValue = beforeResult[0].busRouteManageName;
            logData[2].afterValue = busRouteManageName;
            logData[3] = {};
            logData[3].fieldName = "バス路線説明";
            logData[3].beforeValue = beforeResult[0].busRouteOverview;
            logData[3].afterValue = busRouteOverview;
            logData[4] = {};
            logData[4].fieldName = "バス路線説明";
            logData[4].beforeValue = beforeResult[0].busRouteDescription;
            logData[4].afterValue = busRouteDescription;
            logData[5] = {};
            logData[5].fieldName = "バス路線画像1";
            logData[5].beforeValue = beforeResult[0].busRouteImageURL1;
            logData[5].afterValue = busRouteImageURL1;
            logData[6] = {};
            logData[6].fieldName = "バス路線画像2";
            logData[6].beforeValue = beforeResult[0].busRouteImageURL2;
            logData[6].afterValue = busRouteImageURL2;
            logData[7] = {};
            logData[7].fieldName = "バス路線画像3";
            logData[7].beforeValue = beforeResult[0].busRouteImageURL3;
            logData[7].afterValue = busRouteImageURL3;
            logData[8] = {};
            logData[8].fieldName = "バス路線停留所";
            logData[8].beforeValue = beforeResult[0].busRouteStopStyle;
            logData[8].afterValue = busRouteStopStyle;
            logData[9] = {};
            logData[9].fieldName = "メモ";
            logData[9].beforeValue = beforeResult[0].memo;
            logData[9].afterValue = memo;

            const updatedAt = Math.floor(new Date().getTime() / 1000);
            let sql_data = `UPDATE BusRoute SET
                busRouteName = ?,
                busRouteManageName = ?,
                busRouteOverview = ?,
                busRouteDescription = ?,
                busRouteImageURL1 = ?,
                busRouteImageURL2 = ?,
                busRouteImageURL3 = ?,
                busRouteStopStyle = ?,
                memo = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE busRouteId = ? AND projectId = ?`;
            let sql_param = [
                busRouteName,
                busRouteManageName,
                busRouteOverview,
                busRouteDescription,
                busRouteImageURL1,
                busRouteImageURL2,
                busRouteImageURL3,
                busRouteStopStyle,
                memo,
                updatedAt,
                updatedBy,
                busRouteId,
                projectId
            ];
            console.log("sql_data:", sql_data);
            console.log("sql_param:", sql_param);

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // // Found set already deleted
            // if (query_result.affectedRows == 0) {
            //     await mysql_con.rollback();
            //     console.log("Found set already deleted");
            //     // failure log
            //     await createLog(context, 'バス路線', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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

            // 仕様変更
            // 作り直し
            // let delete_sql = 'DELETE FROM BusStop WHERE busRouteId = ?'
            // const [query_result2] = await mysql_con.execute(delete_sql, [busRouteId])
            // if (busRouteStopStyle) {
            //     for (let i = 0; i < busRouteStopStyle.length; i++) {
            //         let row = busRouteStopStyle[i]
            //         let insert_sql = `INSERT INTO BusStop(busRouteId, busStopName, busStopAddress, busStopOrder) VALUES(?, ?, ?, ?)`
            //         const [query_result3] = await mysql_con.execute(insert_sql, [
            //             busRouteId,
            //             row.Task_Subject,
            //             row.info2,
            //             Number(row.currentPos) + 1
            //         ])
            //     }
            // }

            // busRouteStopの取得
            let busroutestop_sql1 = `SELECT * FROM BusRouteStop WHERE busRouteId = ? ORDER BY busRouteStopOrder ASC`;
            let [busroutestop_data1] = await mysql_con.execute(busroutestop_sql1, [busRouteId]);

            // 先がない列だけ取得
            console.log("beforeResult", JSON.stringify(beforeResult));
            console.log("busRouteStopStyle", JSON.stringify(busRouteStopStyle));
            let deleteMapArray = beforeResult[0].busRouteStopStyle.map((row) => {
                let matchFlag = false;
                for (let j = 0; j < busRouteStopStyle.length; j++) {
                    if (row.fTypeId == busRouteStopStyle[j].fTypeId) {
                        matchFlag = true;
                    }
                }
                if (!matchFlag) {
                    return row;
                }
            }).filter(e => typeof e !== 'undefined');
            // マッチした列だけ取得
            let updateMapArray = busRouteStopStyle.map((row) => {
                for (let j = 0; j < busroutestop_data1.length; j++) {
                    if (busroutestop_data1[j].busStopId == row.fTypeId) {
                        return row;
                    }
                }
            }).filter(e => typeof e !== 'undefined');
            // 元がない列だけ取得
            let insertMapArray = busRouteStopStyle.map((row) => {
                let matchFlag = false;
                for (let j = 0; j < busroutestop_data1.length; j++) {
                    if (busroutestop_data1[j].busStopId == row.fTypeId) {
                        matchFlag = true;
                    }
                }
                if (!matchFlag) {
                    return row;
                }
            }).filter(e => typeof e !== 'undefined');

            console.log("insertMapArray", insertMapArray);
            console.log("updateMapArray", updateMapArray);
            console.log("deleteMapArray", deleteMapArray);

            // busRouteStopの更新
            let busroutestop_sql2 = `INSERT INTO BusRouteStop(busRouteId, busStopId, busRouteStopOrder) VALUES(?, ?, ?)`;
            let busroutestop_sql3 = `UPDATE BusRouteStop SET busRouteStopOrder = ? WHERE busRouteId = ? AND busStopId = ?`;
            let busroutestop_sql4 = `DELETE FROM BusRouteStop WHERE busRouteId = ? AND busStopId = ?`;
            // 削除
            for (let i = 0; i < deleteMapArray.length; i++) {
                const busStopId = deleteMapArray[i].fTypeId;
                const currentPos = deleteMapArray[i].currentPos;
                let [busroutestop_data4] = await mysql_con.execute(busroutestop_sql4, [busRouteId, busStopId]);
                // バスタイムテーブルも削除
                let bustimeway_sql1 = `DELETE BUS_TIME FROM BusTimeTable AS BUS_TIME
                INNER JOIN BusWay AS BUS_WAY
                ON BUS_TIME.busWayId = BUS_WAY.busWayId
                WHERE BUS_WAY.busRouteId = ? AND BUS_TIME.busStopId = ?`;
                let [buswaytime_data1] = await mysql_con.execute(bustimeway_sql1, [busRouteId, busStopId]);
            }
            // 追加
            for (let i = 0; i < insertMapArray.length; i++) {
                const busStopId = insertMapArray[i].fTypeId;
                const currentPos = insertMapArray[i].currentPos;
                let [busroutestop_data2] = await mysql_con.execute(busroutestop_sql2, [busRouteId, busStopId, currentPos]);
            }
            // 更新
            for (let i = 0; i < updateMapArray.length; i++) {
                const busStopId = updateMapArray[i].fTypeId;
                const currentPos = updateMapArray[i].currentPos;
                let [busroutestop_data3] = await mysql_con.execute(busroutestop_sql3, [currentPos, busRouteId, busStopId]);
            }

            /*
                        for (let i = 0; i < busRouteStopStyle.length; i++) {
                            let row = busRouteStopStyle[i];
                            // 0 = 新規
                            // 1 = 更新
                            // 2 = 削除
                            let matchFlag = 0; 
                            for (let j = 0; j < busroutestop_data.length; j++) {
                                if (busroutestop_data[j].busStopId == row.fTypeId) {
                                    matchFlag = 1; break;
                                }
                            }
                            // マッチした場合更新
                            let query_result2;
                            if (matchFlag) {
                                [query_result2] = await mysql_con.execute(busroutestop_sql2, [row.currentPos, row.fTypeId]);
                            }
                            // マッチしていない場合作成
                            else {
                                [query_result2] = await mysql_con.execute(busroutestop_sql1, [busRouteId, row.fTypeId, row.currentPos]);
                            }
                            if (query_result2.affectedRows == 0) {
                                await mysql_con.rollback();
                                console.log("Found set already deleted");
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
                        }
            */
            await mysql_con.commit();
            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            // success log
            await createLog(context, 'バス路線', '更新', '成功', '200', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
            await createLog(context, 'バス路線', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
        await createLog(context, 'バス路線', '更新', '失敗', '400', event.requestContext.identity.sourceIp, projectId, logAccountId, logData);
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
