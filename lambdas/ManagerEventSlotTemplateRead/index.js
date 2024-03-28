
/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require('aws-sdk')
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();

exports.handler = async (event) => {
    console.log(event);
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
    let readDbConfig = {
        host: process.env.DBREADENDPOINT,
        user: process.env.DBUSER,
        password: process.env.DBPASSWORD,
        database: process.env.DBDATABSE,
        charset: process.env.DBCHARSET
    };
    console.log("Event data: ", event);
    // mysql connect
    let mysql_con = await mysql.createConnection(readDbConfig);

    // if (true) {
    if (event.pathParameters?.eventInstituteId != null) {
        console.log("got query string params!")
        let eventInstituteId = event.pathParameters.eventInstituteId;
        // debug 
        // let eventInstituteId = 65;
        let sql_data = "";
        // get list sql
        sql_data = `SELECT *
       FROM EventInstitute
       WHERE EventInstitute.eventInstituteId = ?`
        try {
            console.log("query:", sql_data);
            var [query_result2, query_fields2] = await mysql_con.query(sql_data, [eventInstituteId]);
            let response = {};
            // data exists
            if (query_result2[0]?.eventInstituteItemStyle) {
                console.log("data exists", JSON.stringify(query_result2[0].eventInstituteItemStyle));

                const { eventInstituteSlotType, eventInstituteSlotStyle = [], eventInstituteItemStyle } = query_result2[0] || {};

                if (eventInstituteSlotType == 2 || eventInstituteSlotType == 1) {  // 0 = repeating pattern, 1 = Input one frame at a time, 2 = bus type
                    const eventInstituteItemStyleData = JSON.parse(JSON.stringify(eventInstituteItemStyle));
                    const { rowsData = [], columnsData = {} } = eventInstituteItemStyleData || {};
                    const timeSlotList = rowsData.map(x => x.time);

                    let missingTimeSlot = [];
                    eventInstituteSlotStyle.forEach(x => {
                        if (!timeSlotList.includes(x)) missingTimeSlot.push(x);
                    })

                    console.log('missing time slot ------------------>', missingTimeSlot)

                    let modifiedEventInstituteItemStyle = eventInstituteItemStyle;

                    if (missingTimeSlot.length > 0) {
                        const slots = columnsData?.slots || [];

                        const missingRowsData = missingTimeSlot.map((time, i) => {
                            let rowsDetailData = {
                                "ID": (i + 1),
                                "time": time,
                                "instituteLimit": 0
                            }

                            for (let k = 1; k < slots.length; k++) {
                                if (slots[k].child.length > 0) {
                                    rowsDetailData[slots[k].child[0].itemId + "_" + slots[k].id] = 0;
                                }
                            }

                            return rowsDetailData;
                        })

                        const modifiedRowData = [...rowsData, ...missingRowsData];
                        modifiedRowData.sort((a, b) => parseInt(a.time) - parseInt(b.time));

                        modifiedEventInstituteItemStyle = { ...eventInstituteItemStyle, rowsData: modifiedRowData };
                    }

                    response = { records: modifiedEventInstituteItemStyle };
                } else {
                    response = { records: eventInstituteItemStyle };
                }

                /*
                               let rowsData = [];
                               let columnsData = [];
                               let eventInstituteSlotType = query_result2[0].eventInstituteSlotType;
                               let eventInstituteSlotStyle = query_result2[0].eventInstituteSlotStyle;
                               let eventInstituteItemInfo = query_result2[0].eventInstituteItemInfo;
                               let rowsCellData = [];
                               let slots = [];
                
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
                               if (eventInstituteItemInfo) {
                                   console.log("eventInstituteItemInfo exists");
                                   // item slot column
                                   let itemDatas = eventInstituteItemInfo?.dragList
                                   if (itemDatas.length >= 1) {
                                       for (let i = 0; i < itemDatas.length; i++) {
                                           let itemData = itemDatas[i];
                                           let j = (i + 3);
                                           let columnsItemData = {
                                               "id": j,
                                               "child": [
                                                   {
                                                       "id": j,
                                                       "next": (j+1),
                                                       "prev": (j-1),
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
                               columnsData = {"slots": slots};
                               // count row
                               // 連続枠
                               if (eventInstituteSlotType == 0) {
                                   let start = eventInstituteSlotStyle.mappingStartTime
                                   let end = eventInstituteSlotStyle.mappingEndTime
                                   let interval = eventInstituteSlotStyle.mappingInterval
                                   while(true) {
                                       rowsCellData.push(Number(start))
                                       start = Number(start) + Number(interval)
                                       let minutes = Number(String(start).slice( -2 ))
                                       let hour = (String(start).length == 4)? Number(String(start).slice(0, 2)): Number(String(start).slice(0, 1))
                                       if (minutes >= 60) {
                                           hour = hour + 1
                                           minutes = minutes - 60
                                           minutes = (String(minutes).length == 1)?"0" + String(minutes): String(minutes)
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
                
                               // Sort with ascending order
                               rowsCellData.sort(function(a, b){return a - b});
                               for (let i = 0; i < rowsCellData.length; i++) {
                                   let time;
                                   if (String(rowsCellData[i]).length == 3) {
                                       time = ("0" + String(rowsCellData[i]).slice(0, 1)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                                   }
                                   else {
                                       time = ("0" + String(rowsCellData[i]).slice(0, 2)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                                   }
                                   let rowsDetailData = {
                                       "ID": (i+1),
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
                               
                               response = {
                                   records: {
                                       "rowsData": rowsData,
                                       "columnsData": columnsData
                                   }
                               }
                */

                /*
                               response = {
                                   records: query_result2[0].eventInstituteItemStyle
                               }
                */
            }
            // data not exists
            else {
                console.log("data not exists");
                let rowsData = [];
                let columnsData = [];
                let eventInstituteSlotType = query_result2[0].eventInstituteSlotType;
                let eventInstituteSlotStyle = query_result2[0].eventInstituteSlotStyle;
                let eventInstituteItemInfo = query_result2[0].eventInstituteItemInfo;
                let rowsCellData = [];
                let slots = [];

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
                if (eventInstituteItemInfo) {
                    console.log("eventInstituteItemInfo exists");
                    // item slot column
                    let itemDatas = eventInstituteItemInfo?.dragList
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
                        rowsCellData.push(Number(start));

                        let prevStart = start;

                        start = Number(start) + Number(interval)
                        let minutes = Number(String(start).slice(-2))
                        let hour = Number(String(prevStart).padStart(4, '0').slice(0, 2));

                        if (minutes >= 60) {
                            hour = hour + 1
                            minutes = minutes - 60
                            minutes = (String(minutes).length == 1) ? "0" + String(minutes) : String(minutes)
                            start = String(hour) + String(minutes)
                        }

                        if (Number(start) > end) {
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


                // Sort with ascending order
                rowsCellData.sort(function (a, b) { return a - b });
                for (let i = 0; i < rowsCellData.length; i++) {
                    let time;
                    if (String(rowsCellData[i]).length == 3)
                        time = ("0" + String(rowsCellData[i]).slice(0, 1)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                    else if (String(rowsCellData[i]).length > 3)
                        time = ("0" + String(rowsCellData[i]).slice(0, 2)).slice(-2) + ":" + String("0" + rowsCellData[i]).slice(-2)
                    else if (String(rowsCellData[i]).length < 3) {
                        const timeStr = String(rowsCellData[i]).padStart(4, '0');
                        const timeArr = timeStr.match(/.{1,2}/g) ?? [];

                        time = timeArr.join(":");
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
                response = {
                    records: {
                        "rowsData": rowsData,
                        "columnsData": columnsData
                    }
                }
                // console.log("response data", JSON.stringify(response.records));
            }
            // console.log(response);
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
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        }
    }
    else if (event.queryStringParameters?.eid != null) {
        console.log("event slot template list")
        let eid = event.queryStringParameters.eid;
        let sql_data = `SELECT eventInstituteItemStyle FROM EventInstitute 
INNER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
INNER JOIN EventCategory ON EventCategory.eventCategoryId = EventInstitute.eventCategoryId WHERE eventId = ? AND eventInstituteItemStyle IS NOT NULL`;
        try {
            //
            console.log("query:", sql_data);
            var [query_result2, query_fields2] = await mysql_con.query(sql_data, [eid]);
            // eventInstituteItemStyle に値が入っていた場合そのまま返却


            let response = {
                records: query_result2
            }
            // console.log(response);
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
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                },
                body: JSON.stringify(error),
            }
        }

    }
    else {
        console.log("invalid parameter");
        return {
            statusCode: 400,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            },
            body: JSON.stringify({ "message": "invalid parameter" }),
        };
    }
}
