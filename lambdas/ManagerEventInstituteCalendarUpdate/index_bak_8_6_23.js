/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
const AWS = require("aws-sdk");
const mysql = require("mysql2/promise");
const ssm = new AWS.SSM();
const lambda = new AWS.Lambda();

process.env.TZ = "Asia/Tokyo";

/**
 * ManagerEventInstituteCalendarUpdate.
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
            eventInstituteStartDate,
            eventInstituteEndDate,
            mappingData,
            memo,
            updatedBy
        } = JSON.parse(event.body);
        logAccountId = updatedBy;
        const updatedAt = Math.floor(new Date().getTime() / 1000);
        let sql_data = `UPDATE EventInstitute SET 
            eventInstituteMappingStyle = ?,
            eventInstituteStartDate = ?,
            eventInstituteEndDate = ?,
            memo2 = ?,
            updatedAt = ?,
            updatedBy = ?
            WHERE eventInstituteId = ?`;

        // let mappingDataJson = JSON.stringify(mappingData);
        let sql_param = [
            mappingData,
            eventInstituteStartDate,
            eventInstituteEndDate,
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
            let beforeSql2 = `SELECT * FROM EventMapping WHERE eventInstituteId = ?`;
            let [beforeResult2] = await mysql_con.execute(beforeSql2, [eventInstituteId]);
            // Found set already deleted
            if (beforeResult.length === 0) {
                // if (beforeResult.length === 0 || beforeResult2.length === 0) {
                await mysql_con.rollback();
                // failure log
                await createLog(context, 'イベント施設カレンダー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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

            // ログ書き込み
            logData[0] = {};
            logData[0].fieldName = "イベント施設ID";
            logData[0].beforeValue = eventInstituteId;
            logData[0].afterValue = eventInstituteId;
            logData[1] = {};
            logData[1].fieldName = "イベント施設カレンダー開始日時";
            logData[1].beforeValue = beforeResult[0].eventInstituteStartDate;
            logData[1].afterValue = eventInstituteStartDate;
            logData[2] = {};
            logData[2].fieldName = "イベント施設カレンダー終了日時";
            logData[2].beforeValue = beforeResult[0].eventInstituteEndDate;
            logData[2].afterValue = eventInstituteEndDate;
            logData[3] = {};
            logData[3].fieldName = "イベント施設カレンダーマッピングデータ";
            logData[3].beforeValue = beforeResult2;
            logData[3].afterValue = "";
            logData[4] = {};
            logData[4].fieldName = "イベント施設カレンダーメモ";
            logData[4].beforeValue = beforeResult[0].memo2;
            logData[4].afterValue = memo;

            let [query_result] = await mysql_con.query(sql_data, sql_param);

            let mappingDataJson = JSON.parse(mappingData);
            let mappingDataMap = mappingDataJson.eventInstitute;

            // 
            let sql_eventmapping = `SELECT * FROM EventMapping WHERE eventInstituteId = ?`;
            let [event_mappings] = await mysql_con.query(sql_eventmapping, [eventInstituteId]);
            // get event institute data
            let sql_eventinstitute = `SELECT * FROM EventInstitute WHERE EventInstitute.eventInstituteId = ?`;
            let [event_institute] = await mysql_con.query(sql_eventinstitute, [eventInstituteId]);
            // 実施日を追加
            let insert_sql = `INSERT INTO EventMapping(eventInstituteId, mappingDatetime, mappingStartDate, mappingEndDate, receptionDatetimeFrom, receptionDatetimeTo) VALUES(?, ?, ?, ?, ?, ?)`;
            let update_sql = `UPDATE EventMapping SET mappingDatetime = ?, mappingStartDate = ?, mappingEndDate = ?, receptionDatetimeFrom = ?, receptionDatetimeTo = ? WHERE mappingId = ?`;
            let delete_sql = `DELETE FROM EventMapping WHERE mappingId = ?`;
            let values = function (obj) {
                return Object.keys(obj).map(function (key) { return obj[key]; });
            };
            // let row1 = values(mappingDataMap);
            // for (let i = 0; i < row1.length; mappingDataMap++) {
            //     let row2 =  values(row1[i])
            //     for (let j = 0; j < row2.length; j++) {
            //         let row3 = values(row2[j])
            //         for (let k = 0; k < row3.length; k++) {
            //             let row4 = values(row3[k])
            //         }
            //     }
            // }
            // console.log(config.data.mappingData.eventInstitute);
            // var values = function(obj) {
            // 	return Object.keys(obj).map(function (key) { return obj[key]; })
            // }
            // console.log(values(config.data.mappingData.eventInstitute));
            let row1 = values(mappingDataMap);
            for (let i = 0; i < row1.length; i++) { // 年
                if (!row1[i].hasOwnProperty("eventInstituteId")) {
                    let row2 = values(row1[i]);
                    for (let j = 0; j < row2.length; j++) { // 月
                        let row3 = values(row2[j]);
                        for (let k = 0; k < row3.length; k++) { // 枠
                            let row4 = row3[k];
                            row4.state = "insert";
                            // 
                            for (let l = 0; l < event_mappings.length; l++) {
                                if (event_mappings[l].mappingDatetime == (Math.floor(new Date(row4.startDate).getTime() / 1000) + 43200)) {
                                    // update処理						            
                                    row4.state = "update";
                                    row4.mappingId = event_mappings[l].mappingId;
                                    event_mappings[l].state = "match";
                                    break;
                                }
                            }
                        }
                        // 追加 or 更新処理
                        for (let k = 0; k < row3.length; k++) {
                            let row4 = row3[k];
                            if (row4.state == "insert") {
                                console.log("row4", row4);
                                if (row4.startDate !== undefined && row4.startDate != 'undefined') {
                                    sql_param = [
                                        Number(eventInstituteId),
                                        Math.floor(new Date(row4.startDate).getTime() / 1000) + 43200,
                                        Math.floor(new Date(row4.resStartDate).getTime() / 1000),
                                        Math.floor(new Date(row4.startDate).getTime() / 1000),
                                        Math.floor(new Date(row4.resStartDate).getTime() / 1000),
                                        Math.floor(new Date(row4.resEndDate).getTime() / 1000)
                                    ];
                                    console.log("sql_param", sql_param);
                                    [query_result] = await mysql_con.execute(insert_sql, sql_param);
                                    console.log('inset query_result', query_result);
                                    if (query_result.affectedRows === 0) {
                                        mysql_con.rollback();
                                        // failure log
                                        await createLog(context, 'イベント施設カレンダー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                                        return {
                                            statusCode: 400,
                                            headers: {
                                                "Access-Control-Allow-Origin": "*",
                                                "Access-Control-Allow-Headers": "*",
                                            },
                                            body: JSON.stringify({
                                                message: "mapping data failure"
                                            }),
                                        };
                                    }
                                    // When inserted then store event slot data
                                    // ==== Item sort & subId value get start ====
                                    const eventInstituteItemInfo = event_institute[0].eventInstituteItemInfo;
                                    const eventInstituteItemStyle = event_institute[0].eventInstituteItemStyle;

                                    // Insert EventSlot & EventSubItem
                                    if (eventInstituteItemStyle?.rowsData.length > 0) {

                                        let buttonIds = [];
                                        let parentItemIds = [];
                                        eventInstituteItemInfo.treeList.forEach(item => {
                                            buttonIds.push(item.buttonId);
                                            parentItemIds[item.buttonId] = 0;
                                            if (item?.items?.length > 0) {
                                                item?.items.forEach(child => {
                                                    buttonIds.push(child.buttonId);
                                                    parentItemIds[child.buttonId] = item.buttonId;
                                                });
                                            }
                                        });

                                        let objectFlip = function (obj) {
                                            const ret = {};
                                            Object.keys(obj).forEach(key => {
                                                ret[obj[key]] = parseInt(key);
                                            });
                                            return ret;
                                        };

                                        let buttonIdSortValues = objectFlip(buttonIds);
                                        // console.log("parentItemIds", parentItemIds);
                                        // ==========================================

                                        let requiredItemIdValues = [];
                                        if (eventInstituteItemInfo.tagbox1.length > 0) {
                                            for (let i = 0; i < eventInstituteItemInfo.tagbox1.length; i++) {
                                                let eventItemIdArr = eventInstituteItemInfo.tagbox1[i].selectedDrag;

                                                let itemIdArr = [];
                                                eventItemIdArr.forEach(eventItemId => {
                                                    let targetDragList = eventInstituteItemInfo.dragList.find(item => item.id == eventItemId);

                                                    if (targetDragList && targetDragList.buttonId) {
                                                        itemIdArr.push(targetDragList.buttonId);
                                                    }
                                                });
                                                requiredItemIdValues.push(itemIdArr);
                                            }
                                        } else {
                                            requiredItemIdValues.push([]);
                                        }
                                        //console.log('requiredItemIdValues', requiredItemIdValues);
                                        let getRequiredItemIdValues = (itemId, requiredItemIdValues) => {
                                            let requiredItemArr = [];
                                            requiredItemIdValues.forEach(item => {
                                                if (item.includes(itemId)) {
                                                    requiredItemArr.push(item);
                                                }
                                            });

                                            return JSON.stringify(requiredItemArr);
                                        }

                                        let prohibitionItemIdValues = [];
                                        if (eventInstituteItemInfo.tagbox2.length > 0) {
                                            for (let i = 0; i < eventInstituteItemInfo.tagbox2.length; i++) {
                                                let eventItemIdArr = eventInstituteItemInfo.tagbox2[i].selectedDrag;

                                                let itemIdArr = [];
                                                eventItemIdArr.forEach(eventItemId => {
                                                    let targetDragList = eventInstituteItemInfo.dragList.find(item => item.id == eventItemId);

                                                    if (targetDragList && targetDragList.buttonId) {
                                                        itemIdArr.push(targetDragList.buttonId);
                                                    }
                                                });
                                                prohibitionItemIdValues.push(itemIdArr);
                                            }
                                        } else {
                                            prohibitionItemIdValues.push([]);
                                        }
                                        //console.log('prohibitionItemIdValues', prohibitionItemIdValues);
                                        let getProhibitionItemIdValues = (itemId, prohibitionItemIdValues) => {
                                            let prohibitionItemArr = [];
                                            prohibitionItemIdValues.forEach(item => {
                                                if (item.includes(itemId)) {
                                                    prohibitionItemArr.push(item);
                                                }
                                            });

                                            return JSON.stringify(prohibitionItemArr);
                                        }

                                        // Event sub item chainItemId value make 
                                        const slotData = eventInstituteItemStyle.columnsData.slots;
                                        let slotDataCopy = JSON.parse(JSON.stringify(slotData));
                                        if (slotData.length > 2) {
                                            slotDataCopy.splice(0, 2);
                                        }
                                        // Filter only slot item data which have multiple child
                                        let slotDataMultiChild = slotDataCopy.filter(item => {
                                            if (item.child.length > 1) {
                                                return item;
                                            }
                                        });

                                        // Slot chain item id value preparing
                                        let chainItemIdPre = [];
                                        let dragList = eventInstituteItemInfo?.dragList;
                                        dragList.forEach((item, i) => {
                                            let itemSlotData = [];
                                            item.selectedItemConditions.forEach((selectedItemCondition, index) => {
                                                itemSlotData.push(`"${item.buttonId}:${index}"`);
                                            });
                                            chainItemIdPre[i] = { 'id': item.buttonId, 'name': item.Name, 'chainItemId': itemSlotData };
                                        });

                                        // Slot chain item id group by
                                        let chainItemIdValuesFinalPre = [];


                                        console.log('slotData', slotData);
                                        console.log('slotDataCopy', slotDataCopy);

                                        console.log('slotDataMultiChild', slotDataMultiChild);
                                        slotDataMultiChild.forEach(slot => {
                                            let slotItems = [];
                                            slot.child.forEach(child => {
                                                let slotItem = chainItemIdPre.find((item, index) => {
                                                    if (item.name == child.caption) {
                                                        return item;
                                                    }
                                                });
                                                slotItems.push(slotItem);
                                            });
                                            chainItemIdValuesFinalPre.push(slotItems);
                                        });

                                        let getOtherChainItemId = function (group, itemId) {
                                            let otherChainId = [];
                                            group.filter(item => {
                                                if (item.id != itemId) {
                                                    otherChainId.push(item.chainItemId);
                                                }
                                            });
                                            return otherChainId.toString();
                                        };
                                        // Others chain item value set
                                        let chainItemIdValuesFinal = JSON.parse(JSON.stringify(chainItemIdValuesFinalPre));
                                        console.log('chainItemIdValuesFinalPre', chainItemIdValuesFinal);
                                        chainItemIdValuesFinal.map(group => {
                                            group.forEach(item => {
                                                item.otherChainItemId = getOtherChainItemId(group, item.id);
                                            });
                                        });
                                        chainItemIdValuesFinal = chainItemIdValuesFinal.flat();
                                        console.log('chainItemIdValuesFinal', chainItemIdValuesFinal);
                                        // --------------- Event sub item chainItemId value make ------------------

                                        /* Slot template item id */
                                        let templateItemIdArr = [];
                                        eventInstituteItemStyle?.columnsData.slots.forEach(slot => {
                                            slot.child.forEach(child => {
                                                if (typeof (child.itemId) !== 'undefined') {
                                                    if (child.itemId !== 'second') {
                                                        templateItemIdArr.push(child.itemId);
                                                    }
                                                }
                                            })
                                        })
                                        //console.log('templateItemIdArr---->', templateItemIdArr);

                                        // Here store event item info wise slot multiple data
                                        let itemDatas = eventInstituteItemInfo?.dragList;

                                        let mappingId = query_result.insertId;

                                        let eventSlotItems = [];
                                        let eventSubItems = [];
                                        eventInstituteItemStyle.rowsData.forEach(item => {
                                            let eventSlotFacilityData = [
                                                mappingId,
                                                item.time.replace(":", ""),
                                                0, // itemId
                                                0, // itemSubId
                                                0, // sort
                                                item['second_2'], // maxReservationCount
                                                0, // reservationCount
                                                null,
                                                updatedAt,
                                                updatedBy,
                                                updatedAt,
                                                updatedBy
                                            ];
                                            eventSlotItems.push(eventSlotFacilityData);

                                            for (let i = 0; i < itemDatas.length; i++) {
                                                let itemData = itemDatas[i];
                                                let j = (i + 3);
                                                let eventSlotItem;

                                                let itemId = itemData.buttonId;

                                                let targetItemId = 0;
                                                slotData.forEach(slot => {
                                                    let targetItem = slot.child.find(child => child.itemId === itemId);
                                                    if (targetItem) {
                                                        targetItemId = targetItem.itemId + '_' + targetItem.id;
                                                    }
                                                });

                                                if (itemData.selectedItemConditions?.length > 0) {
                                                    itemData.selectedItemConditions.forEach((selectedItemCondition, index) => {
                                                        eventSlotItem = [
                                                            mappingId,
                                                            item.time.replace(":", ""),
                                                            itemId, // itemId
                                                            index, // itemSubId
                                                            buttonIdSortValues[itemData.buttonId] ? buttonIdSortValues[itemData.buttonId] : 0, // sort
                                                            item[targetItemId], // maxReservationCount
                                                            0, // reservationCount
                                                            null,
                                                            updatedAt,
                                                            updatedBy,
                                                            updatedAt,
                                                            updatedBy
                                                        ];
                                                        eventSlotItems.push(eventSlotItem);
                                                    });
                                                }
                                            }

                                        });

                                        let eventSubItemFacilityData = [
                                            0, // itemId
                                            0, // itemSubId
                                            0, // priority
                                            0, // headerOrder
                                            0, // filterId
                                            0, // itemPrice
                                            mappingId, // mappingId
                                            0, // required
                                            0, // defaultSelected
                                            0, // singleSelected
                                            0, // unchangeable
                                            0, // parentItemId
                                            '[[]]', // requiredItemId
                                            '[[]]', // prohibitionItemId
                                            '[]', // chainItemId
                                            updatedAt, // createdAt
                                            updatedBy, // createdBy
                                            updatedAt, // updatedAt
                                            updatedBy // updatedBy
                                        ];

                                        eventSubItems.push(eventSubItemFacilityData);

                                        for (let i = 0; i < itemDatas.length; i++) {
                                            let itemData = itemDatas[i];
                                            let eventSubItem;
                                            if (itemData.selectedItemConditions?.length > 0) {
                                                itemData.selectedItemConditions.forEach((selectedItemCondition, index) => {
                                                    let eventSlotItemObj = chainItemIdValuesFinal.find(child => child.id == itemData.buttonId);
                                                    if (typeof eventSlotItemObj === 'undefined') {
                                                        eventSlotItemObj = {};
                                                    }
                                                    // console.log("same slot COUNT = ", itemData.selectedItemConditions.length);
                                                    // 同じアイテムIDだが別の条件のスロットがある場合それぞれの鎖をつける（自分は除外）
                                                    let brotherSlotItem = "";
                                                    if (itemData.selectedItemConditions.length > 1) {
                                                        // console.log("aaa ---- 1");
                                                        for (let m = 0; m < itemData.selectedItemConditions.length; m++) {
                                                            // console.log("aaa ---- 2");
                                                            let brotherRow = itemData.selectedItemConditions[m];
                                                            // console.log("brotherRow === " , brotherRow);
                                                            if (m != index) {
                                                                if (brotherSlotItem) {
                                                                    brotherSlotItem = brotherSlotItem + ',"' + itemData.buttonId + ':' + m + '"';
                                                                }
                                                                else {
                                                                    brotherSlotItem = '"' + itemData.buttonId + ':' + m + '"';
                                                                }
                                                            }
                                                        }
                                                    }
                                                    // console.log("brotherSlotItem === " , brotherSlotItem);
                                                    let chainItemJSON;
                                                    if (eventSlotItemObj.otherChainItemId && brotherSlotItem) {
                                                        chainItemJSON = `[${eventSlotItemObj.otherChainItemId}` + ',' + brotherSlotItem + ']';
                                                    }
                                                    else if (eventSlotItemObj.otherChainItemId && !brotherSlotItem) {
                                                        chainItemJSON = `[${eventSlotItemObj.otherChainItemId}]`;
                                                    }
                                                    else if (!eventSlotItemObj.otherChainItemId && brotherSlotItem) {
                                                        chainItemJSON = '[' + brotherSlotItem + ']';
                                                    }
                                                    else {
                                                        chainItemJSON = '[]';
                                                    }
                                                    console.log("data1 = ", eventSlotItemObj.otherChainItemId ? `[${eventSlotItemObj.otherChainItemId}]` : '[]');
                                                    console.log("data2 = ", chainItemJSON);
                                                    eventSubItem = [
                                                        itemData.buttonId, // itemId
                                                        index, // itemSubId
                                                        index, // priority
                                                        templateItemIdArr.indexOf(itemData.buttonId), // headerOrder
                                                        selectedItemCondition?.id ? selectedItemCondition?.id : 0, // filterId
                                                        selectedItemCondition?.amount ? selectedItemCondition?.amount : 0, // itemPrice
                                                        mappingId, // mappingId
                                                        itemData.selectedItemOptions[0] ? 1 : 0, // required
                                                        itemData.selectedItemOptions[1] ? 1 : 0, // defaultSelected
                                                        itemData.selectedItemOptions[2] ? 1 : 0, // singleSelected
                                                        itemData.selectedItemOptions[3] ? 1 : 0, // unchangeable
                                                        // itemData.selectedItemOptions[0] ? itemData.selectedItemOptions[0] : 0, // required
                                                        // itemData.selectedItemOptions[1] ? itemData.selectedItemOptions[1] : 0, // defaultSelected
                                                        // itemData.selectedItemOptions[2] ? itemData.selectedItemOptions[2] : 0, // singleSelected
                                                        // itemData.selectedItemOptions[3] ? itemData.selectedItemOptions[3] : 0, // unchangeable
                                                        // itemData.selectedItemOptions[4] ? itemData.selectedItemOptions[4] : 0, // parentItemId
                                                        parentItemIds[itemData.buttonId], // parentItemId
                                                        getRequiredItemIdValues(itemData.buttonId, requiredItemIdValues), // requiredItemId
                                                        getProhibitionItemIdValues(itemData.buttonId, prohibitionItemIdValues), // prohibitionItemId
                                                        // eventSlotItemObj.otherChainItemId ? `[${eventSlotItemObj.otherChainItemId}]` : '[]', // chainItemId
                                                        chainItemJSON, // chainItemId
                                                        updatedAt, // createdAt
                                                        updatedBy, // createdBy
                                                        updatedAt, // updatedAt
                                                        updatedBy // updatedBy
                                                    ];
                                                    console.log("eventSubItem", eventSubItem);
                                                    eventSubItems.push(eventSubItem);
                                                });
                                            }
                                        }

                                        // console.log("eventSlotItems === ", eventSlotItems);                    
                                        let eventSlotInsertSql = `INSERT INTO EventSlot(
                                            mappingId,
                                            datetime,
                                            itemId,
                                            itemSubId,
                                            sort,
                                            maxReservationCount,
                                            reservationCount,
                                            slotFilterQuery,
                                            createdAt,
                                            createdBy,
                                            updatedAt,
                                            updatedBy
                                            ) 
                                        VALUES ?`;
                                        await mysql_con.query(eventSlotInsertSql, [eventSlotItems]);

                                        // console.log("eventSubItems === ", eventSubItems);                    
                                        let eventSubItemInsertSql = `INSERT INTO EventSubItem(
                                            itemId,
                                            itemSubId,
                                            priority,
                                            headerOrder,
                                            filterId,
                                            itemPrice,
                                            mappingId,
                                            required,
                                            defaultSelected,
                                            singleSelected,
                                            unchangeable,
                                            parentItemId,
                                            requiredItemId,
                                            prohibitionItemId,
                                            chainItemId,
                                            createdAt,
                                            createdBy,
                                            updatedAt,
                                            updatedBy
                                            ) 
                                        VALUES ?`;
                                        await mysql_con.query(eventSubItemInsertSql, [eventSubItems]);


                                        // その日のフィールドIDをもとに基本施設枠にフィールドクエリーをアイテム分挿入する
                                        // ここが一番時間がかかる
                                        /*
                                                                            let baseInstituteData = [];
                                                                            for (let k = 0; k < eventSlotItems.length; k++) {
                                                                                // if (eventSlotItems[k][2] == 0) {
                                                                                let filterQueryRow = [];
                                                                                let filterQuerySQL = `SELECT 
                                                                                    DISTINCT
                                                                                    Filter.filterId,
                                                                                    Filter.filterQuery
                                                                                    FROM EventSubItem 
                                                                                    LEFT OUTER JOIN Filter ON EventSubItem.filterId = Filter.filterId
                                                                                    INNER JOIN EventSlot ON EventSubItem.mappingId = EventSlot.mappingId AND EventSubItem.itemId = EventSlot.itemId
                                                                                    WHERE maxReservationCount >= 1 AND EventSubItem.mappingId = ? AND EventSlot.datetime = ?
                                                                                    ORDER BY slotId ASC;`;
                                                                                [query_result] = await mysql_con.execute(filterQuerySQL, [eventSlotItems[k][0], eventSlotItems[k][1]]);
                                        // console.log("baseInstituteData 1 ===", query_result[0]);
                                                                                eventSlotItems[k][7] = query_result;
                                                                                // filterQueryRow.push(eventSlotItems[k][7]);
                                        // console.log("baseInstituteData 2 ===", eventSlotItems[k][7]);
                                                                                let eventSlotUpdateSQL = `UPDATE EventSlot SET slotFilterQuery = ? WHERE mappingId = ? AND datetime = ? AND itemId = 0`;
                                                                                [query_result] = await mysql_con.execute(eventSlotUpdateSQL, [eventSlotItems[k][7], eventSlotItems[k][0], eventSlotItems[k][1]]);
                                                                                // }
                                                                            }
                                        */
                                        // console.log("baseInstituteData 3 ===", baseInstituteData);
                                    }

                                }
                            }
                            else {
                                sql_param = [
                                    Math.floor(new Date(row4.startDate).getTime() / 1000) + 43200,
                                    Math.floor(new Date(row4.resStartDate).getTime() / 1000),
                                    Math.floor(new Date(row4.startDate).getTime() / 1000),
                                    Math.floor(new Date(row4.resStartDate).getTime() / 1000),
                                    Math.floor(new Date(row4.resEndDate).getTime() / 1000),
                                    Number(row4.mappingId)
                                ];
                                console.log("sql_param", sql_param);
                                [query_result] = await mysql_con.execute(update_sql, sql_param);
                                if (query_result.affectedRows === 0) {
                                    mysql_con.rollback();
                                    // failure log
                                    await createLog(context, 'イベント施設カレンダー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
                                    return {
                                        statusCode: 400,
                                        headers: {
                                            "Access-Control-Allow-Origin": "*",
                                            "Access-Control-Allow-Headers": "*",
                                        },
                                        body: JSON.stringify({
                                            message: "mapping data failure"
                                        }),
                                    };
                                }
                            }
                        }
                    }
                }
            }
            // 削除処理
            for (let i = 0; i < event_mappings.length; i++) {
                console.log('event_mappings ' + i, event_mappings);
                if (event_mappings[i].state != 'match') {
                    let today = Math.floor(Date.now() / 1000);
                    sql_param = [
                        Number(event_mappings[i].mappingId)
                    ];
                    console.log("sql_param" + i, sql_param);
                    [query_result] = await mysql_con.execute(delete_sql, sql_param);
                    console.log('query_result.affectedRows', query_result.affectedRows);
                    console.log('today', today);
                    console.log('event_mappings[i].receptionDatetimeFrom', event_mappings[i].receptionDatetimeFrom);
                    if (query_result.affectedRows === 0 || today >= event_mappings[i].receptionDatetimeFrom) {
                        console.log("sql_delete Failure", delete_sql);
                        mysql_con.rollback();
                        return {
                            statusCode: 400,
                            headers: {
                                "Access-Control-Allow-Origin": "*",
                                "Access-Control-Allow-Headers": "*",
                            },
                            body: JSON.stringify({
                                message: "mapping data failure",
                                errorCode: 701
                            }),
                        };
                    }

                    // Delete event slot data
                    let delete_sql_event_slot = `DELETE FROM EventSlot WHERE mappingId = ?`;
                    await mysql_con.query(delete_sql_event_slot, [event_mappings[i].mappingId]);

                    // Delete EventSubItem table data
                    let delete_sql_event_sub_item = `DELETE FROM EventSubItem WHERE mappingId = ?`;
                    await mysql_con.query(delete_sql_event_sub_item, [event_mappings[i].mappingId]);
                }
            }
            mysql_con.commit();

            let afterSql = `SELECT * FROM EventMapping WHERE eventInstituteId = ?`;
            let [afterResult] = await mysql_con.execute(afterSql, [eventInstituteId]);
            logData[3].afterValue = afterResult;

            // success log
            await createLog(context, 'イベント施設カレンダー', '更新', '成功', '200', event.requestContext.identity.sourceIp, logAccountId, logData);
            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "*",
                },
                body: JSON.stringify({
                    message: "template success"
                }),
            };
        } catch (error) {
            mysql_con.rollback();
            console.log(error);
            // failure log
            await createLog(context, 'イベント施設カレンダー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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
        await createLog(context, 'イベント施設カレンダー', '更新', '失敗', '400', event.requestContext.identity.sourceIp, logAccountId, logData);
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