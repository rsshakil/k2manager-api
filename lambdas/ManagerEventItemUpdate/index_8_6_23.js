/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventItemUpdate.
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
            eventInstituteItemInfo,
            memo,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = updatedBy;
        const updatedAt = Math.floor(new Date().getTime() / 1000);
        let sql_data = `UPDATE EventInstitute SET 
            eventInstituteItemInfo = ?,
            memo3 = ?,
            updatedAt = ?,
            updatedBy = ?
            WHERE eventInstituteId = ?`;
        let sql_param = [
            eventInstituteItemInfo,
            memo,
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
            let beforeSql = `SELECT * FROM EventInstitute WHERE eventInstituteId = ?`;
            let [beforeResult] = await mysql_con.execute(beforeSql, [eventInstituteId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                console.log("Found set already deleted");
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'イベントアイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            logData[0].fieldName = "イベント施設ID";
            logData[0].beforeValue = eventInstituteId;
            logData[0].afterValue = eventInstituteId;
            logData[1] = {};
            logData[1].fieldName = "イベント施設アイテム情報";
            logData[1].beforeValue = beforeResult[0].eventInstituteItemInfo;
            logData[1].afterValue = eventInstituteItemInfo;

            let [query_result] = await mysql_con.execute(sql_data, sql_param);
            // if (query_result.length === 0) {
            //     // failure log
            //     await createLog(context, 'イベントアイテム', '更新', '失敗', '404', event.requestContext.identity.sourceIp, logAccountId, logData);
            //     return {
            //         statusCode: 404,
            //         headers: {
            //             "Access-Control-Allow-Origin": "*",
            //             "Access-Control-Allow-Headers": "*",
            //         },
            //         body: JSON.stringify({
            //             message: "no data"
            //         }),
            //     };
            // }

            // eventInstituteItemInfoの更新に成功した場合、eventInstituteItemStyleも作成する
            let sql_data2 = `SELECT *
                FROM EventInstitute
                WHERE EventInstitute.eventInstituteId = ?`;
            let [query_result2] = await mysql_con.execute(sql_data2, [eventInstituteId]);
            let rowsData = [];
            let columnsData = [];
            let eventInstituteSlotType = query_result2[0].eventInstituteSlotType;
            let eventInstituteSlotStyle = query_result2[0].eventInstituteSlotStyle;
            let eventInstituteItemInfo2 = query_result2[0].eventInstituteItemInfo;
            let rowsCellData = [];
            let slots = [];
            if (!query_result2[0].eventInstituteItemStyle) {
                // time column
                let columnsDetailData = {
                    "id": 1,
                    "child": [
                        {
                            "id": 1,
                            "next": 4,
                            "prev": null,
                            "fixed": true,
                            "width": 92,
                            "format": "string",
                            "gChild": [],
                            "caption": "開催時間",
                            "chained": false,
                            "cssClass": false,
                            "parentId": 1,
                            "dataField": "time",
                            "chainedWith": null,
                            "allowEditing": false,
                            "allowSorting": false,
                            "displayChain": false,
                            "isLastElement": false,
                            "allowReordering": false,
                        }
                    ],
                    "fixed": true,
                    "caption": "",
                    "allowReordering": false,
                };
                slots.push(columnsDetailData);
                // base slot column
                let columnsBasicData = {
                    "id": 2,
                    "child": [
                        {
                            "id": 2,
                            "next": 3,
                            "prev": 1,
                            "format": "string",
                            "gChild": [
                                {
                                    "width": 92,
                                    "caption": "最大",
                                    "parentId": 2,
                                    "dataField": "second_2",
                                    "allowEditing": true,
                                    "allowSorting": false,
                                    "allowReordering": false
                                }
                            ],
                            "itemId": "second",
                            "caption": "施設上限枠",
                            "chained": false,
                            "cssClass": true,
                            "parentId": 2,
                            "chainedWith": null,
                            "displayChain": false,
                            "isLastElement": false,
                            "allowReordering": false
                        }
                    ],
                    "caption": "",
                    "allowReordering": false
                };
                slots.push(columnsBasicData);

                // columnsDataはeventInstituteItemInfoを解析して作成する
                if (eventInstituteItemInfo2?.dragList) {
                    console.log("eventInstituteItemInfo exists");
                    // item slot column
                    let itemDatas = eventInstituteItemInfo2?.dragList
                    if (itemDatas.length >= 1) {
                        for (let i = 0; i < itemDatas.length; i++) {
                            let itemData = itemDatas[i];
                            let j = (i + 3);
                            let columnsItemData = {
                                "id": j,
                                "child": [
                                    {
                                        "id": j,
                                        "next": (j + 1),
                                        "prev": (j - 1),
                                        "format": "string",
                                        "gChild": [
                                            {
                                                "width": 92,
                                                "caption": "最大",
                                                "parentId": j,
                                                "dataField": itemData.buttonId + "_" + j,
                                                "allowEditing": true,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            }
                                        ],
                                        "itemId": itemData.buttonId,
                                        "caption": itemData.name,
                                        "chained": false,
                                        "cssClass": false,
                                        "parentId": j,
                                        "chainedWith": null,
                                        // "allowEditing": false,
                                        // "allowSorting": false,
                                        "displayChain": true,
                                        "isLastElement": false,
                                        "allowReordering": false,
                                    }
                                ],
                                "caption": "",
                                "allowReordering": true,
                            };
                            slots.push(columnsItemData);
                        }
                    }
                }
                columnsData = { "slots": slots };
                // count row
                // 連続枠
                if (eventInstituteSlotType == 0) {
                    let start = eventInstituteSlotStyle.mappingStartTime
                    let end = eventInstituteSlotStyle.mappingEndTime
                    let interval = eventInstituteSlotStyle.mappingInterval
                    while (true) {
                        rowsCellData.push(Number(start))
                        start = Number(start) + Number(interval)
                        let minutes = Number(String(start).slice(-2))
                        let hour = (String(start).length == 4) ? Number(String(start).slice(0, 2)) : Number(String(start).slice(0, 1))
                        if (minutes >= 60) {
                            hour = hour + 1
                            minutes = minutes - 60
                            minutes = (String(minutes).length == 1) ? "0" + String(minutes) : String(minutes)
                            start = String(hour) + String(minutes)
                        }
                        if (start > end) {
                            break;
                        }
                    }
                }
                // 個別枠
                else if (eventInstituteSlotType == 1 || eventInstituteSlotType == 2) {
                    console.log("個別枠 ---- || バス枠 ----");
                    if (eventInstituteSlotStyle !== undefined && eventInstituteSlotStyle != null) {
                        eventInstituteSlotStyle.forEach(date => {
                            rowsCellData.push(Number(date.replace(':', '')));
                        })
                    }
                }

                // Sort with ascending order
                rowsCellData.sort(function (a, b) { return a - b });
                for (let i = 0; i < rowsCellData.length; i++) {
                    let time;
                    if (String(rowsCellData[i]).length == 3) {
                        time = ("0" + String(rowsCellData[i]).slice(0, 1)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                    }
                    else {
                        time = ("0" + String(rowsCellData[i]).slice(0, 2)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                    }
                    let rowsDetailData = {
                        "ID": (i + 1),
                        "time": time,
                        "instituteLimit": 0
                    }
                    for (let k = 0; k < slots.length; k++) {
                        if (slots[k].id != 0 && slots[k].id != 1) {
                            rowsDetailData[slots[k].child[0].itemId + "_" + slots[k].id] = 0
                        }
                    }
                    rowsData.push(rowsDetailData)
                }

                console.log("rowsData", rowsData);

                let eventInstituteItemStyle = {
                    "rowsData": rowsData,
                    "columnsData": columnsData
                }

                logData[2] = {};
                logData[2].fieldName = "イベント施設スロットテンプレート";
                logData[2].beforeValue = beforeResult[0].eventInstituteItemStyle;
                logData[2].afterValue = eventInstituteItemStyle;
                logData[3] = {};
                logData[3].fieldName = "メモ";
                logData[3].beforeValue = beforeResult[0].memo3;
                logData[3].afterValue = memo;

                let update_sql = `UPDATE EventInstitute SET 
                    eventInstituteItemStyle = ?,
                    updatedAt = ?,
                    updatedBy = ?
                    WHERE eventInstituteId = ?`;
                sql_param = [
                    eventInstituteItemStyle,
                    updatedAt,
                    updatedBy,
                    eventInstituteId
                ];
                let [query_result3] = await mysql_con.execute(update_sql, sql_param);
            }
            // すでにあった場合、両方を組み合わせる
            else {
                console.log("xxxxxxxxxx---------------------1");

                let oldRowsData = query_result2[0].eventInstituteItemStyle.rowsData;
                // time column
                let columnsDetailData = {
                    "id": 1,
                    "child": [
                        {
                            "id": 1,
                            "next": 4,
                            "prev": null,
                            "fixed": true,
                            "width": 92,
                            "format": "string",
                            "gChild": [],
                            "caption": "開催時間",
                            "chained": false,
                            "cssClass": false,
                            "parentId": 1,
                            "dataField": "time",
                            "chainedWith": null,
                            "allowEditing": false,
                            "allowSorting": false,
                            "displayChain": false,
                            "isLastElement": false,
                            "allowReordering": false,
                        }
                    ],
                    "fixed": true,
                    "caption": "",
                    "allowReordering": false,
                };
                slots.push(columnsDetailData);
                // base slot column
                let columnsBasicData = {
                    "id": 2,
                    "child": [
                        {
                            "id": 2,
                            "next": 3,
                            "prev": 1,
                            "format": "string",
                            "gChild": [
                                {
                                    "width": 92,
                                    "caption": "最大",
                                    "parentId": 2,
                                    "dataField": "second_2",
                                    "allowEditing": true,
                                    "allowSorting": false,
                                    "allowReordering": false
                                }
                            ],
                            "itemId": "second",
                            "caption": "施設上限枠",
                            "chained": false,
                            "cssClass": true,
                            "parentId": 2,
                            "chainedWith": null,
                            "displayChain": false,
                            "isLastElement": false,
                            "allowReordering": false
                        }
                    ],
                    "caption": "",
                    "allowReordering": false
                };
                slots.push(columnsBasicData);
                console.log("xxxxxxxxxx---------------------2");
                if (eventInstituteItemInfo2?.dragList) {
                    console.log("eventInstituteItemInfo exists");
                    // item slot column
                    let itemDatas = eventInstituteItemInfo2?.dragList
                    // columnsDataはeventInstituteItemInfoを解析して作成する
                    if (itemDatas.length >= 1) {
                        for (let i = 0; i < itemDatas.length; i++) {
                            let itemData = itemDatas[i];
                            let j = (i + 3);
                            let columnsItemData = {
                                "id": j,
                                "child": [
                                    {
                                        "id": j,
                                        "next": (j + 1),
                                        "prev": (j - 1),
                                        "format": "string",
                                        "gChild": [
                                            {
                                                "width": 92,
                                                "caption": "最大",
                                                "parentId": j,
                                                "dataField": itemData.buttonId + "_" + j,
                                                "allowEditing": true,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            }
                                        ],
                                        "itemId": itemData.buttonId,
                                        "caption": itemData.name,
                                        "chained": false,
                                        "cssClass": false,
                                        "parentId": j,
                                        "chainedWith": null,
                                        // "allowEditing": false,
                                        // "allowSorting": false,
                                        "displayChain": true,
                                        "isLastElement": false,
                                        "allowReordering": false,
                                    }
                                ],
                                "caption": "",
                                "allowReordering": true,
                            };
                            slots.push(columnsItemData);
                        }
                    }
                }
                columnsData = { "slots": slots };
                // count row
                // 連続枠
                if (eventInstituteSlotType == 0) {
                    let start = eventInstituteSlotStyle.mappingStartTime
                    let end = eventInstituteSlotStyle.mappingEndTime
                    let interval = eventInstituteSlotStyle.mappingInterval
                    while (true) {
                        rowsCellData.push(Number(start))
                        start = Number(start) + Number(interval)
                        let minutes = Number(String(start).slice(-2))
                        let hour = (String(start).length == 4) ? Number(String(start).slice(0, 2)) : Number(String(start).slice(0, 1))
                        if (minutes >= 60) {
                            hour = hour + 1
                            minutes = minutes - 60
                            minutes = (String(minutes).length == 1) ? "0" + String(minutes) : String(minutes)
                            start = String(hour) + String(minutes)
                        }
                        if (start > end) {
                            break;
                        }
                    }
                }
                // 個別枠
                else if (eventInstituteSlotType == 1 || eventInstituteSlotType == 2) {
                    console.log("個別枠 ---- || バス枠 ----");
                    eventInstituteSlotStyle.forEach(date => {
                        rowsCellData.push(Number(date.replace(':', '')));
                    })
                }

                console.log("xxxxxxxxxx---------------------4", oldRowsData);

                console.log("xxxxxxxxxx---------------------5", rowsCellData);
                // Sort with ascending order
                rowsCellData.sort(function (a, b) { return a - b });
                for (let i = 0; i < rowsCellData.length; i++) {
                    let time;
                    if (String(rowsCellData[i]).length == 3) {
                        time = ("0" + String(rowsCellData[i]).slice(0, 1)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                    }
                    else {
                        time = ("0" + String(rowsCellData[i]).slice(0, 2)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                    }
                    let rowsDetailData = {
                        "ID": (i + 1),
                        "time": time,
                        "instituteLimit": 0
                    }
                    for (let k = 0; k < slots.length; k++) {
                        if (slots[k].id != 0 && slots[k].id != 1) {
                            let matchFlag = false;
                            let matchValue = 0;

                            if (oldRowsData) {
                                for (let l = 0; l < oldRowsData.length; l++) {
                                    if (time == oldRowsData[l].time) {
                                        console.log("xxxxxxxxxx---------------------5_1 = ", slots[k].child[0].itemId + "_" + slots[k].id);
                                        console.log("xxxxxxxxxx---------------------5_2 = ", oldRowsData[l][slots[k].child[0].itemId + "_" + slots[k].id]);
                                        matchValue = (oldRowsData[l][slots[k].child[0].itemId + "_" + slots[k].id]) ? oldRowsData[l][slots[k].child[0].itemId + "_" + slots[k].id] : 0
                                    }
                                }
                            }
                            console.log("xxxxxxxxxx---------------------7");
                            rowsDetailData[slots[k].child[0].itemId + "_" + slots[k].id] = matchValue
                        }
                    }
                    rowsData.push(rowsDetailData)
                }
                console.log("xxxxxxxxxx---------------------3", rowsData);

            }

            let eventInstituteItemStyle = {
                "rowsData": rowsData,
                "columnsData": columnsData
            }

            logData[2] = {};
            logData[2].fieldName = "イベント施設スロットテンプレート";
            logData[2].beforeValue = beforeResult[0].eventInstituteItemStyle;
            logData[2].afterValue = eventInstituteItemStyle;
            logData[3] = {};
            logData[3].fieldName = "メモ";
            logData[3].beforeValue = beforeResult[0].memo3;
            logData[3].afterValue = memo;

            let update_sql = `UPDATE EventInstitute SET 
                eventInstituteItemStyle = ?,
                updatedAt = ?,
                updatedBy = ?
                WHERE eventInstituteId = ?`;
            sql_param = [
                eventInstituteItemStyle,
                updatedAt,
                updatedBy,
                eventInstituteId
            ];
            let [query_result3] = await mysql_con.execute(update_sql, sql_param);

            // construct the response
            let response = {
                records: query_result[0]
            };
            console.log("response:", response);
            mysql_con.commit();
            // success log
            await createLog(context, 'イベントアイテム', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
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
            await createLog(context, 'イベントアイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'イベントアイテム', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);

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