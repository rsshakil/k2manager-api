/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventMappingSlotUpdate.
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
        process.env.DBINFO = true
    }
    // Database info
    let writeDbConfig = {
        host: process.env.DBWRITEENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };

    try {
        // mysql connect
        const mysql_con = await mysql.createConnection(writeDbConfig);
        const updatedAt = Math.floor(new Date().getTime() / 1000);
        let parameter2 = [];
        const {
            memo,
            updatedBy,
            rowsData
        } = JSON.parse(event.body);
        logAccountId = updatedBy;
        const mappingId = Number(event.pathParameters.mappingId);
        console.log('mappingId', mappingId);

        if (rowsData != undefined) {
            // beforeDataの作成
            let beforeSql = `SELECT slotId, datetime, itemId, itemSubId, counselorId, counselorSubId, sort, maxReservationCount, reservationCount, commonReservationCount, slotFilterQuery FROM EventSlot WHERE mappingId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [mappingId]);

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベントスロットマッピングID";
            logData[0].beforeValue = mappingId;
            logData[0].afterValue = mappingId;
            logData[1] = {};
            logData[1].fieldName = "イベントスロットマッピングデータ";
            logData[1].beforeValue = beforeResult;

            let eventItemIdArr = [];
            for (const [key, value] of Object.entries(rowsData[0])) {
                const arr = ['ID', 'time', 'second_2', 'instituteLimit'];
                if (!arr.includes(key)) {
                    eventItemIdArr.push(key.replace('_reservation', ''));
                }
            }
            eventItemIdArr = [...new Set(eventItemIdArr)];

            let updatedValueArr = [];
            for (let i = 0; i < eventItemIdArr.length; i++) {
                rowsData.forEach(item => {
// console.log("eventItemIdArr", eventItemIdArr);
                    let rowItemId = eventItemIdArr[i].split('_');
                    // 余計なパラメーター分も処理をしていたため修正　芳賀 2/5
                    if (!eventItemIdArr[i].includes("_common") && !eventItemIdArr[i].includes("_limitflag") && !eventItemIdArr[i].includes("_reservation") && !eventItemIdArr[i].includes("_remain") && !eventItemIdArr[i].includes("_slotId")) {
                        let updatedValue = {};
                        updatedValue.mappingId = mappingId;
                        updatedValue.datetime = Number(item.time.replace(':', ''));
                        updatedValue.itemId = rowItemId[0] != 'null' ? Number(rowItemId[0]) : 0;
                        updatedValue.maxReservationCount = item[`${eventItemIdArr[i]}`];
                        updatedValue.reservationCount = item[`${eventItemIdArr[i]}_reservation`];
// console.log('eventItemIdArr', `${eventItemIdArr[i]}`);
                        updatedValueArr.push(updatedValue);
                    }
                })
            }

            updatedValueArr.sort(function (a, b) { return a.datetime - b.datetime });

            // console.log('updatedValueArr', updatedValueArr);
            // スロットのアップデート
            // 変更していない分も無駄にアップデートしている TODO
            for (let i = 0; i < updatedValueArr.length; i++) {
                let sql_query1 = `UPDATE EventSlot SET  maxReservationCount = ?, updatedBy = ?, updatedAt = ? WHERE mappingId = ? AND datetime = ? AND itemId = ? AND commonReservationCount <= ?`;
                let parameter = [updatedValueArr[i].maxReservationCount, updatedBy, updatedAt, mappingId, updatedValueArr[i].datetime, updatedValueArr[i].itemId, updatedValueArr[i].maxReservationCount];

                console.log('sql_query1', sql_query1);
                console.log('parameter', parameter);

                var [query_result2] = await mysql_con.query(sql_query1, parameter);
                if (query_result2.changedRows == 0) {
                    throw (403, "capacity over");
                }
            }

            //for (let i = 0; i < rowsData.length; i++) {
            // let check_sql = `SELECT datetime, itemId, maxReservationCount FROM EventSlot WHERE slotId = ?`;
            // parameter.push(slot[i].slotId);
            // var [check_query_result1] = await mysql_con.query(check_sql, parameter);
            // let datetime = check_query_result1[0].datetime;
            // let itemId = check_query_result1[0].itemId;
            // let check_sql2 = `SELECT maxReservationCount FROM EventSlot WHERE mappingId = ? AND datetime = ? AND itemId = 0`;
            // parameter = [];
            // parameter.push(event.pathParameters.mappingId);
            // parameter.push(datetime);
            // var [check_query_result2] = await mysql_con.query(check_sql2, parameter);
            // if (check_query_result2[0] != null) {
            //     let sql_query1 = `UPDATE EventSlot SET  maxReservationCount = ?, updatedBy = ?, updatedAt = ? WHERE slotId = ? AND reservationCount <= ? AND maxReservationCount <= ?`;
            //     parameter.push(slot[i].count);
            //     parameter.push(updatedBy);
            //     parameter.push(updatedAt);
            //     parameter.push(slot[i].slotId);
            //     parameter.push(slot[i].count);
            //     parameter.push(check_query_result2[0].maxReservationCount);
            //     var [query_result2] = await mysql_con.query(sql_query1, parameter);
            //     if (query_result2.changedRows == 0) {
            //         throw (400, "slotId " + slot[i].slotId + " capacity over!");            
            //     }
            // } else {
            // let sql_query1 = `UPDATE EventSlot SET  maxReservationCount = ?, updatedBy = ?, updatedAt = ? WHERE slotId = ? AND reservationCount <= ?`;
            // parameter.push(slot[i].count);
            // parameter.push(updatedBy);
            // parameter.push(updatedAt);
            // parameter.push(slot[i].slotId);
            // parameter.push(slot[i].count);
            // var [query_result2] = await mysql_con.query(sql_query1, parameter);
            // if (query_result2.changedRows == 0) {
            //     throw (400, "slotId " + slot[i].slotId + " capacity over!");            
            // }
            // }


            // let maxBaseCnt = query_result1[0].maxReservationCount;
            // parameter = [];
            // if (slot[i].count > maxBaseCnt) {
            // let sql_query1 = `UPDATE EventSlot SET  maxReservationCount = ?, updatedBy = ?, updatedAt = ? WHERE slotId = ? AND reservationCount <= ?`;
            // parameter.push(slot[i].count);
            // parameter.push(updatedBy);
            // parameter.push(updatedAt);
            // parameter.push(slot[i].slotId);
            // parameter.push(slot[i].count);
            // var [query_result2] = await mysql_con.query(sql_query1, parameter);
            // if (query_result2.changedRows == 0) {
            //     throw (400, "slotId " + slot[i].slotId + " capacity over!");            
            // }
            // }
            //}
        }
        let response = {};
        if (memo != undefined) {
            let sql_query2 = `UPDATE EventMapping SET memo = ?, updatedBy = ?, updatedAt = ? WHERE mappingId = ?`;
            parameter2.push(memo);
            parameter2.push(updatedBy);
            parameter2.push(updatedAt);
            parameter2.push(event.pathParameters.mappingId);
            var [query_result3] = await mysql_con.query(sql_query2, parameter2);
            response = { records: query_result3[0] }
        }
        // construct the response
        console.log('this is response >>>>>>>>>>>>>>', response)

        // afterData
        let afterSql = `SELECT slotId, datetime, itemId, itemSubId, counselorId, counselorSubId, sort, maxReservationCount, reservationCount, commonReservationCount, slotFilterQuery FROM EventSlot WHERE mappingId = ?`;
        let [afterResult] = await mysql_con.execute(afterSql, [mappingId]);
        logData[1].afterValue = afterResult;

        // success log
        await createLog(context, 'イベントマッピングスロット', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    } catch (error) {
        console.log(error)
        // failure log
        await createLog(context, 'イベントマッピングスロット', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify({ message: error }),
        }
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