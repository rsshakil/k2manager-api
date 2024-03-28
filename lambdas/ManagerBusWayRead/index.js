/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

/**
 * ManagerBusWayRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
exports.handler = async (event) => {
    console.log("Event data:", event);
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
    const readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    // Get one record by primary key
    if (event.pathParameters && event.pathParameters?.busRouteId) {
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);
        let projectId = 0;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
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
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        let busRouteId = event.pathParameters.busRouteId;
        let busWayId = jsonBody?.busWayId;
        // Get busWay record if busWayId is set.
        if (busWayId) {
            let parameter = [];
            let mysql_con;
            try {
                mysql_con = await mysql.createConnection(readDbConfig);
                parameter.push(Number(projectId));
                parameter.push(Number(busRouteId));
                parameter.push(Number(busWayId));
                const sql_data = `SELECT
                         BusWay.busWayId,
                         BusWay.busWayName,
                         BusWay.busWayOverview,
                         BusWay.busWayDescription,
                         BusWay.busWayCapacity,
                         BusWay.memo,
                         BusRoute.busRouteId,
                         BusStop.busStopId,
                         BusStop.busStopName,
                         BusTimeTable.busTime,
                         BusRouteStop.busRouteStopOrder
                     FROM
                         BusWay
                         LEFT OUTER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
                         LEFT OUTER JOIN BusRouteStop ON BusRoute.busRouteId = BusRouteStop.busRouteId
                         LEFT OUTER JOIN BusStop ON BusRouteStop.busStopId = BusStop.busStopId
                         LEFT OUTER JOIN BusTimeTable ON BusWay.busWayId = BusTimeTable.busWayId AND BusStop.busStopId = BusTimeTable.busStopId
                     WHERE
                         BusRoute.projectId = ?
                         AND BusRoute.busRouteId = ?
                         AND BusWay.busWayId = ?
                     ORDER BY
                         BusWay.busWayId,
                         BusRouteStop.busRouteStopOrder`;
                let [result_data] = await mysql_con.query(sql_data, parameter);
                let response;
                console.log("result_data", result_data);
                if (result_data.length !== 0) {
                    // get response
                    let busStops = new Array(result_data.length);
                    for (let index = 0; index < result_data.length; index++) {
                        busStops[index] = new Object();
                        busStops[index].busStopId = result_data[index].busStopId;
                        busStops[index].busStopName = result_data[index].busStopName;
                        busStops[index].busTime = result_data[index].busTime;
                        busStops[index].busRouteStopOrder = result_data[index].busRouteStopOrder;
                    }
                    response = {
                        busRouteId: result_data[0].busRouteId,
                        busWayId: result_data[0].busWayId,
                        busWayName: result_data[0].busWayName,
                        busWayOverview: result_data[0].busWayOverview,
                        busWayDescription: result_data[0].busWayDescription,
                        busWayCapacity: result_data[0].busWayCapacity,
                        memo: result_data[0].memo,
                        busStops: busStops
                    }
                }
                else {
                    response = {
                        message: "no data"
                    }
                }

                console.log("query response:", response);
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(response),
                }
            } catch (error) {
                console.log("error:", error)
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify(error),
                }
            } finally {
                if (mysql_con) await mysql_con.close();
            }
        }

        let parameter = [];
        let mysql_con;
        try {
            mysql_con = await mysql.createConnection(readDbConfig);
            parameter.push(Number(busRouteId));
            // get one record sql
            const sql_stop = `SELECT DISTINCT BusStop.busStopId, BusStop.busStopName FROM BusStop
                 LEFT OUTER JOIN BusTimeTable ON BusStop.busStopId = BusTimeTable.busStopId
                 LEFT OUTER JOIN BusRouteStop ON BusStop.busStopId = BusRouteStop.busStopId
                 WHERE BusRouteStop.busRouteId = ? ORDER BY busRouteStopOrder ASC`;
            let [result_stop] = await mysql_con.query(sql_stop, parameter);
            const sql_way = `SELECT busWayId, busWayName FROM BusWay
                 LEFT OUTER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
                 WHERE BusRoute.busRouteId = ?`;
            let [result_way] = await mysql_con.query(sql_way, parameter);
            const sql_data = `SELECT 
                 BusWay.busWayId, BusStop.busStopId, BusTimeTable.busTime
                 FROM BusWay
                 LEFT OUTER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
                 LEFT OUTER JOIN BusRouteStop ON BusRoute.busRouteId = BusRouteStop.busRouteId
                 LEFT OUTER JOIN BusStop ON BusRouteStop.busStopId = BusStop.busStopId
                 LEFT OUTER JOIN BusTimeTable ON BusWay.busWayId = BusTimeTable.busWayId AND BusStop.busStopId = BusTimeTable.busStopId
                 WHERE BusRoute.busRouteId = ? ORDER BY BusWay.busWayId, busRouteStopOrder`;
            let [result_data] = await mysql_con.query(sql_data, parameter);
console.log("===============result_stop", result_stop);
console.log("===============result_way", result_way);
console.log("===============result_data", result_data);

            let columnNumber = result_way.length + 1;
            let rowNumber = result_stop.length + 1;
            let busWay = new Array(rowNumber);
            for (let i = 0; i < rowNumber; i++) {
                // console.log("xxx--- 1");
                busWay[i] = new Array(columnNumber);
            }
// console.log("columnNumber", columnNumber);
// console.log("rowNumber", rowNumber);
// console.log("first busWay", JSON.stringify(busWay));

            busWay[0][0] = new Object();
            busWay[0][0].busWayName = "停留所";
            for (let i = 0; i < columnNumber; i++) {
                if (result_way[i]?.busWayId) {
                    busWay[0][(i + 1)] = new Object();
                    busWay[0][(i + 1)].busWayId = result_way[i]?.busWayId
                    busWay[0][(i + 1)].busWayName = result_way[i]?.busWayName
                }
            }
            console.log("busWay1", busWay);

            for (let i = 0; i < rowNumber; i++) {
// console.log("xxx ----- 1");
                if (result_stop[i]?.busStopId) {
// console.log("xxx ----- 2");
                    // busWay[(i+1)] = new Array(columnNumber);
                    busWay[(i + 1)][0] = new Object();
                    busWay[(i + 1)][0].busStopId = result_stop[i]?.busStopId
                    busWay[(i + 1)][0].busStopName = result_stop[i]?.busStopName
                    for (let j = 0; j < columnNumber; j++) {
// console.log("xxx ----- 3");
                        if (result_way[j]?.busWayId) {
// console.log("xxx ----- 4 busWay1 ", busWay);
// console.log("xxx ----- 4 j = " + j);
// console.log("xxx ----- 4 i = " + i);
// console.log("xxx ----- 4 wayId = " + result_way[j]?.busWayId);
// console.log("xxx ----- 4 stopId = " + result_stop[i]?.busStopId);
                            busWay[(i + 1)][(j + 1)] = new Object();
                            busWay[(i + 1)][(j + 1)].busWayId = result_way[j]?.busWayId;
                            busWay[(i + 1)][(j + 1)].busStopId = result_stop[i]?.busStopId;
                            busWay[(i + 1)][(j + 1)].busTime = 0;
// console.log("xxx ----- 4 busWay2 ", busWay);
                            // if (result_way[i]?.busWayId) {
                        }
                    }
                }
            }
            console.log("busWay2", busWay);
            for (let i = 0; i < result_data.length; i++) {
                let row = result_data[i];
                for (let j = 0; j < rowNumber; j++) {
                    for (let k = 0; k < columnNumber; k++) {
                        if (busWay[j][k]?.busTime == 0) {
                            if (busWay[j][k].busWayId == row.busWayId && busWay[j][k].busStopId == row.busStopId) {
                                busWay[j][k].busTime = row.busTime
                            }
                        }
                    }
                }
            }
            console.log("busWay3", busWay);
            // get response
            let response = {
                records: busWay
            }
            console.log("query response:", response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log("error:", error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    }
    // Get record list
    else if (event.queryStringParameters != null) {
        // Expand GET parameters
        let jsonBody = event.queryStringParameters;
        console.log("event.queryStringParameters:", jsonBody);
        let projectId = 0;
        if (jsonBody?.pid) {
            projectId = jsonBody.pid;
        } else {
            let error = "invalid parameter. Project ID not found.";
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
            validProjectId = JSON.parse(event?.requestContext?.authorizer?.pid)
            // pidがない場合　もしくは　許可プロジェクトIDに含まれていない場合
            if (!projectId || validProjectId.indexOf(Number(projectId)) == -1) {
                return {
                    statusCode: 403,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                    },
                    body: JSON.stringify("Unauthorized"),
                }
            }
        }

        let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 300;
        let parameter = [];
        let whereQuery = "";
        parameter.push(Number(projectId));

        // Other search query
        // busRouteName
        // if (jsonBody.busRouteName) {
        //     let busRouteName = jsonBody.busRouteName;
        //     if (busRouteName.slice(0, 1) != '*' && busRouteName.slice(-1) != '*') {
        //         whereQuery += ` AND BusRoute.busRouteName = ?`;
        //         parameter.push(busRouteName);
        //     } else {
        //         whereQuery += ` AND BusRoute.busRouteName like ?`;
        //         parameter.push(busRouteName.replace(/(^\*)|(\*$)/g, '%'));
        //     }
        // }

        // limit
        // parameter.push(Number(pagesVisited));
        // parameter.push(Number(itemsPerPage));

        // total count sql
        // const sql_count = `SELECT 
        //     COUNT(*)
        // FROM BusWay 
        //     LEFT OUTER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
        //     LEFT OUTER JOIN BusStop ON BusRoute.busRouteId = BusStop.busRouteId
        //     LEFT OUTER JOIN EventBus ON BusWay.busWayId = EventBus.busWayId
        //     WHERE BusRoute.projectId = 16
        // ${whereQuery} 
        // GROUP BY BusWay.busWayId`;

        // get list sql
        const sql_data = `SELECT 
             DISTINCT 
             BusWay.busWayId, 
             BusRoute.busRouteName,
             BusWay.busWayName,
             BusWay.busWayCapacity,
             BusRoute.busRouteManageName,
             EventBus.busReservationCount
         FROM BusWay 
             LEFT OUTER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
             LEFT OUTER JOIN EventBus ON BusWay.busWayId = EventBus.busWayId
             WHERE BusRoute.projectId = ?
         ${whereQuery} 
         GROUP BY BusWay.busWayId`



        // console.log("sql_count:", sql_counts);
        console.log("sql_data:", sql_data);
        console.log("query params:", parameter);

        let mysql_con;
        try {
            // mysql connect
            mysql_con = await mysql.createConnection(readDbConfig);
            // count query execute
            // let [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
            // count query execute
            let [query_result2, query_fields2] = await mysql_con.query(sql_data, parameter);
            // get response
            let response = {
                count: query_result2.length,
                records: query_result2
                // page: pagesVisited,
                // limit: itemsPerPage
            }
            console.log("query response:", response);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(response),
            }
        } catch (error) {
            console.log("error:", error)
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        } finally {
            if (mysql_con) await mysql_con.close();
        }
    } else {
        let response = {
            message: "Invalid parameter."
        };
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    }
};