/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
 const AWS = require('aws-sdk')
 const mysql = require("mysql2/promise");
 const ssm = new AWS.SSM();

 /**
 * ManagerEventMappingSlotRead.
 * 
 * @param {*} event 
 * @returns {json} response
 */
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
     let mysql_con;
     let readDbConfig = {
         host: process.env.DBREADENDPOINT,
         user: process.env.DBUSER,
         password: process.env.DBPASSWORD,
         database: process.env.DBDATABSE, 
         charset: process.env.DBCHARSET
     };
     console.log("Event data: ",event);
     // mysql connect
     mysql_con = await mysql.createConnection(readDbConfig);

    if (event.pathParameters.mappingId !== null) {
        console.log("got query string params!")
        // Expand POST parameters 
        //  let jsonBody = JSON.parse(event.body);
        let jsonBody = event.queryStringParameters;
        // let pagesVisited = (jsonBody.pagesVisited || jsonBody.pagesVisited == 0) ? jsonBody.pagesVisited : 0;
        // let itemsPerPage = (jsonBody.itemsPerPage || jsonBody.itemsPerPage == 0) ? jsonBody.itemsPerPage : 500;
        
        const mappingId = event.pathParameters.mappingId;
        
        let parameter = [];
        let sql_data = "";
        
        const sql_Institute = `SELECT Institute.instituteName, mappingDatetime, EventMapping.memo, EventInstitute.eventInstituteSlotType
        FROM EventMapping
        LEFT OUTER JOIN EventInstitute ON EventMapping.eventInstituteId = EventInstitute.eventInstituteId
        LEFT OUTER JOIN Institute ON EventInstitute.instituteId = Institute.instituteId
        WHERE EventMapping.mappingId = ?
        LIMIT 1`;
        
        // total count sql
        //sql_count = `SELECT COUNT(mappingId) as count FROM EventMapping INNER JOIN Institute ON EventMapping.instituteId = Institute.instituteId WHERE 1=1 ${(whereQuery)}`;
        // get list sql
        sql_data = ` 
            SELECT 
            Item.itemName AS itemName,
            slotId, 
            dateTime AS slotTime,
            Item.itemId,
            SUM(reservationCount) AS numberOfReservedSlots,
            maxReservationCount AS maximumNumberOfSlots,
            commonReservationCount,
            sort,
            headerOrder
            FROM EventSlot
            LEFT OUTER JOIN Item ON EventSlot.itemId = Item.itemId
            LEFT OUTER JOIN EventSubItem ON EventSlot.mappingId = EventSubItem.mappingId AND EventSlot.itemId = EventSubItem.itemId And EventSlot.itemSubId = EventSubItem.itemSubId 
            WHERE EventSlot.mappingId = ?
            GROUP BY itemId, slotTime
            ORDER BY slotTime ASC, headerOrder ASC
            `;

        let sql_event_sub_item = `SELECT itemId, chainItemId, headerOrder FROM EventSubItem WHERE mappingId = ? AND itemId != ? ORDER BY headerOrder ASC`;
                    
        try {
            var [query_result2, query_fields2] = await mysql_con.query(sql_Institute, [mappingId]);
            
            let instituteName = '';
            let mappingDatetime = '';
            let memo = '';
            let eventInstituteSlotType = '';
            let query_result4 = '';
            let eventBusId = [];
            if(query_result2.length > 0) {
                instituteName = query_result2[0].instituteName;
                mappingDatetime = query_result2[0].mappingDatetime;
                memo = query_result2[0].memo;
                eventInstituteSlotType = query_result2[0].eventInstituteSlotType;
            }
            parameter.push(mappingId);
            // バスの場合バスIDを渡す
            if (eventInstituteSlotType == 2) {
                let sql_data2 = `SELECT eventBusId, busWayName, busRouteName FROM EventBus 
                LEFT OUTER JOIN BusWay ON EventBus.busWayId = BusWay.busWayId 
                LEFT OUTER JOIN BusRoute ON BusWay.busRouteId = BusRoute.busRouteId
                WHERE EventBus.mappingId = ?`;
                [query_result4] = await mysql_con.query(sql_data2, parameter);
                for (let i = 0; i < query_result4.length; i++) {
                    eventBusId.push(query_result4[i]);
                }
            }
            //var [query_result1, query_fields1] = await mysql_con.query(sql_count, parameter);
            // parameter.push(Number(pagesVisited));
            // parameter.push(Number(itemsPerPage));
            
            console.log("Query string params: ",parameter);    
            console.log("query:", sql_data);  
            var [query_result3] = await mysql_con.query(sql_data, parameter);
            console.log("query_result3", query_result3);

            var [query_result_event_sub_item] = await mysql_con.query(sql_event_sub_item, [mappingId, 0]);
            console.log("query_result_event_sub_item", query_result_event_sub_item);
            
            let itemListArr = [];
            let slotTimeArr = [];
            let response = {};
            let rowsData = [];
            let columnsData = [];
            let slots = [];
        
            // Getting all item id & slotTime
            query_result3.forEach((item, i) => {
                itemListArr.push(item.itemId);
                slotTimeArr.push(item.slotTime);
            })
        
            // Getting unique item id
            itemListArr = [...new Set(itemListArr)];
            slotTimeArr = [...new Set(slotTimeArr)];

            itemListArr.sort(function(a, b){return a - b});

            // time column
            let columnsDetailData = {
                "id": 1,
                "child": [
                    {
                        "id": 1,
                        "next": 2,
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

console.log("itemListArr", itemListArr);

            if (query_result3.length >= 1) {
                /* Chain item get from event sub item */
                let chainItemOriginalArr = [];
                query_result_event_sub_item.forEach(item => {
                    let chainItemArr = [];
                    chainItemArr.push(item.itemId);
        
                    item.chainItemId.forEach(chain => {
                        const chainId = Number(chain.split(':')[0]);
                        chainItemArr.push(chainId);
                    })
                    chainItemOriginalArr.push([...new Set(chainItemArr)]);
                })

                // Remove duplicates array in multidimensional array where the key positions might not same
                let chainItemFinalArr = Object.values(chainItemOriginalArr.reduce((acc, cur) => {
                    const data = [...cur].sort();
                    const key = JSON.stringify(data);
                    acc[key] = acc[key] ?? cur;
                    return acc; 
                }, {}));
        
                if (chainItemFinalArr.length > 0) {
                    itemListArr = itemListArr.filter(item => {
                        return !chainItemFinalArr.flat().includes(item);
                    });
        
                    chainItemFinalArr.forEach(chainItem => {
                        itemListArr.push(chainItem);
                    })
                }
        
                if (itemListArr.length > 0) {
                    // item slot column
                    var j = 2
                    for (let i = 0; i < itemListArr.length; i++) {
                        j++;
                        let columnsItemData;
                        let itemData;
        
                        if (itemListArr[i] == null || typeof itemListArr[i] === 'number') {
                            itemData = query_result3.find(item => item.itemId == itemListArr[i])
                         
                            columnsItemData = {
                                "id": j,
                                "child": [
                                    {
                                        "id": j,
                                        "next": (j+1),
                                        "prev": (j-1),
                                        "format": "string",
                                        "gChild": [
                                            {
                                                "width": 0,
                                                "caption": "スロットID",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j + "_slotId",
                                                "allowEditing": false,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            },
                                            {
                                                "width": 61.33,
                                                "caption": "予約",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j + "_reservation",
                                                "allowEditing": false,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            },
                                            {
                                                "width": 61.33,
                                                "caption": "残数",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j + "_remain",
                                                "allowEditing": false,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            },
                                            {
                                                "width": 61.33,
                                                "caption": "最大",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j,
                                                "allowEditing": true,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            }
                                        ],
                                        "itemId": itemData.itemId,
                                        "caption": itemData.itemId ? itemData.itemName : '施設上限枠',
                                        "chained": false,
                                        "cssClass": false,
                                        "parentId": j,
                                        "chainedWith": null,
            
                                        "displayChain": false,
                                        "isLastElement": false,
                                        "allowReordering": false,
                                    }
                                ],
                                "caption": "",
                                "allowReordering": false,
                            };
                            slots.push(columnsItemData);
                        } 
                        else {
                            let childArr = [];
        
                            itemListArr[i].forEach((itemId, index) => {
                                itemData = query_result3.find(item => item.itemId == itemId);

                                j = j + index;
                                if (index > 1) {
                                    j = j - 1;
                                }
        
                                let child = 
                                    {
                                        "id": j,
                                        "next": (j+1),
                                        "prev": (j-1),
                                        "format": "string",
                                        "gChild": [
                                            {
                                                "width": 0,
                                                "caption": "スロットID",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j + "_slotId",
                                                "allowEditing": false,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            },
                                            {
                                                "width": 61.33,
                                                "caption": "予約",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j + "_reservation",
                                                "allowEditing": false,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            },
                                            {
                                                "width": 61.33,
                                                "caption": "残数",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j + "_remain",
                                                "allowEditing": false,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            },
                                            {
                                                "width": 61.33,
                                                "caption": "最大",
                                                "parentId": j,
                                                "dataField": itemData.itemId + "_" + j,
                                                "allowEditing": true,
                                                "allowSorting": false,
                                                "allowReordering": false
                                            }
                                        ],
                                        "itemId": itemData.itemId,
                                        "caption": itemData.itemId ? itemData.itemName : '施設上限枠',
                                        "chained": false,
                                        "cssClass": false,
                                        "parentId": j,
                                        "chainedWith": null,
            
                                        "displayChain": false,
                                        "isLastElement": false,
                                        "allowReordering": false,
                                    }
                                childArr.push(child);
                            })
        
                            columnsItemData = {
                                "id": j,
                                "child": childArr,
                                "caption": "",
                                "allowReordering": false,
                            };
                            slots.push(columnsItemData);
                        }
                    }
                }

                let timeToTimeString = function (time) {
                    const timeString = String(time);
                    if (timeString.length < 4) {
                        return ("0" + String(time).slice(0, 1)).slice(-2) + ":" + String("0" + time).slice(-2)
                    }
                    else {
                        return String(time).slice(0, 2) + ":" + String("0" + time).slice(-2)
                    }
                }
        
                for (let i = 0; i < slotTimeArr.length; i++) {
                    let rowsDetailData = {
                        "ID": (i+1),
                        "time": timeToTimeString(slotTimeArr[i]),
                        "instituteLimit": 0
                    }
                    
                    slots.forEach(parent => {
                        parent.child.forEach(child => {
                            if (parent.id != 0 && parent.id != 1) {
                                let itemData = query_result3.find(item => item.itemId == child.itemId && item.slotTime == slotTimeArr[i]);
                                rowsDetailData[child.itemId + "_" + child.id + "_slotId"] = itemData.slotId;
                                rowsDetailData[child.itemId + "_" + child.id + "_reservation"] = Number(itemData.numberOfReservedSlots);
                                rowsDetailData[child.itemId + "_" + child.id + "_remain"] = Number(itemData.maximumNumberOfSlots - itemData.commonReservationCount);
                                rowsDetailData[child.itemId + "_" + child.id] = Number(itemData.maximumNumberOfSlots);
                                rowsDetailData[child.itemId + "_" + child.id + "_common"] = Number(itemData.commonReservationCount);
                                rowsDetailData[child.itemId + "_" + child.id + "_limitflag"] = (itemData.maximumNumberOfSlots == 0)? false: (itemData.maximumNumberOfSlots <= itemData.commonReservationCount)? true: false;
                            }
                        })
                    })
                    rowsData.push(rowsDetailData)
                }
            }
            else {
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
            }
            columnsData = {"slots": slots};
            response = {
                records: {
                    "rowsData": rowsData,
                    "columnsData": columnsData,
                }
            }
            if (eventInstituteSlotType == 2) {
                response.eventBusId = eventBusId
            }
            console.log("response", response);
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
        let response = {
            message: "data not found"
        };
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
            },
            body: JSON.stringify(response),
        }
    }
}